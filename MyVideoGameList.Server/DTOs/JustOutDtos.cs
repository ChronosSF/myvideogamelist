namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// One game on the home page's Just out panel (ADR 0073): the day it came out, and what it is out on.
/// </summary>
/// <param name="Released">The day of its first full release.</param>
/// <param name="Platforms">What it has been fully released on since. Empty when IGDB did not say.</param>
public record JustOutDto(
    int GameId,
    string Title,
    string? CoverImageUrl,
    DateOnly Released,
    IReadOnlyList<PlatformDto> Platforms);
