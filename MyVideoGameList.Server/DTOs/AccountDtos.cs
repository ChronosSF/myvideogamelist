using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// Everything one user has entered, as a single document they can download and keep.
/// </summary>
/// <remarks>
/// <para>
/// Their data and only their data: no game titles, cover art, genres or platforms, and no IGDB call
/// to fetch any. That follows the rule <c>docs/decisions/0023-*</c> set for the profile statistics,
/// but for a stronger reason — taking your data with you is a right, and a right that stops working
/// because a third party is down is not one. What each row carries instead is the IGDB id, which is
/// the same identifier our own tables hold and therefore exactly as much as we know about the game.
/// </para>
/// <para>
/// Every section is always present and may be empty. A user who signed up a minute ago exports a
/// complete document with nothing in it, because "you have recorded nothing" is an answer whereas a
/// missing section is ambiguous between that and a bug.
/// </para>
/// <para>
/// One section per user-owned table, and the manifest in
/// <see cref="Services.UserDataExporter"/> is what keeps that correspondence honest: a new
/// user-owned table fails <c>UserOwnedDataTests</c> until it is registered there. See
/// <c>docs/decisions/0024-the-ownership-contract.md</c>.
/// </para>
/// </remarks>
/// <param name="ExportedAt">When the document was produced, not when the account was created.</param>
public record UserDataExportDto(
    DateTimeOffset ExportedAt,
    AccountExportDto Account,
    IReadOnlyList<EntryExportDto> Entries,
    IReadOnlyList<EventExportDto> Events,
    IReadOnlyList<PlaythroughExportDto> Playthroughs,
    IReadOnlyList<ReviewExportDto> Reviews,
    IReadOnlyList<WishlistExportDto> Wishlist,
    IReadOnlyList<FavouriteExportDto> Favourites,
    IReadOnlyList<int> HiddenPlatformIds,
    IReadOnlyList<ListSortExportDto> ListSortPreferences,
    IReadOnlyList<ListNameExportDto> ListNames,
    IReadOnlyList<ImportJobExportDto> ImportJobs,
    IReadOnlyList<ImportRowExportDto> ImportRows);

/// <summary>
/// The account row itself — the columns MVGL added to Identity's user, plus the address and the
/// name that identify it.
/// </summary>
/// <remarks>
/// <para>
/// No password hash, no security stamp and no Identity bookkeeping. Those are credentials and
/// machinery rather than data the user entered, and a hash in a downloaded file is a liability with
/// nothing to recommend it.
/// </para>
/// <para>
/// The username <em>is</em> data the user entered — they chose it, and it is the name everything
/// they have written is published under — so it belongs here beside the address. So does
/// <paramref name="ProfileVisibility"/>: an export that recorded what somebody wrote but not
/// whether they agreed to it being read would be missing the more consequential of the two.
/// </para>
/// </remarks>
public record AccountExportDto(
    string? Email,
    string? UserName,
    string Theme,
    string ListView,
    string ProfileVisibility);

/// <summary>
/// One game the user has recorded something about.
/// </summary>
/// <remarks>
/// The entry's surrogate <c>Id</c> is deliberately absent: it is an internal key with no meaning
/// outside this database, and <c>GameId</c> plus the owning account is what actually identifies the
/// row (ADR 0022 keeps that pair unique).
/// </remarks>
/// <param name="Status">
/// The status list's permanent <c>Key</c> — <c>finished</c>, never <c>4</c>. ADR 0018 makes the key
/// the stable contract and the numeric id an implementation detail: ids are seeded constants of
/// <em>this</em> database, so a document carrying them could not be read back by anything else,
/// including a future importer of our own. Null means the game is in none of the user's lists,
/// which is a real state (ADR 0019) rather than missing data.
/// </param>
/// <param name="Ownership">One of <c>OwnershipKinds</c>, already a permanent key, or null.</param>
/// <param name="Notes">The user's private notes on the game. Theirs, so theirs to take.</param>
/// <param name="Origin">
/// One of <c>EntryOrigins</c> — what put the row here, <c>manual</c> for anything the user did
/// themselves. Exported because it is what says whether a status has a transition behind it in
/// <see cref="UserDataExportDto.Events"/> (ADR 0026): without it, an imported library reads as a
/// history that simply lost its events.
/// </param>
public record EntryExportDto(
    int GameId,
    string? Status,
    int? Score,
    string? Ownership,
    string? Notes,
    string Origin,
    DateTimeOffset AddedAt,
    DateTimeOffset? StatusChangedAt);

/// <summary>
/// One recorded status transition, in the order it happened.
/// </summary>
/// <remarks>
/// This is the section that could not be reconstructed if it were left out — the entry above holds
/// current state and is overwritten on every move, so the log is the only record that a transition
/// ever happened (ADR 0018). Both ends carry keys for the same reason
/// <see cref="EntryExportDto.Status"/> does.
/// </remarks>
/// <param name="FromStatus">Null when the game was in no list before this — a first add.</param>
/// <param name="ToStatus">Null when the game left every list, which is a move and not a deletion.</param>
public record EventExportDto(
    int GameId,
    string? FromStatus,
    string? ToStatus,
    DateTimeOffset OccurredAt);

/// <summary>
/// One recorded playthrough of one game.
/// </summary>
/// <remarks>
/// Carries the game's IGDB id rather than the entry's surrogate key, for the reason
/// <see cref="EntryExportDto"/> gives: an internal id means nothing outside this database. The
/// entry it belongs to is identified by that game id plus the owning account, which is the pair
/// ADR 0022 keeps unique.
/// </remarks>
/// <param name="Type">
/// The playthrough type's permanent <c>Key</c> — <c>completionist</c>, never <c>3</c>, on the same
/// argument as <see cref="EntryExportDto.Status"/>. Null is a real value: a run in progress has no
/// answer yet.
/// </param>
public record PlaythroughExportDto(
    int GameId,
    string? Type,
    int? PlatformId,
    int? MinutesPlayed,
    DateOnly? StartedOn,
    DateOnly? FinishedOn,
    string? Notes,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>
/// One review the user has written.
/// </summary>
/// <remarks>
/// The pointer to the playthrough it is about is deliberately omitted: it is an internal surrogate
/// id with no meaning outside this database, the same reason the entry's own <c>Id</c> is left out.
/// The score is absent because it is not on the review — it travels with the entry.
/// </remarks>
public record ReviewExportDto(
    int GameId,
    string Body,
    bool HasSpoilers,
    string Visibility,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>
/// One wishlisted game. <c>AddedAt</c> is its entire history by design — the wishlist is an axis of
/// its own and writes no events (ADR 0022).
/// </summary>
public record WishlistExportDto(int GameId, DateTimeOffset AddedAt);

/// <summary>
/// One favourite game. Another axis like the wishlist, so <c>AddedAt</c> is its entire history too
/// (ADR 0029).
/// </summary>
public record FavouriteExportDto(int GameId, DateTimeOffset AddedAt);

/// <summary>
/// How the user has chosen to sort one status list. Only the lists they actually re-sorted have a
/// row, here as in the database (ADR 0020).
/// </summary>
public record ListSortExportDto(string Status, string SortKey, bool Descending);

/// <summary>
/// What the user calls one of their lists. Only renamed lists have a row, and the status is its
/// permanent key, so the name can be applied back to the right list by anything that reads this.
/// </summary>
public record ListNameExportDto(string Status, string DisplayName);

/// <summary>
/// One import the user has run or started, and what came of it.
/// </summary>
/// <remarks>
/// A pending job is data they created and have not finished with, so it is theirs to take like
/// anything else. The uploaded file is not here because it was never stored — it is parsed into
/// rows and dropped (see <c>ImportJob</c>).
/// </remarks>
public record ImportJobExportDto(
    Guid Id,
    string Source,
    string FileName,
    string State,
    int RowCount,
    int? ImportedCount,
    int? SkippedCount,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? CompletedAt);

/// <summary>
/// One game from an uploaded file, as the importer understood it.
/// </summary>
/// <remarks>
/// <paramref name="Values"/> is the canonical row — status, score, notes, flags and playthroughs —
/// emitted as nested JSON rather than as an escaped string, so the document reads as a document.
/// It is what the import <em>would</em> write, which for a job still pending is the only place that
/// interpretation exists.
/// </remarks>
/// <param name="Candidates">
/// The IGDB games the matcher offered, which is what a <c>MatchKind</c> of <c>ambiguous</c> means
/// in a document that would otherwise state the verdict and not the alternatives.
/// </param>
public record ImportRowExportDto(
    Guid JobId,
    string? SourceRef,
    string Title,
    int? GameId,
    string MatchKind,
    string Decision,
    IReadOnlyList<int> Candidates,
    JsonElement Values);

/// <summary>
/// Confirmation for deleting an account: the account's own password, typed again.
/// </summary>
/// <remarks>
/// A cookie proves the browser was signed in at some point, which is not enough for an
/// irreversible act on a shared or unlocked machine. Re-entering the password proves the person
/// at the keyboard is the account holder, now.
/// </remarks>
public record DeleteAccountDto([Required] string Password);
