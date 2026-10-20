using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using Npgsql;
using Polly.CircuitBreaker;
using Polly.RateLimiting;
using Polly.Timeout;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Refreshes <c>CachedGames</c> from IGDB before a reader finds a row a day old, one bounded batch a
/// tick.
/// </summary>
/// <remarks>
/// <para>
/// Until this ran, a row was refreshed only by the reader who found it past
/// <see cref="GameCacheService.RefreshAfter"/>, and that reader paid the IGDB round trip on their
/// page load. This rewrites rows an hour before they reach that age (<see cref="GameCacheRefresh.Lead"/>),
/// so in the steady state no reader pays it at all, and the request path's own refresh becomes the
/// fallback for a game nobody has cached yet or a job that has fallen behind. See
/// <c>docs/decisions/0052-*</c>.
/// </para>
/// <para>
/// The shape is <c>ImportRetentionService</c>'s, copied rather than reinvented (ADR 0038), and the
/// three things about hosted services that class explains hold here for the same reasons: a
/// <b>singleton</b>, so a scope per tick rather than an injected <see cref="ApplicationDbContext"/>;
/// an exception escaping <c>ExecuteAsync</c> <b>stops the whole host</b>, so the loop catches per
/// tick; and <b>one copy per ECS task</b>, so each batch serialises on an advisory lock.
/// </para>
/// <para>
/// What differs is what the lock buys. A sweep that loses the race has nothing left to do, because
/// the winner deleted the same rows. Here the winner refreshes one batch and releases the lock, and a
/// task whose tick comes later finds the next batch due — so the lock is what stops two tasks paying
/// IGDB for the same games, and the pace is per task: while rows are due, N tasks send up to N
/// requests an interval, one each.
/// </para>
/// </remarks>
internal sealed class GameCacheRefreshService(
    IServiceScopeFactory scopeFactory,
    IIgdbService igdb,
    IOptions<GameCacheRefreshOptions> options,
    TimeProvider clock,
    ILogger<GameCacheRefreshService> logger) : BackgroundService
{
    /// <summary>
    /// The advisory lock each batch serialises on. "MVGLGAME" in ASCII, and only its uniqueness in
    /// this database matters — <c>ImportRetentionService</c> holds "MVGLIMPT".
    /// </summary>
    internal const long LockKey = 0x4D56474C_4741_4D45;

    /// <summary>
    /// How often a refresh that is behind says so again while it stays behind.
    /// </summary>
    /// <remarks>
    /// A tick is a minute by default, and a warning a minute through an outage that lasts an
    /// afternoon is noise that teaches people to stop reading the log. Hourly, which is how often
    /// the retention sweep repeats its own.
    /// </remarks>
    private static readonly TimeSpan BehindWarningEvery = TimeSpan.FromHours(1);

    /// <summary>
    /// The longest a batch waits for IGDB, the token included.
    /// </summary>
    /// <remarks>
    /// The batch waits holding its lock and a transaction, and the transaction holds a lock on
    /// <c>CachedGames</c> as well: the ordinary one any read takes, which nothing a request does
    /// conflicts with, but which a migration altering the table has to wait for — with every reader
    /// of the table queued behind the migration. The resilience pipeline bounds a call at thirty
    /// seconds, and a process's first batch makes two, the token and the query, so a slow IGDB could
    /// otherwise hold that lock for a minute. Fifteen seconds is five times the slowest batch
    /// measured (five hundred ids, 2.9 seconds) and leaves room for one retry.
    /// </remarks>
    private static readonly TimeSpan IgdbWaitLimit = TimeSpan.FromSeconds(15);

    /// <summary>
    /// How long a batch is kept out of the queue when IGDB answered it in a shape this code cannot
    /// read, or with a value the database refuses to store.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Retrying it on the next tick would retry it for ever: nothing is written, so it stays the
    /// oldest thing due and comes first every time, and one game the mapping cannot read — or one
    /// title longer than its column — would stop the refresh of the whole table. Held back, it
    /// costs only its own rows, which fall back to their readers — refreshed at a day, as before
    /// this job existed — while the queue moves on.
    /// </para>
    /// <para>
    /// An hour, so the error that names the rows repeats on the warning's rhythm, and so they are
    /// tried again in case the fault was IGDB's and has passed. Splitting the batch to find the one
    /// game would refresh the other forty-nine as well, at the cost of state this job does not
    /// otherwise need; ADR 0052 leaves it out.
    /// </para>
    /// </remarks>
    private static readonly TimeSpan HoldBackFor = TimeSpan.FromHours(1);

    /// <summary>
    /// When this task started, so that a backlog it inherited — rows that went overdue while
    /// nothing was refreshing, before a deploy or through a park — is not reported as the job
    /// falling behind.
    /// </summary>
    private readonly DateTimeOffset startedAt = clock.GetUtcNow();

    /// <summary>
    /// When this task last warned that the refresh was behind, or <c>null</c> when it is not.
    /// </summary>
    /// <remarks>
    /// This and the two fields below are touched only from <see cref="ExecuteAsync"/>'s single loop,
    /// so they need no synchronisation.
    /// </remarks>
    private DateTimeOffset? warnedBehindAt;

    /// <summary>When IGDB first failed to answer, while it still has not; <c>null</c> otherwise.</summary>
    private DateTimeOffset? failingSince;

    /// <summary>Ids kept out of the queue after an answer that could not be read, and until when.</summary>
    private readonly Dictionary<int, DateTimeOffset> heldBack = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Once at startup and then on the timer, as the retention sweep does. A task that has just
        // started may be the only one, and the lock makes a whole fleet starting at once a
        // non-event: one of them takes the first batch and the others find the lock held.
        await RunOnceAsync(stoppingToken);

        using var timer = new PeriodicTimer(options.Value.Interval, clock);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RunOnceAsync(stoppingToken);
        }
    }

    /// <summary>One tick, which never throws except to stop.</summary>
    internal async Task RunOnceAsync(CancellationToken stoppingToken)
    {
        try
        {
            await RefreshAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down, which is not a failure.
            throw;
        }
        catch (Exception e)
        {
            // Swallowed deliberately: letting this reach ExecuteAsync would stop the host and take
            // the whole API down over a cache that is only slower without this job. A missed tick
            // costs one batch, which the next tick takes instead.
            logger.LogError(e, "Game cache refresh failed; it will be retried on the next tick.");
        }
    }

    /// <summary>
    /// One tick: refresh a batch if this task can take the lock, then look at how far behind the
    /// table is, whether or not it could.
    /// </summary>
    private async Task RefreshAsync(CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        // One instant for the tick, so the batch it selects and the lag it reports describe the
        // same moment.
        var now = clock.GetUtcNow();
        var batch = await RefreshBatchAsync(db, now, cancellationToken);

        switch (batch)
        {
            case null:
                logger.LogDebug("Game cache refresh skipped a tick; the lock was held.");
                break;
            case { Asked: 0 }:
                logger.LogDebug("Game cache refresh found nothing due.");
                break;
            case { Answered: false }:
                // Logged where it failed, with the exception.
                break;
            default:
                // Debug, not Information: a line a minute saying the job did its job is the noise
                // the retention sweep keeps out of the log for the same reason. The warning below
                // is what says when it is not.
                logger.LogDebug(
                    "Game cache refresh rewrote {Count} cached game(s), {Tombstones} of them now "
                    + "tombstones; IGDB answered in {ElapsedMs} ms, and the oldest had been refreshed "
                    + "at {Oldest}.",
                    batch.Value.Asked, batch.Value.Tombstones,
                    (long)batch.Value.Took.TotalMilliseconds, batch.Value.Oldest);
                break;
        }

        await NoteLagAsync(db, now, lockedOut: batch is null, cancellationToken);
    }

    /// <summary>What one batch did, for the log.</summary>
    /// <param name="Asked">How many rows were due and sent to IGDB; zero when none were due.</param>
    /// <param name="Answered">Whether IGDB answered readably, so that the rows were rewritten.</param>
    /// <param name="Took">How long IGDB took to answer, or to fail.</param>
    internal readonly record struct Batch(
        int Asked, bool Answered, int Tombstones, TimeSpan Took, DateTimeOffset? Oldest);

    /// <summary>
    /// One batch in its own transaction, under the advisory lock.
    /// </summary>
    /// <returns><c>null</c> when another session holds the lock.</returns>
    /// <remarks>
    /// <para>
    /// Through the execution strategy, for the reason the retention sweep gives at length: today it
    /// does nothing, and on the day somebody adds <c>EnableRetryOnFailure</c> to <c>UseNpgsql</c> a
    /// user-initiated transaction outside it throws <c>InvalidOperationException</c> on every tick,
    /// into the log, while the table quietly goes stale. The whole transaction is inside it, so a
    /// retried attempt takes the transaction-scoped lock again rather than proceeding without it.
    /// </para>
    /// <para>
    /// <b>The retry is not the sweep's, though the wrapper is.</b> The sweep deletes with
    /// <c>ExecuteDeleteAsync</c> and carries nothing from one attempt to the next; this writes
    /// tracked rows. <c>SaveChangesAsync</c> accepts what it wrote even when the commit after it then
    /// fails, so a retried attempt's query would hand back those rows as they were saved rather than
    /// as the rolled-back database holds them, <see cref="GameCacheService.Apply"/> would change
    /// nothing but <c>RefreshedAt</c>, and the old payload would be stamped fresh for a day. So each
    /// attempt clears the change tracker first and starts from the database. A retry also asks IGDB
    /// again; it is a batch's worth of one request.
    /// </para>
    /// <para>
    /// <b>The IGDB request is made inside the transaction, holding the lock</b>, and that is the
    /// point of the lock rather than a lapse. Released before the request, it would let a second
    /// task select the same rows — still due, because nothing has been written — and pay IGDB for
    /// them again. Held, it costs one pooled connection idle in a transaction, and the table lock
    /// <see cref="IgdbWaitLimit"/> describes, for as long as IGDB takes: about a second at fifty
    /// ids, and never more than that limit.
    /// </para>
    /// </remarks>
    private async Task<Batch?> RefreshBatchAsync(
        ApplicationDbContext db, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var strategy = db.Database.CreateExecutionStrategy();

        return await strategy.ExecuteAsync<Batch?>(async token =>
        {
            // See the remarks: an attempt starts from the database, never from what an earlier
            // attempt saved. On the first attempt there is nothing to clear.
            db.ChangeTracker.Clear();

            await using var transaction = await db.Database.BeginTransactionAsync(token);

            // Aliased `Value`, because SqlQuery<T> wraps this as a subquery and projects `s.Value`
            // from it — see ImportRetentionService, which found that out against a real database.
            var acquired = await db.Database
                .SqlQuery<bool>($"SELECT pg_try_advisory_xact_lock({LockKey}) AS \"Value\"")
                .SingleAsync(token);

            if (!acquired) return null;

            var batch = await RefreshDueAsync(db, now, token);

            // Nothing due, or IGDB did not answer readably: the transaction ends unwritten when it
            // is disposed, which releases the lock with it.
            if (batch.Asked == 0 || !batch.Answered) return batch;

            // On CancellationToken.None for the reason RefreshDueAsync saves on it.
            await transaction.CommitAsync(CancellationToken.None);
            return batch;
        }, cancellationToken);
    }

    /// <summary>
    /// Refreshes up to <see cref="GameCacheRefreshOptions.BatchSize"/> due rows with one IGDB
    /// request, and saves them.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Everything a batch does but take the lock and commit, apart from them so that the in-memory
    /// provider can run it: which rows, one request for all of them, a tombstone for an id IGDB
    /// no longer has, nothing written when IGDB does not answer, and a batch held back when it
    /// answers something this code cannot read.
    /// </para>
    /// <para>
    /// <b>The stopping token bounds the work and not the write</b> — what issue #96 asks of the
    /// retention sweep, done here from the start. Everything up to IGDB's answer runs on it, so a
    /// shutdown abandons the request and the transaction rolls back with nothing written. Once IGDB
    /// has answered, the request has been paid for, and cancelling the write would throw the answer
    /// away to ask for it again on another task a minute later — so the save, and the commit after
    /// it, run on <see cref="CancellationToken.None"/>, bounded by the database's own command
    /// timeout rather than by the signal to stop.
    /// </para>
    /// </remarks>
    internal async Task<Batch> RefreshDueAsync(
        ApplicationDbContext db, DateTimeOffset now, CancellationToken cancellationToken)
    {
        foreach (var released in heldBack.Where(held => held.Value <= now).Select(held => held.Key).ToList())
            heldBack.Remove(released);

        // Tracked, because these are the rows the answer is written onto.
        var rows = await GameCacheRefresh
            .NextBatch(db.CachedGames, now, options.Value.BatchSize, heldBack.Keys.ToList())
            .ToListAsync(cancellationToken);

        if (rows.Count == 0) return new Batch(0, Answered: true, 0, TimeSpan.Zero, null);

        var ids = rows.Select(row => row.GameId).ToList();
        var oldest = rows[0].RefreshedAt;
        var asked = clock.GetTimestamp();
        IReadOnlyList<GameDto> games;

        try
        {
            // Bounded on its own as well as by the stopping token: see IgdbWaitLimit.
            using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            limit.CancelAfter(IgdbWaitLimit);

            games = await igdb.GetGamesByIdsUncachedAsync(ids, limit.Token);
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested && IsUnanswered(ex))
        {
            // Nothing is written, so the rows keep the answer they had, stay due, and are first in
            // line on the next tick — which is right, because whatever this is fails every batch
            // alike.
            NoteUnanswered(ex, rows.Count, now);
            return new Batch(rows.Count, Answered: false, 0, clock.GetElapsedTime(asked), oldest);
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            // IGDB answered, and the answer could not be read: a field in a shape the model does not
            // expect, or a mapping that met a null. That may be one game's, and retrying it would
            // stop the whole queue behind it, so these rows wait an hour instead. An error, unlike
            // IGDB failing to answer, because the fix is ours.
            HoldBack(ids, now);

            logger.LogError(
                ex,
                "IGDB answered {Count} cached game(s) in a shape this code cannot read. They are held "
                + "back from the refresh until {Until} and left to their readers meanwhile: {Ids}.",
                ids.Count, now + HoldBackFor, string.Join(',', ids));

            return new Batch(rows.Count, Answered: false, 0, clock.GetElapsedTime(asked), oldest);
        }

        if (failingSince is { } since)
        {
            logger.LogInformation(
                "IGDB is answering the game cache refresh again, after failing since {Since}.", since);
            failingSince = null;
        }

        var took = clock.GetElapsedTime(asked);
        var answered = games.ToDictionary(game => game.Id);
        var stamp = clock.GetUtcNow();

        foreach (var row in rows)
            GameCacheService.Apply(row, answered.GetValueOrDefault(row.GameId), stamp);

        // From here the answer has been paid for. See the remarks above.
        try
        {
            await db.SaveChangesAsync(CancellationToken.None);
        }
        catch (DbUpdateException ex) when (IsRefusedWrite(ex))
        {
            // The answer was read, and the database would not store it: a title longer than its
            // column, a character PostgreSQL will not keep. As deterministic as an unreadable answer
            // and as able to stop the queue — the transaction rolls back unwritten and the batch is
            // the oldest thing due again — so it is held back the same way. Found by Copilot's review
            // of #256.
            HoldBack(ids, now);

            logger.LogError(
                ex,
                "The database refused what IGDB said about {Count} cached game(s). They are held back "
                + "from the refresh until {Until} and left to their readers meanwhile: {Ids}.",
                ids.Count, now + HoldBackFor, string.Join(',', ids));

            return new Batch(rows.Count, Answered: false, 0, took, oldest);
        }

        return new Batch(rows.Count, Answered: true, rows.Count(row => row.Payload is null), took, oldest);
    }

    private void HoldBack(IReadOnlyList<int> ids, DateTimeOffset now)
    {
        foreach (var id in ids) heldBack[id] = now + HoldBackFor;
    }

    /// <summary>
    /// Whether the database refused a write for what it held, rather than failing to take it at all.
    /// </summary>
    /// <remarks>
    /// PostgreSQL's class 22, data exceptions — a value too long for its column, a character it will
    /// not store — and class 23, integrity constraint violations. Both are refused the same way
    /// however often the same rows are written. Anything else — a dropped connection, a timeout, a
    /// row nobody can update any more — is a tick that failed, and the next one tries again.
    /// </remarks>
    internal static bool IsRefusedWrite(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: var state }
        && (state.StartsWith("22", StringComparison.Ordinal) || state.StartsWith("23", StringComparison.Ordinal));

    /// <summary>
    /// Whether a failure means IGDB could not be asked or did not answer, rather than that it
    /// answered something this code could not read.
    /// </summary>
    /// <remarks>
    /// What <c>UpstreamFailureHandler</c> and <c>UpstreamBusyHandler</c> already count as IGDB not
    /// answering — a host not reached, a broken circuit, a timeout, our own throttle — plus a body cut
    /// off mid-read, a cancellation that is not the host stopping (the client's own timeout, or
    /// <see cref="IgdbWaitLimit"/>), and <see cref="InvalidOperationException"/>, which is how
    /// <c>IgdbService</c> says its credentials are missing or its token unreadable. All of those fail
    /// every batch alike. Anything else was thrown reading an answer, and may be one game's.
    /// </remarks>
    internal static bool IsUnanswered(Exception exception) => exception
        is HttpRequestException
        or IOException
        or BrokenCircuitException
        or TimeoutRejectedException
        or RateLimiterRejectedException
        or OperationCanceledException
        or InvalidOperationException;

    /// <summary>
    /// Says that IGDB did not answer: a warning the first time, Debug for as long as it goes on,
    /// and one line when it answers again.
    /// </summary>
    /// <remarks>
    /// A warning a tick through an afternoon's outage — sixty an hour from every task, each with a
    /// stack trace — is the noise <see cref="BehindWarningEvery"/> exists to avoid. A failure that
    /// lasts is not lost: the rows go overdue, and <see cref="NoteLagAsync"/> says so hourly.
    /// </remarks>
    private void NoteUnanswered(Exception exception, int count, DateTimeOffset now)
    {
        if (failingSince is { } since)
        {
            logger.LogDebug(
                exception,
                "IGDB still did not answer for {Count} cached game(s), as since {Since}.", count, since);
            return;
        }

        failingSince = now;
        logger.LogWarning(
            exception,
            "IGDB did not answer for {Count} cached game(s); the next tick will ask again, and later "
            + "failures are logged at Debug until it answers.",
            count);
    }

    /// <summary>
    /// Counts the rows that say the refresh is behind, and warns while there are any.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Run on every tick, and on a tick that could not take the lock above all. That is the
    /// retention sweep's lesson: <c>pg_try_advisory_xact_lock</c> is false when <em>any</em> session
    /// holds the key, so a lock taken by hand or by tooling that left its connection open stops
    /// every task's refresh at once, and a job whose skip path simply returned would go quiet in
    /// exactly the way that matters. Counting what is waiting is what turns that into a warning.
    /// </para>
    /// <para>
    /// The retention sweep's own rule — warn after six skipped ticks with work waiting — does not
    /// carry over, because here work is almost always waiting: rows fall due a few at a time all
    /// day, and a task can skip a tick while another refreshes. What does not happen while the
    /// refresh keeps up is a row going <see cref="GameCacheRefresh.OverdueAfter"/> without being
    /// reached, so that is the signal, whatever the cause: the lock held by something that is not a
    /// refresh, IGDB failing for hours, a batch held back, or more rows falling due than the
    /// configured pace can take. The count is an index range over <c>RefreshedAt</c>, empty
    /// whenever the job is keeping up, so it costs next to nothing to ask each minute.
    /// </para>
    /// <para>
    /// Not in a task's first two hours — the time between a row falling due and going overdue — so
    /// a backlog the task inherited is not blamed on it; one that outlasts them is.
    /// </para>
    /// <para>
    /// A refresh that is behind is a warning and <b>never a <c>/readyz</c> failure</b>, as ADR 0038
    /// decided for the sweep: this instance serves every request perfectly well, with rows a little
    /// older, and taking it out of rotation would turn a stale cache into an outage.
    /// </para>
    /// </remarks>
    internal async Task NoteLagAsync(
        ApplicationDbContext db, DateTimeOffset now, bool lockedOut, CancellationToken cancellationToken)
    {
        var overdue = await db.CachedGames.CountAsync(GameCacheRefresh.OverdueAt(now), cancellationToken);

        if (overdue == 0)
        {
            if (warnedBehindAt is not null)
            {
                logger.LogInformation(
                    "Game cache refresh has caught up; no cached game is {OverdueHours} hours old any more.",
                    GameCacheRefresh.OverdueAfter.TotalHours);
                warnedBehindAt = null;
            }

            return;
        }

        if (now - startedAt < GameCacheRefresh.OverdueAfter - GameCacheRefresh.DueAfter)
        {
            logger.LogDebug(
                "Game cache refresh started at {StartedAt} and is working through {Count} cached "
                + "game(s) {OverdueHours} hours old.",
                startedAt, overdue, GameCacheRefresh.OverdueAfter.TotalHours);
            return;
        }

        if (warnedBehindAt is { } warned && now - warned < BehindWarningEvery)
        {
            logger.LogDebug(
                "Game cache refresh is still behind, with {Count} cached game(s) {OverdueHours} hours old.",
                overdue, GameCacheRefresh.OverdueAfter.TotalHours);
            return;
        }

        var oldest = await db.CachedGames.MinAsync(game => game.RefreshedAt, cancellationToken);

        if (lockedOut)
        {
            logger.LogWarning(
                "Game cache refresh is behind: {Count} cached game(s) were last refreshed more than "
                + "{OverdueHours} hours ago, the oldest at {Oldest}, and this tick could not take its "
                + "advisory lock on {LockKey}. If no other task is refreshing them, something else "
                + "holds that lock.",
                overdue, GameCacheRefresh.OverdueAfter.TotalHours, oldest, LockKey);
        }
        else
        {
            logger.LogWarning(
                "Game cache refresh is behind: {Count} cached game(s) were last refreshed more than "
                + "{OverdueHours} hours ago, the oldest at {Oldest}. IGDB may not have been answering, "
                + "or more rows fall due than a batch of {BatchSize} every {Interval} can take; "
                + "{HeldBack} cached game(s) are held back after an answer this code could not read. "
                + "See ADR 0052.",
                overdue, GameCacheRefresh.OverdueAfter.TotalHours, oldest,
                options.Value.BatchSize, options.Value.Interval, heldBack.Count);
        }

        // Only once the warning is written, so a failure to write it does not silence it for an hour.
        warnedBehindAt = now;
    }
}
