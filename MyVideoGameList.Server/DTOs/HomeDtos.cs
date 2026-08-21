namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// Everything the home page needs above the calendar, in one response.
/// </summary>
/// <remarks>
/// Composed server-side rather than left as three client fetches, per ROADMAP §3.5: the home
/// page is the highest-traffic route, and each rail would otherwise be a separate round trip
/// against a rate-limited upstream.
/// </remarks>
/// <param name="Spotlight">
/// A single highly-rated game with artwork, used as the hero backdrop. Null when IGDB returns
/// nothing usable, in which case the hero falls back to a plain gradient.
/// </param>
/// <param name="Popular">Real covers, shown instead of describing the catalogue in the abstract.</param>
/// <param name="News">Latest Steam news across <paramref name="Popular"/>, newest first. May be empty.</param>
public record HomeResponse(
    GameDto? Spotlight,
    IEnumerable<GameDto> Popular,
    IEnumerable<NewsItemDto> News);
