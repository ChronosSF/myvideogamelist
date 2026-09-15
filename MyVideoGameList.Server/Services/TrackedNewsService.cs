using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Steam news for the games one user tracks — the <c>/news</c> page (ROADMAP N6).
/// </summary>
/// <remarks>
/// <para>
/// A thin layer over <see cref="ISteamNewsService.GetLatestNewsAsync"/>, which already takes any set
/// of games. What this adds is <em>which</em> games, and in what order, because that order is not
/// cosmetic: the aggregate fans out to at most a dozen Steam-backed games and keeps the ones it was
/// given first. So the user's games are handed over most relevant first.
/// </para>
/// <list type="number">
/// <item>Games in progress — Playing, then On Hold. Patch notes matter most for a game being played.</item>
/// <item>The wishlist. Announcements and dates for the games somebody is waiting for.</item>
/// <item>The backlog. Games they mean to start.</item>
/// <item>Finished, then Dropped. Resolved already, so least likely to be news to anybody.</item>
/// </list>
/// <para>
/// Within each, the most recently moved or wishlisted first. The groups are read from the status
/// flags and <c>SortOrder</c> rather than from keys, as every other query over the statuses is, so a
/// status added later lands in the group its flags describe without an edit here.
/// </para>
/// <para>
/// Holds nothing between requests, like the service it wraps (ADR 0012): the lists are read fresh,
/// and the feeds and the AppID map are that service's cache.
/// </para>
/// </remarks>
public class TrackedNewsService(ApplicationDbContext db, ISteamNewsService steamNews) : ITrackedNewsService
{
    /// <summary>How many items the page shows.</summary>
    private const int NewsCount = 20;

    /// <summary>
    /// Items any one game may contribute. A game mid-tournament posts several announcements a day and
    /// would otherwise bury everything else the user plays — the home rail's reason for its own cap.
    /// </summary>
    private const int MaxNewsPerGame = 3;

    /// <summary>
    /// How many of the user's games are handed on at all. Every one of them is resolved to a Steam
    /// AppID before the aggregate keeps its dozen, so without a bound an imported 2,000-game library
    /// would ask IGDB about all 2,000 to show news from twelve. Fifty leaves room for the games with no
    /// Steam presence that the aggregate skips over.
    /// </summary>
    internal const int MaxCandidateGames = 50;

    /// <summary>The wishlist's place among the groups described on the class.</summary>
    private const int WishlistGroup = 1;

    public async Task<IReadOnlyList<NewsItemDto>> GetNewsAsync(
        string userId, CancellationToken cancellationToken = default)
    {
        var gameIds = await GetTrackedGameIdsAsync(userId, cancellationToken);
        if (gameIds.Count == 0) return [];

        return await steamNews.GetLatestNewsAsync(gameIds, NewsCount, MaxNewsPerGame, cancellationToken);
    }

    /// <summary>
    /// The user's listed and wishlisted games, most relevant first, each once, and at most
    /// <see cref="MaxCandidateGames"/> of them.
    /// </summary>
    internal async Task<IReadOnlyList<int>> GetTrackedGameIdsAsync(
        string userId, CancellationToken cancellationToken)
    {
        // An entry in no list is a game the user has data about but is not tracking (ADR 0019).
        var entries = await db.UserGameEntries
            .AsNoTracking()
            .Where(e => e.UserId == userId && e.StatusId != null)
            .Select(e => new
            {
                e.GameId,
                e.Status!.IsStarted,
                e.Status.IsTerminal,
                e.Status.SortOrder,
                MovedAt = e.StatusChangedAt ?? e.AddedAt,
            })
            .ToListAsync(cancellationToken);

        var wishlist = await db.UserWishlistItems
            .AsNoTracking()
            .Where(w => w.UserId == userId)
            .Select(w => new { w.GameId, w.AddedAt })
            .ToListAsync(cancellationToken);

        return entries
            .Select(e => (e.GameId, Group: Group(e.IsStarted, e.IsTerminal), Order: (int)e.SortOrder, At: e.MovedAt))
            .Concat(wishlist.Select(w => (w.GameId, Group: WishlistGroup, Order: 0, At: w.AddedAt)))
            .OrderBy(g => g.Group)
            .ThenBy(g => g.Order)
            .ThenByDescending(g => g.At)
            // Ties broken on the id, so the order never depends on the order the rows were read in.
            .ThenBy(g => g.GameId)
            .Select(g => g.GameId)
            // First occurrence wins, so a game both in a list and on the wishlist keeps the higher place.
            .Distinct()
            .Take(MaxCandidateGames)
            .ToList();
    }

    private static int Group(bool isStarted, bool isTerminal) => (isStarted, isTerminal) switch
    {
        (true, false) => 0,
        (false, _) => 2,
        (true, true) => 3,
    };
}
