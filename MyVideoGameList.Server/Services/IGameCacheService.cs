using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Game metadata for ids this app already holds, served from our own database and refreshed from
/// IGDB in the background of a request.
/// </summary>
/// <remarks>
/// <para>
/// This is what the pages about a person's own data ask, instead of asking IGDB directly. A list,
/// a wishlist, a shelf of favourites and a public profile are all our rows; IGDB only supplies the
/// title and the cover, and until this existed an IGDB outage meant a user could not see their own
/// library — which is the oldest open item in the roadmap's structural issues.
/// </para>
/// <para>
/// It answers for <em>known ids</em> only. Browse and search stay on <see cref="IIgdbService"/>,
/// because those are arbitrary queries over the whole catalogue rather than lookups of games
/// somebody already tracks, and no local copy could answer them.
/// </para>
/// </remarks>
public interface IGameCacheService
{
    /// <summary>
    /// The games for these ids, in the order asked for, skipping any this app has never
    /// successfully fetched.
    /// </summary>
    /// <remarks>
    /// Never throws because of IGDB. When IGDB cannot be reached, the answer is whatever is
    /// stored, however old — a stale shelf is better than no shelf, and the alternative is a page
    /// about the reader's own data failing because a third party is down.
    /// </remarks>
    Task<IReadOnlyList<GameDto>> GetGamesAsync(
        IEnumerable<int> ids, CancellationToken cancellationToken = default);
}
