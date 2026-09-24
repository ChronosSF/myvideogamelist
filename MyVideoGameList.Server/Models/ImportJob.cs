namespace MyVideoGameList.Server.Models;

/// <summary>
/// The stable keys of the services an import can read. One per preset.
/// </summary>
/// <remarks>
/// <para>
/// Open by construction, exactly as <see cref="EntryOrigins"/> is and for the same reason: the
/// design's whole promise is that a new service is data rather than code (ADR 0037), so the set
/// grows and neither column carries a check constraint.
/// </para>
/// <para>
/// A value here is written into <see cref="UserGameEntry.Origin"/> on every row the import creates,
/// so it is permanent once used — renaming one would relabel somebody's library.
/// </para>
/// </remarks>
public static class ImportSources
{
    /// <summary>Grouvee's account export, in either the JSON or the CSV form.</summary>
    public const string Grouvee = "grouvee";
}

/// <summary>
/// The states an import passes through.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately shorter than <c>specs/csv-list-import.md</c> §S1 proposed. That list assumed a
/// column-mapping step and a background matching step, and Grouvee needs neither: the export is a
/// structured document rather than a table to be mapped, and it carries IGDB ids rather than titles
/// to be matched (ADR 0037). Adding <c>mapping</c> or <c>matching</c> back for a preset that needs
/// them is additive, which is why this is a string.
/// </para>
/// <para>
/// There is no <c>committing</c> and no <c>failed</c>, because neither would ever be read. A commit
/// is one transaction, so a job cannot be observed part way through one, and a commit that throws
/// rolls back to <see cref="Pending"/> rather than landing anywhere new. A file that fails to parse
/// never becomes a job at all — the upload answers 400 and writes nothing.
/// </para>
/// </remarks>
public static class ImportJobStates
{
    /// <summary>Parsed and waiting for its owner to review it. Every job starts here.</summary>
    public const string Pending = "pending";

    /// <summary>Committed. The counts on the job are the record of what happened.</summary>
    public const string Done = "done";

    /// <summary>Abandoned by its owner without being committed.</summary>
    public const string Cancelled = "cancelled";
}

/// <summary>
/// One upload of one file by one user, and the review of it that follows.
/// </summary>
/// <remarks>
/// <para>
/// The job exists so that reviewing an import survives the request that uploaded the file, and so
/// that somebody can close the tab and come back to it. The file itself is never persisted: it is
/// parsed into <see cref="ImportRow"/>s and dropped, because keeping a copy of somebody's library
/// export earns nothing and is one more thing to leak.
/// </para>
/// <para>
/// The counts are stored rather than derived, because the rows do not outlive the review at all:
/// the commit or the cancel that closes a job deletes its <see cref="ImportRow"/>s in the same
/// transaction, so by the time anybody reads a closed job there is nothing left to count. This row
/// is then the whole of what that import is, which is why <c>GetReviewAsync</c> refuses a job that
/// is not pending rather than serving an empty review of one.
/// </para>
/// </remarks>
public class ImportJob
{
    /// <summary>
    /// A UUID rather than a sequence, because this is the one key of ours that a user puts in a
    /// URL. Scoping every read to the owner is still what enforces access — a guessed id belongs
    /// to nobody the query will match — but a sequence would additionally publish how many imports
    /// the site has run, and adjacency between two accounts' jobs is not a fact worth giving away.
    /// </summary>
    public Guid Id { get; set; }

    public required string UserId { get; set; }

    /// <summary>One of <see cref="ImportSources"/> — which service's export this was.</summary>
    public required string Source { get; set; }

    /// <summary>
    /// The name of the uploaded file, kept so the review screen can say which one this is.
    /// </summary>
    /// <remarks>
    /// User-controlled text that is rendered back, and <b>never</b> a path: nothing here opens,
    /// writes or joins it. Bounded so a pathological name cannot be used to bloat the row.
    /// </remarks>
    public required string FileName { get; set; }

    /// <summary>One of <see cref="ImportJobStates"/>.</summary>
    public required string State { get; set; }

    /// <summary>How many rows the file yielded. Set once, when the job is created.</summary>
    public int RowCount { get; set; }

    /// <summary>How many rows the commit actually wrote. Null until the job is committed.</summary>
    public int? ImportedCount { get; set; }

    /// <summary>
    /// How many rows the commit deliberately passed over — unmatched, or declined by their owner.
    /// Null until the job is committed. With <see cref="ImportedCount"/> it accounts for every row,
    /// which is what the result summary promises and what the failure report is built from.
    /// </summary>
    public int? SkippedCount { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// The last time the job's owner did something with it, and the clock a <em>pending</em> job's
    /// retention runs against.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Set on upload and moved by every write the review makes — saving decisions, committing,
    /// cancelling. Without it the abandoned-job window would run from <see cref="CreatedAt"/>, and a
    /// review somebody worked through over three weekends would be deleted underneath them on the
    /// fourteenth day along with every decision they had made. That is the exact opposite of why
    /// that window is the longer of the two. See <c>ImportRetention.KeepAbandoned</c>.
    /// </para>
    /// <para>
    /// <b>Reading the review does not move it.</b> A GET that writes is its own problem, and a job
    /// left open in a background tab would otherwise never expire at all.
    /// </para>
    /// </remarks>
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>When the job reached <c>done</c> or <c>cancelled</c>. Null while it is pending.</summary>
    public DateTimeOffset? CompletedAt { get; set; }

    public ApplicationUser User { get; set; } = null!;
}
