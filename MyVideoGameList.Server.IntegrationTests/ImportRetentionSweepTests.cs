using System.Collections.Concurrent;
using System.Data.Common;
using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Import;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The retention sweep, run as the host runs it, against PostgreSQL: the two windows translated to
/// SQL, the batched <c>ExecuteDeleteAsync</c> with a commit after each batch, the cascade to the
/// rows, and the advisory lock — what ADR 0038 §3 and §4 could only verify by hand, because the
/// in-memory provider cannot execute a set-based delete at all.
/// </summary>
/// <remarks>
/// <para>
/// Through <c>StartAsync</c>, as the host starts it, so the sweep that runs is the one at startup
/// with nothing of it called by hand. That matters for the failure ADR 0038 records: the first
/// version's lock query failed at runtime, inside the loop's catch, so it passed every test and
/// failed into the log. A test of the sweep therefore has to read the log too.
/// </para>
/// <para>
/// The factory removes the application's own sweep, so nothing deletes under the other classes'
/// tests; each test here starts one of its own and stops it again. Not covered: the warning a
/// sixth blocked tick running gives, which needs six hours or a clock this does not fake, and the
/// execution strategy, which never retries until <c>Program.cs</c> configures one that does.
/// </para>
/// </remarks>
public class ImportRetentionSweepTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Sweep_JobsEitherSideOfTheirWindows_DeletesTheExpiredWithTheirRowsAndKeepsTheRest()
    {
        var now = DateTimeOffset.UtcNow;
        var userId = await RegisterAsync("sweeper");

        // The two windows (ADR 0038 §2), with a job either side of each: a week from completion, a
        // fortnight of silence otherwise.
        var receipt = Job(userId, ImportJobStates.Done, updated: now.AddDays(-8), completed: now.AddDays(-8));
        var recentReceipt = Job(userId, ImportJobStates.Cancelled, updated: now.AddDays(-3), completed: now.AddDays(-3));
        var abandoned = Job(userId, ImportJobStates.Pending, updated: now.AddDays(-15), rows: 3);
        var quiet = Job(userId, ImportJobStates.Pending, updated: now.AddDays(-10), rows: 1);

        // Uploaded long ago but worked on two days ago: the window is silence, not a deadline.
        var workedOn = Job(userId, ImportJobStates.Pending, updated: now.AddDays(-2), created: now.AddDays(-40), rows: 2);

        await SeedAsync(receipt, recentReceipt, abandoned, quiet, workedOn);

        await SweepAsync(async (_, db) => !await db.ImportJobs.AnyAsync(
            job => job.Id == abandoned.Job.Id || job.Id == receipt.Job.Id));

        await using var after = api.Database();
        Assert.Equal(
            new[] { recentReceipt.Job.Id, quiet.Job.Id, workedOn.Job.Id }.Order(),
            (await after.ImportJobs.Where(job => job.UserId == userId).Select(job => job.Id).ToListAsync()).Order());

        // The sweep never names ImportRows: the abandoned job's went through the foreign key.
        Assert.Equal(
            new[] { quiet.Job.Id, workedOn.Job.Id, workedOn.Job.Id }.Order(),
            (await after.ImportRows.Where(row => row.UserId == userId).Select(row => row.ImportJobId).ToListAsync()).Order());
    }

    [Fact]
    public async Task Sweep_ABacklogOfSeveralBatches_DeletesTwentyFiveAStatementAndCommitsEach()
    {
        // ADR 0038 §4: one unbounded DELETE over a backlog outlives the command timeout and deletes
        // nothing, for ever. So sixty is two full batches and a short one, each committed before
        // the next begins, which is what lets a pass that cannot finish still make progress.
        var now = DateTimeOffset.UtcNow;
        var userId = await RegisterAsync("backlog");

        await SeedAsync(Enumerable.Range(0, 60)
            .Select(i => Job(userId, ImportJobStates.Pending, updated: now.AddDays(-20).AddMinutes(i), rows: 1))
            .ToArray());

        var pass = await SweepAsync(async (_, db) => !await db.ImportJobs.AnyAsync(job => job.UserId == userId));

        Assert.Equal(
            ["delete 25", "commit", "delete 25", "commit", "delete 10", "commit"],
            pass.Statements);

        await using var after = api.Database();
        Assert.False(await after.ImportRows.AnyAsync(row => row.UserId == userId));
    }

    [Fact]
    public async Task Sweep_WhileAnotherSessionHoldsItsLock_DeletesNothing()
    {
        // ADR 0038 §3: one task sweeps and the rest step aside, on a transaction-scoped advisory
        // lock. Held here from a session of its own, as a second task's sweep would hold it.
        var userId = await RegisterAsync("blocked");
        var expired = Job(userId, ImportJobStates.Pending, updated: DateTimeOffset.UtcNow.AddDays(-20), rows: 1);
        await SeedAsync(expired);

        // Let go of when the test ends, before the next one sweeps.
        await using var holder = await AdvisoryLockHolder.TakeAsync(api.ConnectionString, ImportRetentionService.LockKey);

        // The pass that cannot take the lock says so, and only at its end.
        var pass = await SweepAsync((logged, _) => Task.FromResult(logged.Logged.Any(entry =>
            entry.Message.Contains("skipped a tick") || entry.Level >= LogLevel.Information)));

        Assert.DoesNotContain(pass.Statements, statement => statement.StartsWith("delete"));
        await using var after = api.Database();
        Assert.True(await after.ImportJobs.AnyAsync(job => job.Id == expired.Job.Id));
    }

    [Fact]
    public async Task Sweep_StoppedTheMomentAFullBatchIsDeleted_CommitsItLogsItAndStartsNoOther()
    {
        // #96 (ADR 0038 §4): the stopping token bounds the work, never the commit that keeps it.
        // The host's stop lands between a full batch's DELETE and its commit, through StopAsync as
        // a SIGTERM's would. On the stopping token Npgsql refused to send that COMMIT, so the
        // finished batch rolled back and every one of these survived to be deleted again. Exactly
        // one batch, and older than anything another test leaves, so the batch is these and the
        // test leaves nothing behind for the next.
        var now = DateTimeOffset.UtcNow;
        var userId = await RegisterAsync("stopped");
        await SeedAsync(Enumerable.Range(0, ImportRetentionService.BatchSize)
            .Select(i => Job(userId, ImportJobStates.Pending, updated: now.AddDays(-20),
                created: now.AddDays(-400).AddMinutes(i), rows: 1))
            .ToArray());

        var log = new RecordingLogger<ImportRetentionService>();
        var stopped = new TaskCompletionSource<Task>(TaskCreationOptions.RunContinuationsAsynchronously);
        ImportRetentionService? sweep = null;
        var recorder = new Statements(onDelete: () => stopped.TrySetResult(sweep!.StopAsync(CancellationToken.None)));

        await using var scopes = new ServiceCollection()
            .AddDbContext<ApplicationDbContext>(options => options
                .UseNpgsql(api.ConnectionString)
                .AddInterceptors(recorder))
            .BuildServiceProvider();

        sweep = new ImportRetentionService(
            scopes.GetRequiredService<IServiceScopeFactory>(), TimeProvider.System, log);

        await sweep.StartAsync(CancellationToken.None);

        try
        {
            if (await Task.WhenAny(stopped.Task, Task.Delay(TimeSpan.FromSeconds(15))) != stopped.Task)
                Assert.Fail($"The sweep deleted nothing within 15 seconds. It logged: {Logged(log)}");

            await (await stopped.Task).WaitAsync(TimeSpan.FromSeconds(15));
        }
        finally
        {
            // A second stop is a no-op once the first has finished; this one is for a failure above.
            await sweep.StopAsync(CancellationToken.None);
        }

        // The batch committed after the stop and was logged, and no other DELETE followed it.
        Assert.Equal([$"delete {ImportRetentionService.BatchSize}", "commit"], recorder.Events);
        Assert.Contains(log.Entries, entry => entry.Level == LogLevel.Information
            && entry.Message == $"Import retention deleted {ImportRetentionService.BatchSize} expired job(s).");
        Assert.DoesNotContain(log.Entries, entry => entry.Level >= LogLevel.Warning);

        await using var after = api.Database();
        Assert.False(await after.ImportJobs.AnyAsync(job => job.UserId == userId));
        Assert.False(await after.ImportRows.AnyAsync(row => row.UserId == userId));
    }

    private sealed record Seeded(ImportJob Job, IReadOnlyList<ImportRow> Rows);

    /// <summary>What one sweep logged, and what its context did: each delete and each commit, in order.</summary>
    private sealed record Pass(
        IReadOnlyList<RecordingLogger<ImportRetentionService>.Entry> Logged,
        IReadOnlyList<string> Statements);

    private async Task<string> RegisterAsync(string prefix)
    {
        using var browser = api.CreateBrowser();
        return (await browser.RegisterAsync(Browsers.NewUserName(prefix))).Id;
    }

    /// <summary>
    /// A job with the clock columns a test needs, written straight to the table: the API stamps
    /// every one of them with the real time, which is exactly what a retention test cannot use.
    /// </summary>
    private static Seeded Job(
        string userId,
        string state,
        DateTimeOffset updated,
        DateTimeOffset? completed = null,
        DateTimeOffset? created = null,
        int rows = 0)
    {
        var job = new ImportJob
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Source = ImportSources.Grouvee,
            FileName = "grouvee.json",
            State = state,
            RowCount = rows,
            CreatedAt = created ?? updated,
            UpdatedAt = updated,
            CompletedAt = completed
        };

        return new Seeded(job, Enumerable.Range(1, rows)
            .Select(i => new ImportRow
            {
                UserId = userId,
                ImportJobId = job.Id,
                Title = $"Game {i}",
                GameId = i,
                MatchKind = ImportMatchKinds.Matched,
                Decision = ImportDecisions.Import,
                Payload = "{}"
            })
            .ToList());
    }

    private async Task SeedAsync(params Seeded[] seeded)
    {
        await using var db = api.Database();
        db.ImportJobs.AddRange(seeded.Select(s => s.Job));
        db.ImportRows.AddRange(seeded.SelectMany(s => s.Rows));
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Starts a sweep the way the host does, waits until <paramref name="done"/> holds, and stops it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The sweep's scopes get a context configured as <c>Program.cs</c> configures one, with a
    /// recorder on it, which is how a test sees the statements rather than only their outcome.
    /// </para>
    /// <para>
    /// Waiting on the database where it can, so a sentence reworded in the service cannot make
    /// this read the tables before the sweep has run. What it logged is checked either way: a
    /// failed pass is caught by the loop and written to the log, and nothing else says so.
    /// </para>
    /// </remarks>
    private async Task<Pass> SweepAsync(Func<Pass, ApplicationDbContext, Task<bool>> done)
    {
        var log = new RecordingLogger<ImportRetentionService>();
        var recorder = new Statements();

        await using var scopes = new ServiceCollection()
            .AddDbContext<ApplicationDbContext>(options => options
                .UseNpgsql(api.ConnectionString)
                .AddInterceptors(recorder))
            .BuildServiceProvider();

        var sweep = new ImportRetentionService(
            scopes.GetRequiredService<IServiceScopeFactory>(), TimeProvider.System, log);

        await sweep.StartAsync(CancellationToken.None);

        try
        {
            var waited = Stopwatch.StartNew();

            while (true)
            {
                await using (var db = api.Database())
                {
                    if (await done(new Pass(log.Entries, recorder.Events), db)) break;
                }

                // A pass that deletes too little says nothing at all, so the clock bounds the wait.
                // Each pass here finishes in well under a second.
                if (log.Entries.Any(entry => entry.Level >= LogLevel.Warning))
                    Assert.Fail($"The sweep failed. It logged: {Logged(log)}");

                if (waited.Elapsed > TimeSpan.FromSeconds(15))
                    Assert.Fail($"The sweep had not finished within 15 seconds. It logged: {Logged(log)}");

                await Task.Delay(50);
            }
        }
        finally
        {
            await sweep.StopAsync(CancellationToken.None);
        }

        Assert.DoesNotContain(log.Entries, entry => entry.Level >= LogLevel.Warning);
        return new Pass(log.Entries, recorder.Events);
    }

    private static string Logged(RecordingLogger<ImportRetentionService> log) =>
        string.Join(" | ", log.Entries.Select(entry => $"{entry.Level}: {entry.Message} {entry.Exception}"));

    /// <summary>
    /// Each <c>DELETE</c> of jobs with how many it took, and each commit, in the order the sweep's
    /// context ran them; <paramref name="onDelete"/>, when given, runs as each <c>DELETE</c> returns.
    /// </summary>
    private sealed class Statements(Action? onDelete = null) : DbCommandInterceptor, IDbTransactionInterceptor
    {
        private readonly ConcurrentQueue<string> events = new();

        public IReadOnlyList<string> Events => events.ToArray();

        public override ValueTask<int> NonQueryExecutedAsync(
            DbCommand command,
            CommandExecutedEventData eventData,
            int result,
            CancellationToken cancellationToken = default)
        {
            if (command.CommandText.StartsWith("DELETE FROM \"ImportJobs\"", StringComparison.Ordinal))
            {
                events.Enqueue($"delete {result}");
                onDelete?.Invoke();
            }

            return ValueTask.FromResult(result);
        }

        public Task TransactionCommittedAsync(
            DbTransaction transaction,
            TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            events.Enqueue("commit");
            return Task.CompletedTask;
        }
    }
}
