using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Threading.Channels;
using Amazon.CloudFront;
using Amazon.CloudFront.Model;
using Amazon.Runtime;

namespace MyVideoGameList.Server.Services.Edge;

/// <summary>
/// Invalidates paths on the site's CloudFront distribution: queued by the request that withdrew
/// something, sent from the background, and retried until the edge would have let go of them by
/// itself.
/// </summary>
/// <remarks>
/// <para>
/// <b>Queued rather than sent inline, for two reasons.</b> A privacy switch must not take as long
/// as CloudFront does: with the call inline, a slow or failing CloudFront API holds the reader's
/// request open for the whole of the SDK's retries. And the request's cancellation token is the
/// wrong one for a call that has to happen after the commit — a reader closing the tab would cancel
/// the invalidation of something the database had already withdrawn. Here the request returns as
/// soon as the paths are queued, and nothing about the reader can stop them being sent.
/// </para>
/// <para>
/// <b>The second background service, and it copies the first one's shape</b>
/// (<c>docs/decisions/0038-*</c>). It is a singleton holding nothing scoped, so it needs no scope
/// factory at all. An exception escaping <see cref="ExecuteAsync"/> stops the host — the behaviour
/// <see cref="ScheduledWork"/> sets — so <see cref="SendAsync"/> catches every failure of an attempt
/// and only shutdown leaves the loop. It runs once per ECS task, and that is safe here without the
/// sweep's advisory lock: each task's queue holds only what its own requests withdrew, so no two
/// tasks ever hold the same work.
/// </para>
/// <para>
/// <b>One request per withdrawal, sent one at a time, at most one a second.</b> CloudFront's quotas
/// page gives one wildcard invalidation a second, and every withdrawal carries a wildcard path, so a
/// burst drains at the quota rather than throttling itself. The pacing is per task. Each request
/// carries a caller reference fixed when it is queued, and CloudFront answers a repeated reference
/// with the same paths by returning the invalidation it already made — so a retry after a response
/// lost on the way back cannot create a second one. A withdrawal whose paths are already waiting is
/// not queued again: the one waiting goes out after both writes, so it covers both, and one account
/// saving in a loop holds one place in the queue rather than all of them. The one waiting takes the
/// later write's time, so it is retried for as long as the later window is open.
/// </para>
/// <para>
/// <b>Retried until <see cref="Horizon"/>, and never past it.</b> Any failure is retried, a
/// misconfiguration as much as a brownout: one cannot always be told from the other from here, and
/// a refusal that will never succeed fails loudly anyway — an error once the retries reach their
/// ceiling, with how much is waiting behind it, and another when the window closes. Past the horizon
/// every copy an edge fetched before the withdrawal has expired and may not be served stale, so the
/// invalidation would remove nothing; giving up then costs exactly the window the site had before
/// this existed.
/// </para>
/// <para>
/// <b>At most a day's ceiling of paths</b>, because every path past the month's free thousand is
/// paid for and nothing else bounds what a signed-in account can make this send. Past it, a
/// withdrawal keeps the TTL window, and the first one refused each day is an error in the log.
/// </para>
/// <para>
/// A stopping task spends a few seconds sending what it holds, and logs what it could not. A deploy
/// is the usual reason a task stops, and the deploy pipeline invalidates <c>/*</c> once the new task
/// is serving (ADR 0046), which covers the rest.
/// </para>
/// </remarks>
internal sealed class CloudFrontEdgeInvalidator : BackgroundService, IEdgeInvalidator
{
    /// <summary>
    /// The longest an edge can go on serving a copy it fetched before a withdrawal:
    /// <c>CACHE_PROFILE</c>'s five minutes fresh plus its hour of stale-while-revalidate, which the
    /// profile sitemap files share. Its <c>stale-if-error=0</c> is what stops an expired copy being
    /// served again during an outage of the origin, which would make this no bound at all.
    /// </summary>
    /// <remarks>
    /// Restated from <c>@/lib/cache</c> rather than shared, because the policy is the client's to
    /// set. If <c>CACHE_PROFILE</c> grows, this has to grow with it, or a long outage gives up while
    /// a copy is still being served; the comment there says so too.
    /// </remarks>
    internal static readonly TimeSpan Horizon = TimeSpan.FromSeconds(300 + 3600);

    /// <summary>
    /// How many withdrawals may wait to be sent.
    /// </summary>
    /// <remarks>
    /// Far more than this site withdraws in the hour a failing CloudFront could keep them waiting,
    /// and a loop of saves holds only one place, because a withdrawal already waiting is not queued
    /// twice. What it bounds is memory, at a few hundred bytes each, if something goes wrong
    /// upstream. One that does not fit is logged with its paths and dropped; the write it follows is
    /// unaffected.
    /// </remarks>
    internal const int DefaultCapacity = 1_000;

    /// <summary>The delays the sender keeps, gathered in one place so a test can make them nothing.</summary>
    /// <param name="FirstRetry">The wait after a first failure, doubling after each one after it.</param>
    /// <param name="LongestRetry">The ceiling on that wait.</param>
    /// <param name="Spacing">
    /// The least time between two requests: CloudFront's quota of one wildcard invalidation a second.
    /// </param>
    /// <param name="AttemptTimeout">One attempt's ceiling, the SDK's own retries inside it included.</param>
    /// <param name="ShutdownDrain">
    /// How long a stopping task goes on sending what it holds. Well inside the thirty seconds both ECS
    /// and the host give a stop.
    /// </param>
    internal sealed record Pacing(
        TimeSpan FirstRetry, TimeSpan LongestRetry, TimeSpan Spacing, TimeSpan AttemptTimeout,
        TimeSpan ShutdownDrain)
    {
        public static readonly Pacing Default = new(
            FirstRetry: TimeSpan.FromSeconds(2),
            LongestRetry: TimeSpan.FromMinutes(5),
            Spacing: TimeSpan.FromSeconds(1),
            AttemptTimeout: TimeSpan.FromSeconds(30),
            ShutdownDrain: TimeSpan.FromSeconds(5));
    }

    /// <summary>A withdrawal waiting to be sent, with the reference every attempt at it shares.</summary>
    /// <param name="Key">Its paths as one string, which is what a second withdrawal is compared on.</param>
    internal sealed record Queued(
        EdgeInvalidation Invalidation, string CallerReference, DateTimeOffset QueuedAt, string Key);

    private readonly IAmazonCloudFront cloudFront;
    private readonly string distributionId;
    private readonly int dailyPathLimit;
    private readonly TimeProvider clock;
    private readonly ILogger<CloudFrontEdgeInvalidator> logger;
    private readonly Pacing pacing;
    private readonly Channel<Queued> queue;

    /// <summary>
    /// The keys of everything queued and not yet taken off the queue to be sent, each with the time
    /// of the latest write it covers, under <see cref="gate"/>.
    /// </summary>
    private readonly Dictionary<string, DateTimeOffset> waiting = new(StringComparer.Ordinal);
    private readonly Lock gate = new();
    private volatile bool stopping;

    // Touched only from the one loop that sends, so they need no synchronisation.
    private DateTimeOffset lastSent = DateTimeOffset.MinValue;
    private DateOnly ceilingDay;
    private int pathsToday;
    private int refusedToday;

    public CloudFrontEdgeInvalidator(
        IAmazonCloudFront cloudFront,
        string distributionId,
        int dailyPathLimit,
        TimeProvider clock,
        ILogger<CloudFrontEdgeInvalidator> logger)
        : this(cloudFront, distributionId, dailyPathLimit, clock, logger, Pacing.Default, DefaultCapacity)
    {
    }

    internal CloudFrontEdgeInvalidator(
        IAmazonCloudFront cloudFront,
        string distributionId,
        int dailyPathLimit,
        TimeProvider clock,
        ILogger<CloudFrontEdgeInvalidator> logger,
        Pacing pacing,
        int capacity)
    {
        this.cloudFront = cloudFront;
        this.distributionId = distributionId;
        this.dailyPathLimit = dailyPathLimit;
        this.clock = clock;
        this.logger = logger;
        this.pacing = pacing;

        // Wait rather than DropWrite: under DropWrite a full queue still answers TryWrite with true,
        // and a withdrawal would vanish without a line in the log. Nothing ever waits — the writer
        // only ever calls TryWrite — so Wait here means "say no".
        queue = Channel.CreateBounded<Queued>(new BoundedChannelOptions(capacity)
        {
            SingleReader = true,
            FullMode = BoundedChannelFullMode.Wait,
        });
    }

    public void Invalidate(EdgeInvalidation invalidation)
    {
        var key = string.Join('\n', invalidation.Paths);
        Queued? queued = null;
        var alreadyWaiting = false;

        lock (gate)
        {
            var now = clock.GetUtcNow();

            // Waiting and not yet sent: it goes out after this write committed, so it covers this
            // withdrawal as well, and sending both would pay twice for one effect. It takes this
            // write's time as its own, so it goes on trying for as long as this write's window is
            // open, not only its first one's.
            if (!stopping && waiting.ContainsKey(key))
            {
                waiting[key] = now;
                alreadyWaiting = true;
            }
            else
            {
                var candidate = new Queued(invalidation, Guid.NewGuid().ToString("N"), now, key);
                if (queue.Writer.TryWrite(candidate))
                {
                    waiting[key] = now;
                    queued = candidate;
                }
            }
        }

        if (alreadyWaiting)
        {
            logger.LogDebug(
                "{Paths} ({Reason}) is already waiting to be invalidated; not queued again.",
                invalidation.PathsForLog, invalidation.Reason);
            return;
        }

        if (queued is null)
        {
            logger.LogError(
                "Could not queue {Paths} ({Reason}): the invalidation queue {State}. "
                + "They stay at the edge until their TTL runs out.",
                invalidation.PathsForLog, invalidation.Reason, stopping ? "has stopped" : "is full");
            return;
        }

        logger.LogInformation(
            "Queued {Paths} ({Reason}) to be invalidated as {CallerReference}.",
            invalidation.PathsForLog, invalidation.Reason, queued.CallerReference);
    }

    /// <summary>
    /// Takes the next waiting withdrawal off the queue as the loop does, for the tests that inspect
    /// it.
    /// </summary>
    internal bool TryTakeQueued([NotNullWhen(true)] out Queued? queued)
    {
        if (!queue.Reader.TryRead(out var taken))
        {
            queued = null;
            return false;
        }

        queued = TakeOffWaiting(taken);
        return true;
    }

    /// <summary>
    /// Takes a withdrawal off the waiting list as it goes out, dated by the latest write it covers.
    /// </summary>
    /// <remarks>
    /// Off the list before the request goes out: a withdrawal arriving from here on may have
    /// committed after this request reached CloudFront, so it is queued anew.
    /// </remarks>
    private Queued TakeOffWaiting(Queued queued)
    {
        lock (gate)
        {
            return waiting.Remove(queued.Key, out var latest) && latest > queued.QueuedAt
                ? queued with { QueuedAt = latest }
                : queued;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation(
            "Invalidating withdrawn profiles on CloudFront distribution {DistributionId}, at most {DailyPathLimit} paths a day.",
            distributionId, dailyPathLimit);

        try
        {
            await foreach (var taken in queue.Reader.ReadAllAsync(stoppingToken))
            {
                var queued = TakeOffWaiting(taken);

                try
                {
                    await SendAsync(queued, stoppingToken);
                }
                catch (Exception e) when (e is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
                {
                    // Per item, as the sweep catches per tick (ADR 0038). Nothing in SendAsync is
                    // meant to throw, and if something does it costs this withdrawal, not the host.
                    logger.LogError(e,
                        "Could not send {Paths} ({Reason}); they stay at the edge until their TTL runs out ({CallerReference}).",
                        queued.Invalidation.PathsForLog, queued.Invalidation.Reason, queued.CallerReference);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down, which is not a failure. StopAsync reports what was still waiting.
        }
    }

    /// <summary>
    /// Stops taking withdrawals, spends <see cref="Pacing.ShutdownDrain"/> sending what is queued,
    /// then stops the loop and logs, with its paths, whatever is left.
    /// </summary>
    /// <remarks>
    /// Here rather than in a <c>finally</c> in <see cref="ExecuteAsync"/>, because on .NET 10 a stop
    /// that arrives straight after the start can cancel the loop before it has run at all — seen in
    /// the review of this class, on 10.0.11 — and a <c>finally</c> that never runs leaves the queue
    /// open to writes nobody will read.
    /// </remarks>
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        stopping = true;
        queue.Writer.TryComplete();

        // With the writer complete, the loop ends by itself once the queue is empty.
        if (ExecuteTask is { } loop)
            await Task.WhenAny(loop, Task.Delay(pacing.ShutdownDrain, clock, cancellationToken));

        await base.StopAsync(cancellationToken);

        while (queue.Reader.TryRead(out var unsent)) LogUnsent(unsent);
    }

    /// <summary>
    /// Sends one withdrawal, retrying until it is accepted or its window has closed. Throws only
    /// when the host is stopping.
    /// </summary>
    internal async Task SendAsync(Queued queued, CancellationToken stoppingToken)
    {
        var giveUpAt = queued.QueuedAt + Horizon;
        if (!WithinDailyLimit(queued)) return;

        for (var attempt = 1; ; attempt++)
        {
            // It may have waited behind another withdrawal's retries for most of its window.
            if (clock.GetUtcNow() >= giveUpAt)
            {
                LogGaveUp(queued, attempt - 1, failure: null);
                return;
            }

            Exception failure;
            try
            {
                await PaceAsync(stoppingToken);

                // And again after the wait for the spacing, which can run past the window: a
                // request sent then would be a path paid for to remove nothing.
                if (clock.GetUtcNow() >= giveUpAt)
                {
                    LogGaveUp(queued, attempt - 1, failure: null);
                    return;
                }

                using var attemptTimeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                attemptTimeout.CancelAfter(pacing.AttemptTimeout);

                var response = await cloudFront.CreateInvalidationAsync(Request(queued), attemptTimeout.Token);
                CountAccepted(queued.Invalidation.Paths.Count);

                logger.LogInformation(
                    "Invalidated {Paths} ({Reason}) as {InvalidationId}, {Delay} after the write, on attempt {Attempt} ({CallerReference}).",
                    queued.Invalidation.PathsForLog, queued.Invalidation.Reason,
                    response.Invalidation?.Id, clock.GetUtcNow() - queued.QueuedAt, attempt, queued.CallerReference);
                return;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                LogUnsent(queued);
                throw;
            }
            catch (Exception e)
            {
                // Every other failure is caught, deliberately: one that escaped would stop the host
                // and take the API down over a cache. A timeout of the attempt lands here too.
                failure = e;
            }

            if (RetryDelay(attempt, giveUpAt - clock.GetUtcNow(), pacing) is not { } retryIn)
            {
                LogGaveUp(queued, attempt, failure);
                return;
            }

            LogFailedAttempt(queued, attempt, failure, retryIn, giveUpAt);

            try
            {
                await Task.Delay(retryIn, clock, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                LogUnsent(queued);
                throw;
            }
        }
    }

    /// <summary>
    /// The wait after the given failed attempt: two seconds, doubling, to a ceiling of five minutes,
    /// which comes to about twenty attempts in a window.
    /// </summary>
    internal static TimeSpan Backoff(int attempt, Pacing pacing)
    {
        var doubled = pacing.FirstRetry.Ticks * Math.Pow(2, Math.Min(attempt - 1, 30));
        return TimeSpan.FromTicks((long)Math.Min(doubled, pacing.LongestRetry.Ticks));
    }

    /// <summary>
    /// How long to wait before the next attempt, given how much of the window is left, or null to
    /// give up.
    /// </summary>
    /// <remarks>
    /// A backoff that would land past the window is cut short to one last attempt just inside it
    /// rather than none at all: without that, the five-minute ceiling would end the retries up to
    /// five minutes early.
    /// </remarks>
    internal static TimeSpan? RetryDelay(int attempt, TimeSpan remaining, Pacing pacing)
    {
        var retryIn = Backoff(attempt, pacing);
        if (retryIn < remaining) return retryIn;

        var last = remaining - pacing.Spacing;
        return last > TimeSpan.Zero ? last : null;
    }

    private CreateInvalidationRequest Request(Queued queued) => new()
    {
        DistributionId = distributionId,
        InvalidationBatch = new InvalidationBatch
        {
            CallerReference = queued.CallerReference,
            // Quantity is not derived from Items: CloudFront refuses a batch where the two disagree,
            // and version 4 of the SDK leaves both unset unless they are given.
            Paths = new Paths
            {
                Quantity = queued.Invalidation.Paths.Count,
                Items = [.. queued.Invalidation.Paths],
            },
        },
    };

    private async Task PaceAsync(CancellationToken stoppingToken)
    {
        // Never longer than the spacing itself, so a clock stepped backwards cannot stall the queue.
        var wait = lastSent + pacing.Spacing - clock.GetUtcNow();
        if (wait > pacing.Spacing) wait = pacing.Spacing;
        if (wait > TimeSpan.Zero) await Task.Delay(wait, clock, stoppingToken);
        lastSent = clock.GetUtcNow();
    }

    /// <summary>The UTC day now, starting its count afresh when it is a new one.</summary>
    private DateOnly Today()
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        if (today != ceilingDay)
        {
            ceilingDay = today;
            pathsToday = 0;
            refusedToday = 0;
        }

        return today;
    }

    /// <summary>
    /// Counts accepted paths against the day CloudFront accepted them on, which for a withdrawal
    /// tried before midnight and accepted on a retry after it is not the day it was let through on.
    /// </summary>
    private void CountAccepted(int paths)
    {
        Today();
        pathsToday += paths;
    }

    private bool WithinDailyLimit(Queued queued)
    {
        var today = Today();

        if (pathsToday + queued.Invalidation.Paths.Count <= dailyPathLimit) return true;

        // An error once a day, when the ceiling is first met, and quiet after that: what matters is
        // that it was met, and a loop that met it would otherwise fill the log as fast as it saves.
        if (++refusedToday == 1)
        {
            logger.LogError(
                "Reached the ceiling of {DailyPathLimit} invalidation paths for {Day} (UTC), so {Paths} ({Reason}) "
                + "and every withdrawal after it today keep the TTL window instead. Something is saving in a loop, "
                + "or the ceiling (CloudFront:DailyPathLimit) is too low for the site.",
                dailyPathLimit, today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                queued.Invalidation.PathsForLog, queued.Invalidation.Reason);
        }
        else
        {
            logger.LogDebug(
                "Over today's invalidation ceiling; {Paths} ({Reason}) not sent ({Refused} refused today).",
                queued.Invalidation.PathsForLog, queued.Invalidation.Reason, refusedToday);
        }

        return false;
    }

    private void LogFailedAttempt(Queued queued, int attempt, Exception failure, TimeSpan retryIn, DateTimeOffset giveUpAt)
    {
        var behind = queue.Reader.Count;

        // The exception's stack once, on the first failure; after that its gist, or a CloudWatch
        // stream fills with copies of one stack trace for an hour.
        if (attempt == 1)
        {
            logger.LogWarning(failure,
                "Invalidating {Paths} ({Reason}) failed on attempt 1; retrying in {RetryIn}, {Waiting} more waiting ({CallerReference}).",
                queued.Invalidation.PathsForLog, queued.Invalidation.Reason, retryIn, behind, queued.CallerReference);
            return;
        }

        // Retrying at the longest wait for the first time means minutes of failure already: worth an
        // error while sending it by hand would still help, rather than only when the window closes.
        var level = retryIn >= pacing.LongestRetry && Backoff(attempt - 1, pacing) < pacing.LongestRetry
            ? LogLevel.Error
            : LogLevel.Warning;

        logger.Log(level,
            "Invalidating {Paths} ({Reason}) failed on attempt {Attempt} with {Failure}; retrying in {RetryIn}, "
            + "{Waiting} more waiting. It stops mattering at {GiveUpAt} ({CallerReference}).",
            queued.Invalidation.PathsForLog, queued.Invalidation.Reason, attempt, Gist(failure), retryIn, behind,
            giveUpAt, queued.CallerReference);
    }

    /// <summary>What failed, in one line: CloudFront's own code and status where it gave one.</summary>
    private static string Gist(Exception failure) => failure is AmazonServiceException service
        ? $"{service.GetType().Name} ({(int)service.StatusCode} {service.ErrorCode}): {service.Message}"
        : $"{failure.GetType().Name}: {failure.Message}";

    private void LogGaveUp(Queued queued, int attempts, Exception? failure) =>
        logger.LogError(failure,
            "Gave up invalidating {Paths} ({Reason}) after {Attempts} attempt(s): by now every copy the "
            + "edge held before the write has expired by itself, so the withdrawal took as long to "
            + "reach the edge as it would have with no invalidation at all ({CallerReference}).",
            queued.Invalidation.PathsForLog, queued.Invalidation.Reason, attempts, queued.CallerReference);

    private void LogUnsent(Queued queued) =>
        logger.LogError(
            "Stopping with {Paths} ({Reason}) not invalidated; they stay at the edge until their TTL runs out "
            + "({CallerReference}).",
            queued.Invalidation.PathsForLog, queued.Invalidation.Reason, queued.CallerReference);
}
