using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.DTOs;

/// <summary>One import, as the client tracks it.</summary>
public record ImportJobDto(
    Guid Id,
    string Source,
    string FileName,
    string State,
    int RowCount,
    int? ImportedCount,
    int? SkippedCount,
    DateTimeOffset CreatedAt,
    DateTimeOffset? CompletedAt,
    /// <summary>
    /// When retention will delete this job. Computed from the same windows the sweep uses, so the
    /// client can tell somebody how long their review has without holding a copy of the rule.
    /// </summary>
    DateTimeOffset ExpiresAt);

/// <summary>
/// Everything the review screen renders: the job, its rows, and the counts the bulk actions act on.
/// </summary>
public record ImportReviewDto(
    ImportJobDto Job,
    ImportReviewSummaryDto Summary,
    IReadOnlyList<ImportReviewRowDto> Rows);

/// <summary>
/// The groups the review screen offers to act on at once.
/// </summary>
/// <param name="AlreadyTracked">
/// Rows whose game the user already has an entry for. Counted fresh on every read rather than
/// stored, because the answer is about their library and can change between the upload and the
/// commit.
/// </param>
/// <param name="Selected">How many rows are currently set to import — what the commit button says.</param>
/// <param name="Ambiguous">
/// Rows the matcher found candidates for but would not choose between. What the review screen
/// counts to say how much is left to resolve by hand.
/// </param>
/// <param name="Unlooked">
/// Rows no matching pass has been over yet. This is what tells the screen there is more matching to
/// do — an <c>unmatched</c> row <em>has</em> been looked at and will not change by asking again, so
/// counting the two together would leave a "find matches" button that never stopped offering
/// itself.
/// </param>
/// <param name="PlayedUnresolved">
/// Rows the file says were played without saying how that ended — the group
/// <c>PUT jobs/{id}/played-status</c> answers for at once. A fact about the file, so it does not
/// move while the review is worked through, whatever list the group is given.
/// </param>
public record ImportReviewSummaryDto(
    int Total,
    int Matched,
    int Ambiguous,
    int Unmatched,
    int Unlooked,
    int StatusUnrecognised,
    int PlayedUnresolved,
    int AlreadyTracked,
    int Selected);

/// <summary>
/// One row as the review screen shows it: what the file said, what we made of it, and what the
/// user has decided.
/// </summary>
/// <param name="Game">
/// The matched game's metadata, when we hold any. Null is not a failure — it means only that this
/// app has not cached the game yet, or that IGDB is unreachable. The import needs the id, not the
/// cover art, so a null here costs a thumbnail rather than a row.
/// </param>
/// <param name="Status">One of <c>ListStatusKeys</c>, or null for a row that will carry no status.</param>
/// <param name="PlayedUnresolved">
/// The file says this game was played and not how that ended, so its status is whatever list its
/// owner chose for every such row at once — none until they choose (ADR 0045).
/// </param>
/// <param name="Candidates">
/// The games the matcher would offer for an <c>ambiguous</c> row, best first, so the user resolves
/// it in one click (<c>specs/csv-list-import.md</c> §M3). Empty for every other row, and empty as
/// well for a candidate id this app holds no metadata for — the same rule <paramref name="Game"/>
/// follows, since a candidate nobody can see is not a candidate.
/// </param>
/// <param name="AlreadyTracked">
/// The user already has an entry for this game. Such a row defaults to <c>skip</c>, and importing
/// it overwrites what is there — which is why it is opt-in per row.
/// </param>
public record ImportReviewRowDto(
    int Id,
    string Title,
    int? ReleaseYear,
    int? GameId,
    GameDto? Game,
    IReadOnlyList<GameDto> Candidates,
    string MatchKind,
    string Decision,
    string? SourceStatus,
    string? Status,
    bool StatusUnrecognised,
    bool PlayedUnresolved,
    short? Score,
    bool Wishlist,
    bool Favourite,
    bool HasNotes,
    int PlaythroughCount,
    int? MinutesPlayed,
    bool AlreadyTracked);

/// <summary>
/// What one matching pass did.
/// </summary>
/// <remarks>
/// <para>
/// <b>Only the rows the pass examined, never the whole review.</b> A pass resolves a bounded batch
/// and the client runs it until nothing is left, so answering with every row would re-read,
/// re-serialise and re-send the entire job on each of them — for the five-thousand-row id-less
/// export this exists for, that is gigabytes of JSON to import one file. The client merges these
/// into the review it already holds.
/// </para>
/// <para>
/// No summary, for the same reason: the counts are facts about rows the client has, so it recounts
/// rather than being told. And <paramref name="Examined"/> is what it stops on — a pass that
/// examined nothing has nothing left to examine.
/// </para>
/// <para>
/// <b>Only the match in each row is current.</b> A pass reads its rows before its call to IGDB, and
/// a write that lands meanwhile — the played group's list, a shelf's status — changes the payload
/// in the database but not the copy these rows were built from. The two never write the same
/// column, so nothing is lost, but the client takes the game, the candidates and the match kind
/// from here, and a decision only where the pass pre-checked one, and keeps the rest of each row
/// as it already holds it.
/// </para>
/// </remarks>
public record ImportMatchPassDto(ImportJobDto Job, IReadOnlyList<ImportReviewRowDto> Examined);

/// <summary>
/// The user's decisions about some rows. Only the rows named are touched, so the review screen can
/// send one row or a bulk selection through the same endpoint.
/// </summary>
public record ImportDecisionsDto(
    [Required]
    [MinLength(1, ErrorMessage = "Send at least one row.")]
    [MaxLength(5000, ErrorMessage = "Too many rows in one request.")]
    IReadOnlyList<ImportRowDecisionDto> Rows);

/// <summary>
/// What to do with one row, and optionally what to fix about it first.
/// </summary>
/// <param name="GameId">
/// A game the user picked for a row the file could not resolve. Null leaves the row's own match
/// alone rather than clearing it.
/// </param>
/// <param name="Status">
/// A status the user picked for a row whose shelf we did not recognise, as a
/// <c>ListStatusKeys</c> value. Null leaves the row alone; clearing a status is not offered,
/// because "no status" is already what an unresolved row does.
/// </param>
public record ImportRowDecisionDto(
    [Range(1, int.MaxValue)] int RowId,
    [Required] string Decision,
    [Range(1, int.MaxValue)] int? GameId,
    string? Status);

/// <summary>
/// The list every played-but-unresolved row goes into, chosen once for all of them.
/// </summary>
/// <remarks>
/// <para>
/// One answer for the group rather than a status per row, because that is the question being
/// asked: a file that does not say how hundreds of games ended is not asking about each of them,
/// and making somebody answer row by row is the problem restated (ADR 0045). The request names a
/// list and never a row, so which rows are in the group is the server's to decide, and is exactly
/// the set the review counted.
/// </para>
/// <para>
/// Null puts them back in no list, which is where they start. It is allowed by name: without
/// <c>null</c> in the list, <see cref="AllowedValuesAttribute"/> refuses it.
/// </para>
/// </remarks>
public record ImportPlayedStatusDto(
    [AllowedValues(
        null,
        ListStatusKeys.Backlog,
        ListStatusKeys.Playing,
        ListStatusKeys.OnHold,
        ListStatusKeys.Finished,
        ListStatusKeys.Dropped)]
    string? Status);

/// <summary>
/// What a commit did, and what it did not do.
/// </summary>
/// <param name="Skipped">
/// Every row that did not import, with the reason. This is what the downloadable failure report is
/// built from — the promise of §C5 is that nothing is silently lost, and a count alone does not
/// keep it.
/// </param>
/// <param name="Unlisted">
/// How many of the games the commit wrote are in no list afterwards. The result screen says so,
/// because "now in your lists" is false of them: an entry with no status appears in no list
/// (ADR 0019), and only the game's own page shows it.
/// </param>
public record ImportResultDto(ImportJobDto Job, IReadOnlyList<ImportSkippedRowDto> Skipped, int Unlisted);

public record ImportSkippedRowDto(string Title, string? SourceStatus, string Reason);
