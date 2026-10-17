using System.Threading.Channels;
using Amazon.CloudFront;
using Amazon.CloudFront.Model;

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
/// <b>One request per withdrawal, sent one at a time, at most one a second.</b> CloudFront's quota is
/// one wildcard invalidation a second, and every withdrawal carries a wildcard path, so a burst
/// drains at the quota rather than throttling itself. Each request carries a caller reference fixed
/// when it is queued, and CloudFront answers a repeated reference with the same paths by returning
/// the invalidation it already made — so a retry after a response lost on the way back cannot
/// create, or pay for, a second one.
/// </para>
/// <para>
/// <b>Retried until <see cref="Horizon"/>, and never past it.</b> Any failure is retried, a
/// misconfiguration as much as a brownout: one cannot always be told from the other from here, and
/// a refusal that will never succeed fails loudly anyway — a warning per attempt and an error when
/// the window closes. Past the horizon every copy an edge fetched before the withdrawal has expired
/// on its own, so the invalidation would remove nothing; giving up then costs exactly the window
/// the site had before this existed.
/// </para>
/// <para>
/// What a stopping task still holds is lost with it, and is logged with its paths. A deploy is the
/// usual reason a task stops, and the deploy pipeline invalidates <c>/*</c> once the new task is
/// serving (ADR 0046), which covers it.
/// </para>
/// </remarks>
internal sealed class CloudFrontEdgeInvalidator : BackgroundService, IEdgeInvalidator
{
    /// <summary>
    /// The longest an edge can go on serving a copy it fetched before a withdrawal:
    /// <c>CACHE_PROFILE</c>'s five minutes fresh plus its hour of stale-while-revalidate, which the
    /// profile sitemap files share.
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
    /// Far more than this site withdraws in the hour a failing CloudFront could keep them waiting.
    /// What it bounds is memory, at a few hundred bytes each, if something goes wrong upstream. One
    /// that does not fit is logged with its paths and dropped; the write it follows is unaffected.
    /// </remarks>
    internal const int DefaultCapacity = 1_000;

    /// <summary>The delays the sender keeps, gathered in one place so a test can make them nothing.</summary>
    /// <param name="FirstRetry">The wait after a first failure, doubling after each one after it.</param>
    /// <param name="LongestRetry">The ceiling on that wait.</param>
    /// <param name="Spacing">
    /// The least time between two requests: CloudFront's quota of one wildcard invalidation a second.
    /// </param>
    /// <param name="AttemptTimeout">One attempt's ceiling, the SDK's own retries inside it included.</param>
    internal sealed record Pacing(
        TimeSpan FirstRetry, TimeSpan LongestRetry, TimeSpan Spacing, TimeSpan AttemptTimeout)
    {
        public static readonly Pacing Default = new(
            FirstRetry: TimeSpan.FromSeconds(2),
            LongestRetry: TimeSpan.FromMinutes(5),
            Spacing: TimeSpan.FromSeconds(1),
            AttemptTimeout: TimeSpan.FromSeconds(30));
    }

    /// <summary>A withdrawal waiting to be sent, with the reference every attempt at it shares.</summary>
    internal sealed record Queued(EdgeInvalidation Invalidation, string CallerReference, DateTimeOffset QueuedAt);

    private readonly IAmazonCloudFront cloudFront;
    private readonly string distributionId;
    private readonly TimeProvider clock;
    private readonly ILogger<CloudFrontEdgeInvalidator> logger;
    private readonly Pacing pacing;
    private readonly Channel<Queued> queue;

    /// <summary>
    /// When the last request went out. Touched only from the one loop that sends, so it needs no
    /// synchronisation.
    /// </summary>
    private DateTimeOffset lastSent = DateTimeOffset.MinValue;

    public CloudFrontEdgeInvalidator(
        IAmazonCloudFront cloudFront,
        string distributionId,
        TimeProvider clock,
        ILogger<CloudFrontEdgeInvalidator> logger)
        : this(cloudFront, distributionId, clock, logger, Pacing.Default, DefaultCapacity)
    {
    }

    internal CloudFrontEdgeInvalidator(
        IAmazonCloudFront cloudFront,
        string distributionId,
        TimeProvider clock,
        ILogger<CloudFrontEdgeInvalidator> logger,
        Pacing pacing,
        int capacity)
    {
        this.cloudFront = cloudFront;
        this.distributionId = distributionId;
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
        var queued = new Queued(invalidation, Guid.NewGuid().ToString("N"), clock.GetUtcNow());
        if (queue.Writer.TryWrite(queued)) return;

        logger.LogError(
            "Could not queue {Paths} ({Reason}): the invalidation queue is full or has stopped. "
            + "They stay at the edge until their TTL runs out.",
            invalidation.Paths, invalidation.Reason);
    }

    /// <summary>Takes the next waiting withdrawal off the queue, for the tests that inspect it.</summary>
    internal bool TryTakeQueued(out Queued? queued) => queue.Reader.TryRead(out queued);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var queued in queue.Reader.ReadAllAsync(stoppingToken))
            {
                await SendAsync(queued, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down, which is not a failure. What was still waiting is reported below.
        }
        finally
        {
            // Anything a request withdraws from here on is refused by Invalidate, which logs it,
            // rather than queued for a sender that will never read it.
            queue.Writer.TryComplete();
            while (queue.Reader.TryRead(out var unsent)) LogUnsent(unsent);
        }
    }

    /// <summary>
    /// Sends one withdrawal, retrying until it is accepted or its window has closed. Throws only
    /// when the host is stopping.
    /// </summary>
    internal async Task SendAsync(Queued queued, CancellationToken stoppingToken)
    {
        var giveUpAt = queued.QueuedAt + Horizon;

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

                using var attemptTimeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                attemptTimeout.CancelAfter(pacing.AttemptTimeout);

                var response = await cloudFront.CreateInvalidationAsync(Request(queued), attemptTimeout.Token);

                logger.LogInformation(
                    "Invalidated {Paths} ({Reason}) as {InvalidationId}, {Delay} after the write, on attempt {Attempt}.",
                    queued.Invalidation.Paths, queued.Invalidation.Reason,
                    response.Invalidation?.Id, clock.GetUtcNow() - queued.QueuedAt, attempt);
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

            var retryIn = Backoff(attempt);
            if (clock.GetUtcNow() + retryIn >= giveUpAt)
            {
                LogGaveUp(queued, attempt, failure);
                return;
            }

            logger.LogWarning(failure,
                "Invalidating {Paths} ({Reason}) failed on attempt {Attempt}; retrying in {RetryIn}.",
                queued.Invalidation.Paths, queued.Invalidation.Reason, attempt, retryIn);

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
        var wait = lastSent + pacing.Spacing - clock.GetUtcNow();
        if (wait > TimeSpan.Zero) await Task.Delay(wait, clock, stoppingToken);
        lastSent = clock.GetUtcNow();
    }

    /// <summary>Two seconds, doubling, to a ceiling of five minutes: about twenty attempts in a window.</summary>
    private TimeSpan Backoff(int attempt)
    {
        var doubled = pacing.FirstRetry.Ticks * Math.Pow(2, Math.Min(attempt - 1, 30));
        return TimeSpan.FromTicks((long)Math.Min(doubled, pacing.LongestRetry.Ticks));
    }

    private void LogGaveUp(Queued queued, int attempts, Exception? failure) =>
        logger.LogError(failure,
            "Gave up invalidating {Paths} ({Reason}) after {Attempts} attempt(s): by now every copy the "
            + "edge held before the write has expired by itself, so the withdrawal took as long to "
            + "reach the edge as it would have with no invalidation at all.",
            queued.Invalidation.Paths, queued.Invalidation.Reason, attempts);

    private void LogUnsent(Queued queued) =>
        logger.LogWarning(
            "Stopping with {Paths} ({Reason}) not invalidated; they stay at the edge until their TTL runs out.",
            queued.Invalidation.Paths, queued.Invalidation.Reason);
}
