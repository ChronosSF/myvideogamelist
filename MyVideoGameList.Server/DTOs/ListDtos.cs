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

/// <summary>
/// What a move answers: whether it changed the game's list, and the game's unfinished playthrough as
/// the move leaves it.
/// </summary>
/// <remarks>
/// <para>
/// The client asks whether to start or finish a playthrough from this, after the move has saved
/// (ADR 0097), and the lists page holds nobody's runs, so the one round trip carries what the question
/// needs. The move writes no run and reads one only to answer (ADR 0025 §4).
/// </para>
/// <para>
/// <see cref="Moved"/> is the server's word, not the client's: a tab that thought the game was in the
/// Backlog when another had already moved it to Playing sends a move that changes nothing, records no
/// event (ADR 0018), and is asked nothing.
/// </para>
/// </remarks>
/// <param name="Moved">False when the game was already in that list, which records nothing.</param>
/// <param name="UnfinishedPlaythrough">
/// The game's playthrough with no finish date, or null when it has none. With several, the one started
/// most recently, or the one logged most recently where none says when it started
/// (<c>UnfinishedPlaythroughs</c>). Read only for a move that can ask, one that changed the list to
/// Playing or to Finished, and null for every other.
/// </param>
public record ListMoveDto(bool Moved, UnfinishedPlaythroughDto? UnfinishedPlaythrough);

/// <summary>
/// The unfinished playthrough a move reports, as much of it as a question about it needs: which one,
/// and when it started, if it says.
/// </summary>
public record UnfinishedPlaythroughDto(int Id, DateOnly? StartedOn);

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
/// <param name="Position">
/// Where the owner put the game in this list by hand, or null when they have not: the sparse number
/// of <see cref="IHandOrdered"/>, which the client sorts by and computes. Only the owner's own read
/// carries it — a public profile does not show an order (ADR 0031).
/// </param>
/// <param name="TagIds">
/// The owner's tags on the game, by id, in id order; empty when it carries none. Ids rather than names
/// so that a rename changes one row of <c>/api/tags</c> and no row here — the client resolves them
/// through that read (ADR 0065). Private like the rest of the row: only the owner's own reads carry a
/// <see cref="ListEntryDto"/>, and <c>TagPrivacyTests</c> fails if a public one ever does.
/// </param>
public record ListEntryDto(
    GameDto Game,
    short? Score,
    DateTimeOffset AddedAt,
    DateTimeOffset? StatusChangedAt,
    int? Position,
    IReadOnlyList<int> TagIds);

/// <summary>
/// One entry read on its own: its list-shaped fields, and the two a list row leaves out.
/// </summary>
/// <remarks>
/// What <c>IListService.GetEntryAsync</c> returns, for the controller to put together with the
/// playthroughs and the review. Not sent as it is.
/// </remarks>
public record EntryDto(ListEntryDto Entry, string? Ownership, string? Notes);

/// <summary>
/// Everything one user has recorded about one game: the entry itself — its tags among its fields —
/// how they have it, their notes, every playthrough of it, and their review.
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
