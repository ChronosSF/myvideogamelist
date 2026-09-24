using System.ComponentModel.DataAnnotations;

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
public record ImportReviewSummaryDto(
    int Total,
    int Matched,
    int Unmatched,
    int StatusUnrecognised,
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
    string MatchKind,
    string Decision,
    string? SourceStatus,
    string? Status,
    bool StatusUnrecognised,
    short? Score,
    bool Wishlist,
    bool Favourite,
    bool HasNotes,
    int PlaythroughCount,
    int? MinutesPlayed,
    bool AlreadyTracked);

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
/// What a commit did, and what it did not do.
/// </summary>
/// <param name="Skipped">
/// Every row that did not import, with the reason. This is what the downloadable failure report is
/// built from — the promise of §C5 is that nothing is silently lost, and a count alone does not
/// keep it.
/// </param>
public record ImportResultDto(ImportJobDto Job, IReadOnlyList<ImportSkippedRowDto> Skipped);

public record ImportSkippedRowDto(string Title, string? SourceStatus, string Reason);
