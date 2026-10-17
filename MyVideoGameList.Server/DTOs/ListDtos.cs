using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// A move to one of the predefined statuses.
/// </summary>
/// <remarks>
/// <para>
/// Validated by attribute so <c>[ApiController]</c> returns the 400 itself. A hand-rolled guard in
/// the controller would trip CodeQL's <c>cs/user-controlled-bypass</c> rule, and the allowed set
/// has to come from <see cref="ListStatusKeys"/> rather than a second list of literals.
/// </para>
/// <para>
/// The attributes target the constructor <em>parameter</em>, not the generated property. A
/// <c>[property:]</c> target compiles fine and then throws at request time — ASP.NET refuses to
/// silently ignore validation metadata it cannot see on a record's primary constructor.
/// </para>
/// </remarks>
public record SetListEntryDto(
    [Required]
    [AllowedValues(
        ListStatusKeys.Backlog,
        ListStatusKeys.Playing,
        ListStatusKeys.OnHold,
        ListStatusKeys.Finished,
        ListStatusKeys.Dropped)]
    string Status);

/// <summary>The bounds of a status change made to several games at once (ADR 0055).</summary>
public static class ListBatch
{
    /// <summary>
    /// The most games one request may move or take out of the lists. Far past any list a person keeps,
    /// so that selecting every game in one — the case a bound would get in the way of — is never refused;
    /// it is there so a request's work has an end. The same number as <see cref="HandOrder.MaxWrites"/>,
    /// the other write the lists page sends for many games at once.
    /// </summary>
    public const int MaxGames = 10_000;

    /// <summary>
    /// The most a request may weigh, in bytes, checked before the body is read. <see cref="MaxGames"/>
    /// ids at their longest are about 110 KB; without a limit the body could be Kestrel's 30 MB, read
    /// whole before the bound on their number refused it — the reason <see cref="HandOrder.MaxRequestBytes"/>
    /// exists, and the same megabyte.
    /// </summary>
    public const int MaxRequestBytes = 1024 * 1024;
}

/// <summary>
/// A move of several games to one list, or out of every list, in one request (ADR 0055).
/// </summary>
/// <remarks>
/// <para>
/// One status for every game, because that is the action on the page: these games, to that list. A
/// game named twice is moved once. <see cref="Status"/> null takes the games out of every list, as a
/// null does for the import's played games (<c>ImportPlayedStatusDto</c>) and as a null
/// <c>ToStatusId</c> records it in the event log.
/// </para>
/// <para>
/// Both properties are <c>required</c>, which <c>System.Text.Json</c> enforces as present in the body,
/// so a client that forgets the status gets a 400 rather than every game it named taken out of its
/// list. A null has to be sent as one. That is also why this is not a positional record like its
/// neighbours: the keyword cannot be put on a constructor parameter.
/// </para>
/// <para>
/// The ids are checked here as well: a game id below one is refused as a 400, which an attribute on
/// a list of integers cannot say. A <c>null</c> among them never gets this far, since it is not an
/// integer and fails as the body is read.
/// </para>
/// </remarks>
public record SetStatusesDto : IValidatableObject
{
    [Required]
    [MinLength(1)]
    [MaxLength(ListBatch.MaxGames)]
    public required IReadOnlyList<int> GameIds { get; init; }

    [AllowedValues(
        null,
        ListStatusKeys.Backlog,
        ListStatusKeys.Playing,
        ListStatusKeys.OnHold,
        ListStatusKeys.Finished,
        ListStatusKeys.Dropped)]
    public required string? Status { get; init; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (GameIds is not null && GameIds.Any(id => id < 1))
            yield return new ValidationResult("Every game id must be 1 or more.", [nameof(GameIds)]);
    }
}

/// <summary>
/// What a change of status made to several games at once did to each of them. Permanent once
/// shipped, as every key the client branches on is.
/// </summary>
public static class StatusChangeOutcomes
{
    /// <summary>It was not where it was asked to be, and now is: one event recorded.</summary>
    public const string Moved = "moved";

    /// <summary>
    /// It already was — in that list, or for a removal in no list, with or without an entry. Nothing
    /// recorded, as a single move to the status a game already holds records nothing (ADR 0018).
    /// </summary>
    public const string Unchanged = "unchanged";

    /// <summary>
    /// The user has no entry for the game, so a move did not happen: the batch acts on the user's own
    /// games and creates none. A game deleted from another tab since this one loaded, or between the
    /// request's read and its save. Never the answer to a removal, which a game with no entry has
    /// already had.
    /// </summary>
    public const string Missing = "missing";
}

/// <summary>One game's outcome — one of <see cref="StatusChangeOutcomes"/>.</summary>
public record StatusChangeDto(int GameId, string Outcome);

/// <summary>
/// Every game a change of status named, once each, in the order they were first named, with what
/// happened to it.
/// </summary>
public record SetStatusesResultDto(IReadOnlyList<StatusChangeDto> Results);

/// <summary>Sets or clears the user's score. A null score clears it.</summary>
public record SetScoreDto([Range(1, 10)] short? Score);

/// <summary>
/// Sets or clears how the user has the game. A null clears it, and is allowed by name: without
/// <c>null</c> in the list, <see cref="AllowedValuesAttribute"/> refuses it.
/// </summary>
public record SetOwnershipDto(
    [AllowedValues(
        null,
        OwnershipKinds.Owned,
        OwnershipKinds.Subscription,
        OwnershipKinds.Borrowed)]
    string? Ownership);

/// <summary>
/// Replaces the user's notes on the game. Null, empty and whitespace all clear them; the service
/// trims, as it does a playthrough's notes.
/// </summary>
public record SetNotesDto([MaxLength(2000)] string? Notes);

/// <summary>
/// One game plus what this user has recorded about it.
/// </summary>
/// <remarks>
/// The per-entry fields are what a table view sorts by and a bare <see cref="GameDto"/> cannot
/// carry. <see cref="StatusChangedAt"/> is null for an entry that has never been in a list, and
/// <see cref="Score"/> is independent of list membership entirely.
/// </remarks>
/// <param name="Ownership">
/// How the user has the game — one of <c>OwnershipKinds</c> — or null when they have not said. On the
/// row since the lists page gained an ownership column and filter (ADR 0055, amending 0030 §4). Private
/// like everything else here: only the owner's own reads carry a <see cref="ListEntryDto"/>.
/// </param>
/// <param name="Position">
/// Where the owner put the game in this list by hand, or null when they have not: the sparse number
/// of <see cref="IHandOrdered"/>, which the client sorts by and computes. Only the owner's own read
/// carries it — a public profile does not show an order (ADR 0031).
/// </param>
public record ListEntryDto(
    GameDto Game,
    short? Score,
    string? Ownership,
    DateTimeOffset AddedAt,
    DateTimeOffset? StatusChangedAt,
    int? Position);

/// <summary>
/// What a move left a game's entry holding: a <see cref="ListEntryDto"/>'s own fields, without the game,
/// which the client already has.
/// </summary>
/// <remarks>
/// What <c>PUT /api/lists/{gameId}</c> answers with. A game coming back from no list has a row the client
/// dropped when it left, and the client cannot know its score, its ownership or when it was first added —
/// the entry kept all three (ADR 0019). Without this the row came back unscored and with no ownership,
/// which the lists page's ownership filter then acted on until the next load (ADR 0055).
/// </remarks>
public record EntryStateDto(
    short? Score,
    string? Ownership,
    DateTimeOffset AddedAt,
    DateTimeOffset? StatusChangedAt,
    int? Position);

/// <summary>
/// One entry read on its own: its list-shaped fields, and the notes a list row leaves out.
/// </summary>
/// <remarks>
/// What <c>IListService.GetEntryAsync</c> returns, for the controller to put together with the
/// playthroughs and the review. Not sent as it is.
/// </remarks>
public record EntryDto(ListEntryDto Entry, string? Notes);

/// <summary>
/// Everything one user has recorded about one game: the entry itself, including how they have it,
/// their notes, every playthrough of it, and their review.
/// </summary>
/// <remarks>
/// <para>
/// The single-entry read returns this; the list read still returns bare
/// <see cref="ListEntryDto"/> rows. The two answer different questions — a list view shows fifty
/// games at once and has no use for anybody's notes, and attaching them would multiply the
/// payload by every row. Ownership is small and the lists page filters by it, so it is on the row
/// itself, <see cref="ListEntryDto.Ownership"/>, and read from there here too (ADR 0055).
/// </para>
/// </remarks>
/// <param name="Notes">Private to the user; no public or community read carries them.</param>
public record EntryDetailDto(
    ListEntryDto Entry,
    string? Notes,
    IReadOnlyList<PlaythroughDto> Playthroughs,
    ReviewDto? Review);

/// <summary>
/// Every status list for one user, keyed by <see cref="ListStatus.Key"/>.
/// </summary>
/// <remarks>
/// Keyed rather than one property per status: five statuses already make a property-per-list
/// unwieldy, and custom lists would break that shape outright. Every known status is always
/// present, empty when it holds nothing, so the client never has to guard a missing key. Entries
/// with no status appear in none of these lists and are read one at a time instead.
/// </remarks>
public record ListsDto(IReadOnlyDictionary<string, IReadOnlyList<ListEntryDto>> Lists);
