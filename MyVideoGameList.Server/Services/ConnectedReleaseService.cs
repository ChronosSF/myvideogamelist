using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Releases;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Reads a user's set from our tables, asks IGDB what is connected to it, and hands both to
/// <see cref="ConnectedReleases"/>.
/// </summary>
/// <remarks>
/// <para>
/// Nothing about a user's connected releases is stored (spec §8.1, ADR 0012): IGDB's answer is kept in
/// memory for an hour under a key built from the set's game ids, so adding a game to a list changes the
/// answer at once and two people with the same games share one. What is cached is IGDB's answer rather
/// than the entries, because moving a game from the wishlist to Playing changes the reasons without
/// changing a single row.
/// </para>
/// <para>
/// An IGDB failure is not caught: it reaches the caller as a 502, and the line says the releases are
/// missing while the curated sales, which are ours, still show.
/// </para>
/// </remarks>
public class ConnectedReleaseService(
    ApplicationDbContext db,
    IIgdbService igdb,
    IMemoryCache cache) : IConnectedReleaseService
{
    private static readonly TimeSpan AnswerLifetime = TimeSpan.FromHours(1);

    /// <summary>
    /// How many generations of edition ancestors are fetched for F3. Two were seen live — the Witcher
    /// 3's "10th Anniversary Edition" of its "Complete Edition" — and each round is a query.
    /// </summary>
    private const int EditionRounds = 3;

    /// <summary>IGDB's answer for one set and window: every game it described, and the rows.</summary>
    private sealed record IgdbAnswer(IReadOnlyDictionary<int, CalendarGame> Games, IReadOnlyList<ReleaseRow> Rows);

    public async Task<IReadOnlyList<ReleaseEntryDto>> GetAsync(
        string userId,
        DateOnly from,
        DateOnly to,
        bool withPeriods,
        CancellationToken cancellationToken = default)
    {
        var set = await ReadSetAsync(userId, cancellationToken);
        if (set.Count == 0) return [];

        var answer = await AskIgdbAsync(set.Keys, from, to, withPeriods, cancellationToken);

        return ConnectedReleases.Compose(set, answer.Games, answer.Rows, from, to)
            .Select(ToDto)
            .ToList();
    }

    /// <summary>
    /// The user's set (spec §3.1): favourites, the wishlist, and every list but Dropped — each game
    /// under its strongest membership.
    /// </summary>
    /// <remarks>
    /// Dropped is out by default, which is §9's first question. So is an entry that has left every list
    /// (ADR 0019): it is kept for a score or a review, not out of interest in what comes next.
    /// </remarks>
    internal async Task<Dictionary<int, SetMember>> ReadSetAsync(string userId, CancellationToken cancellationToken)
    {
        var favourites = await db.UserFavourites.AsNoTracking()
            .Where(f => f.UserId == userId)
            .Select(f => f.GameId)
            .ToListAsync(cancellationToken);

        var wishlist = await db.UserWishlistItems.AsNoTracking()
            .Where(w => w.UserId == userId)
            .Select(w => w.GameId)
            .ToListAsync(cancellationToken);

        var listed = await db.UserGameEntries.AsNoTracking()
            .Where(e => e.UserId == userId && e.Status != null && e.Status.Key != ListStatusKeys.Dropped)
            .Select(e => new { e.GameId, e.Status!.Key })
            .ToListAsync(cancellationToken);

        var set = new Dictionary<int, SetMember>();

        void Offer(int gameId, SetMembership membership, string? listKey)
        {
            if (!set.TryGetValue(gameId, out var current) || membership < current.Membership)
                set[gameId] = new SetMember(gameId, membership, listKey);
        }

        foreach (var gameId in favourites) Offer(gameId, SetMembership.Favourite, null);
        foreach (var gameId in wishlist) Offer(gameId, SetMembership.Wishlist, null);
        foreach (var entry in listed) Offer(entry.GameId, SetMembership.List, entry.Key);

        return set;
    }

    private async Task<IgdbAnswer> AskIgdbAsync(
        IEnumerable<int> setIds,
        DateOnly from,
        DateOnly to,
        bool withPeriods,
        CancellationToken cancellationToken)
    {
        var ids = setIds.Order().ToList();
        var key = $"connected_releases|{Fingerprint(ids)}|{from:yyyy-MM-dd}|{to:yyyy-MM-dd}|{(withPeriods ? "periods" : "days")}";
        if (cache.TryGetValue(key, out IgdbAnswer? cached) && cached is not null) return cached;

        // The set's own games first: their series are what R3 asks about, and their names are what the
        // reasons quote.
        var games = new Dictionary<int, CalendarGame>(await igdb.GetCalendarGamesAsync(ids, cancellationToken));
        var seriesIds = games.Values.SelectMany(g => g.Series).Select(s => s.Id).Distinct().ToList();

        var fetched = await igdb.GetConnectedReleaseRowsAsync(ids, seriesIds, from, to, withPeriods, cancellationToken);

        await AddAsync(games, fetched.Rows.Select(r => r.GameId), cancellationToken);

        // The games editions fold into (F3), a generation at a time.
        for (var round = 0; round < EditionRounds; round++)
        {
            var ancestors = games.Values.Select(g => g.VersionParentId).OfType<int>().Where(id => !games.ContainsKey(id)).ToList();
            if (ancestors.Count == 0) break;
            await AddAsync(games, ancestors, cancellationToken);
        }

        var answer = new IgdbAnswer(games, fetched.Rows);

        // A partial answer is never kept (§8.1): the next request gets another try at all of it.
        if (!fetched.Truncated) cache.Set(key, answer, AnswerLifetime);
        return answer;
    }

    private async Task AddAsync(Dictionary<int, CalendarGame> games, IEnumerable<int> ids, CancellationToken cancellationToken)
    {
        var missing = ids.Where(id => !games.ContainsKey(id)).Distinct().ToList();
        if (missing.Count == 0) return;

        foreach (var (id, game) in await igdb.GetCalendarGamesAsync(missing, cancellationToken))
            games[id] = game;
    }

    /// <summary>
    /// The set's ids as a short key. A hash rather than the list itself, which for a 1,500-game library
    /// would be a ten-kilobyte cache key.
    /// </summary>
    private static string Fingerprint(IEnumerable<int> sortedIds) =>
        Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(string.Join(',', sortedIds))));

    private static ReleaseEntryDto ToDto(ReleaseEntry entry) =>
        new(Precision(entry.Precision), entry.Starts, entry.GroupName, entry.Releases.Select(ToDto).ToList());

    private static ConnectedReleaseDto ToDto(ConnectedRelease release) =>
        new(
            release.Game.Id,
            release.Game.Name,
            release.Game.CoverImageUrl,
            Kind(release.Game.GameType),
            release.Platforms,
            release.EarlyAccess,
            new ReleaseReasonDto(
                release.Reason.Relation switch
                {
                    ReleaseRelation.Itself => "itself",
                    ReleaseRelation.Child => "child",
                    _ => "series",
                },
                release.Reason.ViaGameId,
                release.Reason.ViaTitle,
                release.Reason.Membership switch
                {
                    SetMembership.Favourite => "favourite",
                    SetMembership.Wishlist => "wishlist",
                    _ => "list",
                },
                release.Reason.ListKey,
                release.Reason.Series?.Name));

    private static string Precision(ReleasePrecision precision) => precision switch
    {
        ReleasePrecision.Day => "day",
        ReleasePrecision.Month => "month",
        ReleasePrecision.Quarter => "quarter",
        _ => "year",
    };

    /// <summary>Only the types F1 keeps can reach here; an unknown one is a game, as an untyped one is.</summary>
    private static string Kind(int? gameType) => gameType switch
    {
        IgdbGameTypes.Dlc => "dlc",
        IgdbGameTypes.Expansion => "expansion",
        IgdbGameTypes.StandaloneExpansion => "standalone_expansion",
        IgdbGameTypes.Episode => "episode",
        IgdbGameTypes.Season => "season",
        IgdbGameTypes.Remake => "remake",
        IgdbGameTypes.Remaster => "remaster",
        IgdbGameTypes.ExpandedGame => "expanded_game",
        IgdbGameTypes.Port => "port",
        _ => "game",
    };
}
