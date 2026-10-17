namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// Everything the home page shows every visitor alike, in one response.
/// </summary>
/// <remarks>
/// Composed server-side rather than left as separate client fetches, per ROADMAP §3.5: the home
/// page is the highest-traffic route, and each part would otherwise be a separate round trip
/// against a rate-limited upstream.
/// </remarks>
/// <param name="Spotlight">
/// A single highly-rated game with artwork, used as the hero backdrop. Null when IGDB returns
/// nothing usable, in which case the hero falls back to a plain gradient.
/// </param>
/// <param name="Popular">Real covers, shown instead of describing the catalogue in the abstract.</param>
/// <param name="News">Latest Steam news across <paramref name="Popular"/>, newest first. May be empty.</param>
/// <param name="Events">
/// The showcases and sales that overlap the next two weeks for any reader, wherever they are: the
/// release calendar's answer (<c>specs/release-timeline-and-calendar.md</c> §2.3, B8) for the UTC
/// days from yesterday to the fourteenth after today, a day wider at each end than the two weeks
/// because this answer is everybody's and a reader's day is a local one. The page keeps what falls
/// on the reader's own two weeks. Empty when nothing is on, which is an answer rather than a failure; its
/// own <c>Degraded</c> says the showcases are missing, and is set as well when the events could not
/// be read at all.
/// </param>
/// <param name="Degraded">
/// True when an upstream failed and this answer is missing what it would have supplied. It is
/// still a 200, deliberately — the page renders without the parts that failed rather than
/// failing — so this is the only thing that tells a caller not to cache what it builds from it. A
/// CDN cannot tell one 200 from another, and caching a failure outlives the failure.
/// </param>
public record HomeResponse(
    GameDto? Spotlight,
    IEnumerable<GameDto> Popular,
    IEnumerable<NewsItemDto> News,
    CalendarEventsDto Events,
    bool Degraded);
