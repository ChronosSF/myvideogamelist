using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Import;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The retention sweep, run as the host runs it, against PostgreSQL: the advisory lock, the
/// batched <c>ExecuteDeleteAsync</c> and the cascade to the rows — everything ADR 0038 could only
/// verify by hand, because the in-memory provider cannot execute a set-based delete at all.
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
/// tests; each test here starts one of its own and stops it again.
/// </para>
/// </remarks>
public class ImportRetentionSweepTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Sweep_DeletesExpiredJobsWithTheirRows_AndKeepsEveryJobStillInsideItsWindow()
    {
        var now = DateTimeOffset.UtcNow;
        var userId = await RegisterAsync("sweeper");

        // The two windows (ADR 0038 §2): a week from completion, a fortnight of silence otherwise.
        var abandoned = Job(userId, ImportJobStates.Pending, updated: now.AddDays(-15), rows: 3);
        var receipt = Job(userId, ImportJobStates.Done, updated: now.AddDays(-8), completed: now.AddDays(-8));
        var recentReceipt = Job(userId, ImportJobStates.Cancelled, updated: now.AddDays(-3), completed: now.AddDays(-3));

        // Uploaded long ago but worked on two days ago: the window is silence, not a deadline.
        var workedOn = Job(userId, ImportJobStates.Pending, updated: now.AddDays(-2), created: now.AddDays(-40), rows: 2);

        await SeedAsync(abandoned, receipt, recentReceipt, workedOn);

        await SweepUntilAsync(async db => !await db.ImportJobs.AnyAsync(
            job => job.Id == abandoned.Job.Id || job.Id == receipt.Job.Id));

        await using var after = api.Database();
        Assert.Equal(
            new[] { recentReceipt.Job.Id, workedOn.Job.Id }.Order(),
            (await after.ImportJobs.Where(job => job.UserId == userId).Select(job => job.Id).ToListAsync()).Order());

        // The sweep never names ImportRows: the abandoned job's went through the foreign key.
        Assert.Equal(
            [workedOn.Job.Id, workedOn.Job.Id],
            await after.ImportRows.Where(row => row.UserId == userId).Select(row => row.ImportJobId).ToListAsync());
    }

    [Fact]
    public async Task Sweep_ABacklogOfSeveralBatches_IsDeletedInFullByOnePass()
    {
        // Twenty-five jobs a statement, each batch committed (ADR 0038 §4), so sixty is two full
        // batches and a short one, and a pass that stopped after the first would leave thirty-five.
        var now = DateTimeOffset.UtcNow;
        var userId = await RegisterAsync("backlog");

        await SeedAsync(Enumerable.Range(0, 60)
            .Select(i => Job(userId, ImportJobStates.Pending, updated: now.AddDays(-20).AddMinutes(i), rows: 1))
            .ToArray());

        await SweepUntilAsync(async db => !await db.ImportJobs.AnyAsync(job => job.UserId == userId));

        await using var after = api.Database();
        Assert.False(await after.ImportRows.AnyAsync(row => row.UserId == userId));
    }

    private sealed record Seeded(ImportJob Job, IReadOnlyList<ImportRow> Rows);

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
    /// Starts a sweep the way the host does, waits until <paramref name="swept"/> holds, and stops it.
    /// </summary>
    /// <remarks>
    /// Waiting on the database rather than on a log line, so a sentence reworded in the service
    /// cannot make this read the tables before the sweep has run. What it logged is still checked:
    /// a sweep that failed is caught by the loop and written to the log, and nothing else says so.
    /// </remarks>
    private async Task SweepUntilAsync(Func<Data.ApplicationDbContext, Task<bool>> swept)
    {
        var log = new RecordingLogger<ImportRetentionService>();
        var sweep = new ImportRetentionService(
            api.Services.GetRequiredService<IServiceScopeFactory>(), TimeProvider.System, log);

        await sweep.StartAsync(CancellationToken.None);

        try
        {
            var waited = Stopwatch.StartNew();

            while (true)
            {
                await using (var db = api.Database())
                {
                    if (await swept(db)) break;
                }

                // A failed pass is logged and swallowed, so the log is the only place it shows; and
                // a pass that deletes too little says nothing at all, so the clock bounds the wait.
                // Each pass here deletes in well under a second.
                if (log.Entries.Any(entry => entry.Level >= LogLevel.Warning))
                    Assert.Fail($"The sweep failed. It logged: {Logged(log)}");

                if (waited.Elapsed > TimeSpan.FromSeconds(15))
                    Assert.Fail($"The sweep had not deleted what it should within 15 seconds. It logged: {Logged(log)}");

                await Task.Delay(50);
            }
        }
        finally
        {
            await sweep.StopAsync(CancellationToken.None);
        }

        Assert.DoesNotContain(log.Entries, entry => entry.Level >= LogLevel.Warning);
    }

    private static string Logged(RecordingLogger<ImportRetentionService> log) =>
        string.Join(" | ", log.Entries.Select(entry => $"{entry.Level}: {entry.Message} {entry.Exception}"));
}
