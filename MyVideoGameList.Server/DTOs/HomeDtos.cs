namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// Everything the home page shows every visitor alike, in one response.
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
/// <param name="Degraded">
/// True when an upstream failed and this answer is missing what it would have supplied. It is
/// still a 200, deliberately — the page renders without its rails rather than failing — so this
/// is the only thing that tells a caller not to cache what it builds from it. A CDN cannot tell
/// one 200 from another, and caching a failure outlives the failure.
/// </param>
public record HomeResponse(
    GameDto? Spotlight,
    IEnumerable<GameDto> Popular,
    IEnumerable<NewsItemDto> News,
    bool Degraded);
