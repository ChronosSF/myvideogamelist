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
/// Every status list for one user, keyed by <see cref="ListStatus.Key"/>.
/// </summary>
/// <remarks>
/// Keyed rather than one property per status: five statuses already make a property-per-list
/// unwieldy, and custom lists would break that shape outright. Every known status is always
/// present, empty when it holds nothing, so the client never has to guard a missing key.
/// </remarks>
public record ListsDto(IReadOnlyDictionary<string, IReadOnlyList<GameDto>> Lists);
