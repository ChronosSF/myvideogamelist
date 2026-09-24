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

    /// <summary>
    /// Stores games the caller already has from IGDB, so that reading them back costs nothing.
    /// </summary>
    /// <remarks>
    /// <para>
    /// For the caller that went to IGDB for some other reason — the import matcher searches for
    /// titles and gets whole games back — and knows those games are about to be rendered through
    /// this cache. Without it the next read asks IGDB again for ids that were in hand a moment
    /// before.
    /// </para>
    /// <para>
    /// It stores only what it is given and writes no tombstone: an id absent from the list is one
    /// the caller said nothing about, not one IGDB has no answer for. That distinction belongs to
    /// <see cref="GetGamesAsync"/>, which is the method that actually asked. A row already inside
    /// the refresh interval is left as it is, since this has no newer answer for it.
    /// </para>
    /// <para>
    /// <b>Browse and search deliberately do not call this</b>, although they hold twenty mapped
    /// games each and throw them away. This table is a copy of what IGDB said about games somebody
    /// <em>tracks</em> (ADR 0035), nothing sweeps it, and filling it from every page of a listing
    /// would grow it without bound with games nobody has. A caller belongs here when the games it
    /// is storing are about to be read back through this cache.
    /// </para>
    /// <para>
    /// Never throws for the write. A cache that cannot be written is a page that is slower next
    /// time; a cache that throws is the caller's real work failing for an optimisation.
    /// </para>
    /// </remarks>
    Task StoreAsync(IReadOnlyCollection<GameDto> games, CancellationToken cancellationToken = default);
}
