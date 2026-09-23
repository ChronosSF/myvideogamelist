using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;

namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// Deletes import jobs that have outlived their retention, on a schedule.
/// </summary>
/// <remarks>
/// <para>
/// <b>The first background job in this application</b>, so it is also the shape later ones should
/// follow. Everything else here is request-scoped — a user acts, a controller handles it, a scoped
/// service writes. A retention sweep has no request behind it, which is the whole reason it is a
/// class of its own rather than a method on <see cref="ImportService"/>.
/// See <c>docs/decisions/0038-*</c>.
/// </para>
/// <para>
/// Three things about hosted services that are easy to get wrong and are all load-bearing here:
/// </para>
/// <list type="number">
/// <item>
/// A <see cref="BackgroundService"/> is a <b>singleton</b>, so it cannot take
/// <see cref="ApplicationDbContext"/> by constructor injection — that is scoped, and capturing one
/// for the process lifetime is how a context ends up shared across threads and grows a change
/// tracker for ever. It takes <see cref="IServiceScopeFactory"/> and makes a scope per sweep.
/// </item>
/// <item>
/// An exception escaping <c>ExecuteAsync</c> <b>ends the service for the lifetime of the
/// process</b>, silently. So the loop catches per tick: a sweep that fails is logged and retried
/// on the next one, because the next one is an hour away and nothing depends on this having run.
/// </item>
/// <item>
/// Several ECS tasks each run their own copy, so the sweep has to be safe to run N times at once.
/// See <see cref="SweepAsync"/>.
/// </item>
/// </list>
/// </remarks>
internal sealed class ImportRetentionService(
    IServiceScopeFactory scopeFactory,
    TimeProvider clock,
    ILogger<ImportRetentionService> logger) : BackgroundService
{
    /// <summary>
    /// How often the sweep runs. Coarse on purpose: the shortest retention is seven days, so the
    /// difference between sweeping hourly and sweeping every minute is invisible, and the cheaper
    /// one is the one that does not wake a pool connection sixty times as often.
    /// </summary>
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    /// <summary>
    /// The advisory lock this sweep serialises on. An arbitrary constant, and only its uniqueness
    /// within this database matters — anything else taking the same number would exclude itself
    /// against this for no reason, so it is declared here rather than inline.
    /// </summary>
    private const long LockKey = 0x4D56474C_494D_5054;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Once at startup and then on the timer, rather than waiting an hour for the first sweep.
        // A task that has just restarted is exactly when a backlog is most likely to exist, and
        // the concurrency guard below makes a fleet-wide deploy sweeping at once a non-event.
        await RunOnceAsync(stoppingToken);

        using var timer = new PeriodicTimer(Interval, clock);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RunOnceAsync(stoppingToken);
        }
    }

    private async Task RunOnceAsync(CancellationToken stoppingToken)
    {
        try
        {
            await SweepAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down, which is not a failure.
            throw;
        }
        catch (Exception e)
        {
            // Swallowed deliberately: letting this reach ExecuteAsync would stop the service for
            // the rest of the process's life, and a missed sweep costs nothing that the next one
            // does not fix.
            logger.LogError(e, "Import retention sweep failed; it will be retried on the next tick.");
        }
    }

    /// <summary>
    /// One pass: take the lock, delete what has expired, commit.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Several tasks run this at the same moment, and the deletion is idempotent, so correctness
    /// never depended on the lock — what it buys is that the work is done once rather than N times
    /// against a predicate that cannot use an index. <c>pg_try_advisory_xact_lock</c> rather than
    /// the session-scoped <c>pg_try_advisory_lock</c>, which is the trap: a session lock is held
    /// until it is released or the connection closes, and with pooling the "session" is a pooled
    /// connection that goes back into the pool still holding it. The transaction-scoped one is
    /// released by the commit whatever happens.
    /// </para>
    /// <para>
    /// <c>ExecuteDeleteAsync</c>, so the rows never enter the change tracker. The job's
    /// <c>ImportRows</c> go with it through the foreign key's <c>ON DELETE CASCADE</c> — a raw
    /// <c>DELETE</c> is exactly what that constraint is there to catch.
    /// </para>
    /// <para>
    /// No index supports the predicate, deliberately. It is an <c>OR</c> across two nullable
    /// columns, which does not index cleanly without two partial indexes, and the table it scans is
    /// kept small by this very sweep. Revisit if it ever appears in a slow query log.
    /// </para>
    /// </remarks>
    private async Task SweepAsync(CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // The column must be called `Value`: SqlQuery<T> wraps this as a subquery and projects
        // `s.Value` from it, so an unaliased `SELECT pg_try_advisory_xact_lock(...)` fails at
        // runtime with `column s.Value does not exist` — and fails into the log rather than
        // loudly, because the loop above catches. Verified against a real PostgreSQL, which is
        // the only way this was ever going to be found.
        var acquired = await db.Database
            .SqlQuery<bool>($"SELECT pg_try_advisory_xact_lock({LockKey}) AS \"Value\"")
            .SingleAsync(cancellationToken);

        // Somebody else is sweeping. Nothing to wait for — they are deleting the same rows.
        if (!acquired) return;

        var deleted = await db.ImportJobs
            .Where(ImportRetention.ExpiredAt(clock.GetUtcNow()))
            .ExecuteDeleteAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        // Only when it did something. An hourly log line saying "deleted 0" is noise that teaches
        // people to stop reading the log.
        if (deleted > 0)
            logger.LogInformation("Import retention deleted {JobCount} expired job(s).", deleted);
    }
}
