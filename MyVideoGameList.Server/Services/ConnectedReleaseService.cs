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

    /// <summary>IGDB's answer about one set's undated releases: every game it described, and the rows.</summary>
    private sealed record UndatedAnswer(IReadOnlyDictionary<int, CalendarGame> Games, IReadOnlyList<UndatedRow> Rows);

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

    /// <summary>
    /// The connected games IGDB has no date for at all (K4), grouped and each with its reason — the
    /// calendar's "Announced, no date".
    /// </summary>
    public async Task<IReadOnlyList<UndatedEntryDto>> GetUndatedAsync(string userId, CancellationToken cancellationToken = default)
    {
        var set = await ReadSetAsync(userId, cancellationToken);
        if (set.Count == 0) return [];

        var ids = set.Keys.Order().ToList();
        var key = $"connected_undated|{Fingerprint(ids)}";
        if (!cache.TryGetValue(key, out UndatedAnswer? answer) || answer is null)
        {
            var games = new Dictionary<int, CalendarGame>(await igdb.GetCalendarGamesAsync(ids, cancellationToken));
            var seriesIds = games.Values.SelectMany(g => g.Series).Select(s => s.Id).Distinct().ToList();

            var fetched = await igdb.GetUndatedReleaseRowsAsync(ids, seriesIds, cancellationToken);
            await DescribeAsync(games, fetched.Rows.Select(r => r.GameId), cancellationToken);

            answer = new UndatedAnswer(games, fetched.Rows);
            if (!fetched.Truncated) cache.Set(key, answer, AnswerLifetime);
        }

        return ConnectedReleases.ComposeUndated(set, answer.Games, answer.Rows)
            .Select(entry => new UndatedEntryDto(entry.GroupName, entry.Releases
                .Select(r => ToDto(r.Game, r.Platforms, r.EarlyAccess, r.Reason))
                .ToList()))
            .ToList();
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
        await DescribeAsync(games, fetched.Rows.Select(r => r.GameId), cancellationToken);

        var rows = fetched.Rows;
        var truncated = fetched.Truncated;

        if (withPeriods && BandsPastTheWindow(fetched.Rows, games, from, to) is { } around)
        {
            var more = await igdb.GetReleaseRowsAsync(around.GameIds, around.From, around.To, cancellationToken);
            await DescribeAsync(games, more.Rows.Select(r => r.GameId), cancellationToken);

            // The window's own rows for those games come back too.
            var known = rows.Select(r => r.Id).ToHashSet();
            rows = [.. rows, .. more.Rows.Where(r => !known.Contains(r.Id))];
            truncated |= more.Truncated;
        }

        var answer = new IgdbAnswer(games, rows);

        // A partial answer is never kept (§8.1): the next request gets another try at all of it.
        if (!truncated) cache.Set(key, answer, AnswerLifetime);
        return answer;
    }

    /// <summary>
    /// The games the rows' bands are of, and the days of their periods, where a band runs past the window —
    /// what F5 has to see the rest of, or a band would stand for a release whose day is known just outside
    /// it.
    /// </summary>
    /// <remarks>
    /// A calendar opening on 1 October asks nothing about September, so "2026" on Switch would stand beside
    /// nothing although the same game came out on Switch on 16 September. One more query, for only the games
    /// with such a band and only over their periods, rather than the whole window widened to the years at
    /// either end of it. The game each band is shown as is asked about too, since an edition's day hides its
    /// game's year (F3). Null when no band runs past the window.
    /// </remarks>
    internal static (IReadOnlyCollection<int> GameIds, DateOnly From, DateOnly To)? BandsPastTheWindow(
        IEnumerable<ReleaseRow> rows,
        IReadOnlyDictionary<int, CalendarGame> games,
        DateOnly from,
        DateOnly to)
    {
        var ids = new HashSet<int>();
        DateOnly? first = null, last = null;

        foreach (var row in rows)
        {
            if (ConnectedReleases.PeriodOf(row) is not { Precision: not ReleasePrecision.Day } period) continue;
            if (period.Starts >= to || period.Ends < from) continue;
            if (period.Starts >= from && period.Ends < to) continue;

            ids.Add(row.GameId);
            if (games.TryGetValue(row.GameId, out var released)) ids.Add(ConnectedReleases.Fold(released, games).Id);

            if (first is null || period.Starts < first) first = period.Starts;
            if (last is null || period.Ends > last) last = period.Ends;
        }

        return first is { } starts && last is { } ends ? (ids, starts, ends.AddDays(1)) : null;
    }

    /// <summary>
    /// Adds what the rules need to know about the games the rows name: the games themselves, the games
    /// editions fold into (F3), and the games what is shown is DLC for (F6).
    /// </summary>
    private async Task DescribeAsync(Dictionary<int, CalendarGame> games, IEnumerable<int> rowGameIds, CancellationToken cancellationToken)
    {
        var released = rowGameIds.Distinct().ToList();
        await AddAsync(games, released, cancellationToken);

        // The games editions fold into (F3), a generation at a time.
        for (var round = 0; round < EditionRounds; round++)
        {
            var ancestors = games.Values.Select(g => g.VersionParentId).OfType<int>().Where(id => !games.ContainsKey(id)).ToList();
            if (ancestors.Count == 0) break;
            await AddAsync(games, ancestors, cancellationToken);
        }

        // The games what is shown is DLC for, which F6 names a group of them after. That game need not be in
        // the set — somebody can wishlist two Street Fighter 6 characters without Street Fighter 6 — and the
        // group cannot be named after a game nobody described. Asked after the editions, because what is
        // shown is what an edition folds into.
        var parents = released
            .Select(games.GetValueOrDefault)
            .OfType<CalendarGame>()
            .Select(g => ConnectedReleases.Fold(g, games).ParentGameId)
            .OfType<int>()
            .ToList();
        await AddAsync(games, parents, cancellationToken);
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
        ToDto(release.Game, release.Platforms, release.EarlyAccess, release.Reason);

    private static ConnectedReleaseDto ToDto(
        CalendarGame game, IReadOnlyList<PlatformDto> platforms, bool earlyAccess, ReleaseReason reason) =>
        new(
            game.Id,
            game.Name,
            game.CoverImageUrl,
            Kind(game.GameType),
            platforms,
            earlyAccess,
            new ReleaseReasonDto(
                reason.Relation switch
                {
                    ReleaseRelation.Itself => "itself",
                    ReleaseRelation.Child => "child",
                    _ => "series",
                },
                reason.ViaGameId,
                reason.ViaTitle,
                reason.Membership switch
                {
                    SetMembership.Favourite => "favourite",
                    SetMembership.Wishlist => "wishlist",
                    _ => "list",
                },
                reason.ListKey,
                reason.Series?.Name));

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
