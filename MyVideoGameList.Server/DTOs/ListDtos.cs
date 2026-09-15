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
public record ListEntryDto(
    GameDto Game,
    short? Score,
    DateTimeOffset AddedAt,
    DateTimeOffset? StatusChangedAt);

/// <summary>
/// One entry read on its own: its list-shaped fields, and the two a list row leaves out.
/// </summary>
/// <remarks>
/// What <c>IListService.GetEntryAsync</c> returns, for the controller to put together with the
/// playthroughs and the review. Not sent as it is.
/// </remarks>
public record EntryDto(ListEntryDto Entry, string? Ownership, string? Notes);

/// <summary>
/// Everything one user has recorded about one game: the entry itself, how they have it, their
/// notes, every playthrough of it, and their review.
/// </summary>
/// <remarks>
/// <para>
/// The single-entry read returns this; the list read still returns bare
/// <see cref="ListEntryDto"/> rows. The two answer different questions — a list view shows fifty
/// games at once and has no use for anybody's notes, and attaching them would multiply the
/// payload by every row. <see cref="Ownership"/> stays off the list row for the same reason until a
/// list view has a use for it: nothing there reads it today.
/// </para>
/// </remarks>
/// <param name="Ownership">One of <c>OwnershipKinds</c>, or null when the user has not said.</param>
/// <param name="Notes">Private to the user; no public or community read carries them.</param>
public record EntryDetailDto(
    ListEntryDto Entry,
    string? Ownership,
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
