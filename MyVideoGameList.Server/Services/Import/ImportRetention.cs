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
/// be both redundant and a chance to get the order wrong.
/// </para>
/// </remarks>
internal static class ImportRetention
{
    /// <summary>
    /// How long a finished job is kept after it finished. <c>specs/csv-list-import.md</c> §S9.
    /// </summary>
    /// <remarks>
    /// Long enough that somebody can come back to the result summary and the list of rows that did
    /// not import, which is the only thing a closed job is still good for. The uploaded file was
    /// never stored, so nothing here is the user's only copy of anything.
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
    /// set when a job reaches <c>done</c> or <c>cancelled</c> and is null while it is pending, so
    /// it is both the discriminator and the clock for the first clause.
    /// </remarks>
    public static Expression<Func<ImportJob, bool>> ExpiredAt(DateTimeOffset now)
    {
        var finishedBefore = now - KeepCompleted;
        var startedBefore = now - KeepAbandoned;

        return job =>
            (job.CompletedAt != null && job.CompletedAt < finishedBefore)
            || (job.CompletedAt == null && job.CreatedAt < startedBefore);
    }
}
