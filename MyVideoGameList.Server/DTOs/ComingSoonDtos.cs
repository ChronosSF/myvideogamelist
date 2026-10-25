using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// One game on the home page's Coming soon panel (ADR 0071): when it arrives, to the precision IGDB knows,
/// and on what.
/// </summary>
/// <param name="Precision"><c>day</c>, <c>month</c> or <c>quarter</c> — never <c>year</c>, which the panel leaves out.</param>
/// <param name="Starts">The day, or the first day of the month or quarter.</param>
/// <param name="Platforms">What it arrives on then. Empty when IGDB did not say.</param>
public record ComingSoonDto(
    int GameId,
    string Title,
    string? CoverImageUrl,
    string Precision,
    DateOnly Starts,
    IReadOnlyList<PlatformDto> Platforms);

/// <summary>A game pinned to the Coming soon panel or hidden from it, as the admin page lists it.</summary>
/// <param name="Kind"><c>pin</c> or <c>hide</c>.</param>
public record ComingSoonPickDto(int GameId, string Title, string Kind, DateTimeOffset PickedAt);

/// <summary>Pins a game to the Coming soon panel or hides it, replacing whichever it was.</summary>
public record ComingSoonPickInputDto(
    [Required]
    [AllowedValues(ComingSoonPickKinds.Pin, ComingSoonPickKinds.Hide)]
    string Kind);
