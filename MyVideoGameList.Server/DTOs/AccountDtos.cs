using System.ComponentModel.DataAnnotations;

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
    IReadOnlyList<WishlistExportDto> Wishlist,
    IReadOnlyList<int> HiddenPlatformIds,
    IReadOnlyList<ListSortExportDto> ListSortPreferences);

/// <summary>
/// The account row itself — the columns MVGL added to Identity's user, plus the address that
/// identifies it.
/// </summary>
/// <remarks>
/// No password hash, no security stamp and no Identity bookkeeping. Those are credentials and
/// machinery rather than data the user entered, and a hash in a downloaded file is a liability with
/// nothing to recommend it.
/// </remarks>
public record AccountExportDto(string? Email, string Theme, string ListView);

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
public record EntryExportDto(
    int GameId,
    string? Status,
    int? Score,
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
/// One wishlisted game. <c>AddedAt</c> is its entire history by design — the wishlist is an axis of
/// its own and writes no events (ADR 0022).
/// </summary>
public record WishlistExportDto(int GameId, DateTimeOffset AddedAt);

/// <summary>
/// How the user has chosen to sort one status list. Only the lists they actually re-sorted have a
/// row, here as in the database (ADR 0020).
/// </summary>
public record ListSortExportDto(string Status, string SortKey, bool Descending);

/// <summary>
/// Confirmation for deleting an account: the account's own password, typed again.
/// </summary>
/// <remarks>
/// A cookie proves the browser was signed in at some point, which is not enough for an
/// irreversible act on a shared or unlocked machine. Re-entering the password proves the person
/// at the keyboard is the account holder, now.
/// </remarks>
public record DeleteAccountDto([Required] string Password);
