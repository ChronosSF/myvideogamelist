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
/// Every status list for one user, keyed by <see cref="ListStatus.Key"/>.
/// </summary>
/// <remarks>
/// Keyed rather than one property per status: five statuses already make a property-per-list
/// unwieldy, and custom lists would break that shape outright. Every known status is always
/// present, empty when it holds nothing, so the client never has to guard a missing key. Entries
/// with no status appear in none of these lists and are read one at a time instead.
/// </remarks>
public record ListsDto(IReadOnlyDictionary<string, IReadOnlyList<ListEntryDto>> Lists);
