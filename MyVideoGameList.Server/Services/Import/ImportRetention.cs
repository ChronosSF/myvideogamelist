using System.Linq.Expressions;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// Which import jobs have outlived their usefulness, and for how long each kind is kept.
/// </summary>
/// <remarks>
/// <para>
/// Separated from the service that runs the deletion so that the <em>decision</em> is testable
/// while the plumbing is not. The predicate below is an expression rather than a delegate, so the
/// sweep translates it to SQL and the tests run the identical expression against the in-memory
/// provider — the two cannot drift, which they would if the test restated the rule.
/// </para>
/// <para>
/// Nothing here deletes <c>ImportRows</c>. A row reaches its job through a foreign key declared
/// <c>ON DELETE CASCADE</c>, so PostgreSQL removes them with the job and a second statement would
/// be both redundant and a chance to get the order wrong. In practice only a <em>pending</em> job
/// still has any: closing one deletes its rows in the same transaction, so what the cascade
/// actually catches is the abandoned review nobody came back to.
/// </para>
/// </remarks>
internal static class ImportRetention
{
    /// <summary>
    /// How long a finished job is kept after it finished. <c>specs/csv-list-import.md</c> §S9.
    /// </summary>
    /// <remarks>
    /// <para>
    /// By this point a closed job is one small row and nothing else — the commit or the cancel that
    /// closed it deleted its <c>ImportRow</c>s — so these seven days keep a receipt: which file was
    /// imported, when, how many games went in and how many were passed over. That is exactly what
    /// <c>/import</c> lists, and it is the only thing left to keep.
    /// </para>
    /// <para>
    /// Nothing here is anybody's only copy of anything. The uploaded file was never stored, the
    /// games are in their lists, and the per-row failure report §C5 promises travels in the commit's
    /// own response rather than being persisted — so it is already gone when the tab closes, with
    /// or without this window.
    /// </para>
    /// </remarks>
    public static readonly TimeSpan KeepCompleted = TimeSpan.FromDays(7);

    /// <summary>
    /// How long a job nobody ever finished reviewing is kept.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Not in §S9, which only covers "7 days after completion".</b> A job that is never
    /// committed or cancelled has no completion, so under that rule alone it would live for ever —
    /// and worse than the storage that implies, it would hold one of the three
    /// <c>ImportService.MaxPendingJobs</c> slots indefinitely. Three abandoned uploads and that
    /// account cannot import again until it goes back and cancels one, which is a harder failure
    /// than the one the retention rule was written to prevent.
    /// </para>
    /// <para>
    /// Longer than <see cref="KeepCompleted"/> because the two mean different things: a finished
    /// job is a receipt, while a pending one is work somebody may still intend to come back to.
    /// Deleting it costs them the decisions they had already made — the resolved shelves, the
    /// games they picked — which re-uploading does not give back.
    /// </para>
    /// <para>
    /// Measured from <see cref="ImportJob.UpdatedAt"/> — the last time its owner saved a decision —
    /// and <b>not</b> from the upload, so this is a window of silence rather than a deadline to
    /// finish by. A review worked through over three weekends survives; one nobody ever came back
    /// to does not, which is the only case the window is for. Running it from
    /// <see cref="ImportJob.CreatedAt"/> would delete a job mid-review along with every decision
    /// already made on it, which is precisely what the paragraph above says it must not do.
    /// </para>
    /// <para>
    /// A fortnight, so that "I will finish this at the weekend" is respected twice over while the
    /// slot still frees on a human timescale. The exact number is a judgement; what is not is that
    /// it must exceed <see cref="KeepCompleted"/>, which has a test of its own.
    /// </para>
    /// </remarks>
    public static readonly TimeSpan KeepAbandoned = TimeSpan.FromDays(14);

    /// <summary>
    /// The jobs that should no longer exist at <paramref name="now"/>.
    /// </summary>
    /// <remarks>
    /// Two clauses rather than one, keyed on whether the job ever completed. <c>CompletedAt</c> is
    /// set when a job reaches <c>done</c> or <c>cancelled</c> and is null while it is pending, so it
    /// is the discriminator — and, for a closed job, the clock as well. A pending job is measured
    /// from <c>UpdatedAt</c>, which every saved decision moves; neither clause reads
    /// <c>CreatedAt</c>, because when the file was uploaded says nothing about whether anybody
    /// still wants what came out of it.
    /// </remarks>
    public static Expression<Func<ImportJob, bool>> ExpiredAt(DateTimeOffset now)
    {
        var finishedBefore = now - KeepCompleted;
        var silentSince = now - KeepAbandoned;

        return job =>
            (job.CompletedAt != null && job.CompletedAt < finishedBefore)
            || (job.CompletedAt == null && job.UpdatedAt < silentSince);
    }
}
