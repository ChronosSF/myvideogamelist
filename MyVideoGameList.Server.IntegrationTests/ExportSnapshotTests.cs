using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The data export reads one snapshot (#95), so a write committing while it runs cannot leave the
/// document contradicting itself.
/// </summary>
/// <remarks>
/// <para>
/// The case that was found: the retention sweep deletes a pending import between the export's read
/// of <c>importJobs</c> and its read of <c>importRows</c>, and the document then lists a job that
/// claims rows it does not carry. Made to happen here, at exactly that moment, by an interceptor on
/// the export's own context: when the command that reads <c>"ImportRows"</c> is about to run, a
/// second context deletes the job and commits — the shape of the race tests' competing writes. A
/// delete before the job is read gives a consistent document whatever the isolation, which is why
/// the moment matters.
/// </para>
/// <para>
/// No in-memory provider has isolation to test, so this is the only place the snapshot can be
/// seen holding.
/// </para>
/// </remarks>
public class ExportSnapshotTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    [Fact(Skip = "Fails until #263 (the fix for #95) is merged: the export reads each section at its own "
        + "moment on master, which is the bug this pins. Delete this Skip in whichever of #263 and the "
        + "pull request adding this test is merged second.")]
    public async Task ExportAsync_AJobDeletedAfterItIsReadButBeforeItsRows_ArrivesWithEveryRowItCounts()
    {
        using var browser = api.CreateBrowser();
        var user = await browser.RegisterAsync(Browsers.NewUserName("exporter"));
        var job = await browser.UploadGrouveeAsync(1020, 1021, 1022);
        Assert.Equal(ImportJobStates.Pending, job.State);
        Assert.Equal(3, job.RowCount);

        var competingDelete = new BeforeTheRowsAreRead(async () =>
        {
            await using var sweep = api.Database();
            await sweep.ImportJobs.Where(j => j.Id == job.Id).ExecuteDeleteAsync();
        });

        await using var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseNpgsql(api.ConnectionString)
            .AddInterceptors(competingDelete)
            .Options);

        var document = await new UserDataExporter(db, TimeProvider.System).ExportAsync(user.Id, CancellationToken.None);

        // The race happened: the job is gone from the table, after the export had begun.
        Assert.Equal(1, competingDelete.Fired);
        await using (var after = api.Database())
        {
            Assert.False(await after.ImportJobs.AnyAsync(j => j.Id == job.Id));
        }

        // And the document is of one moment: the job, and every row it says it has.
        var exported = Assert.Single(document.ImportJobs, j => j.Id == job.Id);
        Assert.All(
            document.ImportJobs.Where(j => j.State == ImportJobStates.Pending),
            pending => Assert.Equal(pending.RowCount, document.ImportRows.Count(row => row.JobId == pending.Id)));
        Assert.Equal(3, exported.RowCount);
    }

    /// <summary>
    /// Runs a competing write, once, just before the export's context reads <c>"ImportRows"</c>.
    /// </summary>
    private sealed class BeforeTheRowsAreRead(Func<Task> competingWrite) : DbCommandInterceptor
    {
        public int Fired { get; private set; }

        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            if (Fired == 0 && command.CommandText.Contains("FROM \"ImportRows\""))
            {
                Fired++;
                await competingWrite();
            }

            return result;
        }
    }
}
