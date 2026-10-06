using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services.Releases;

/// <summary>
/// The rules of <c>specs/release-timeline-and-calendar.md</c> §3.3 and §4: what IGDB answered for a
/// user's set, turned into what the two-week line and the calendar draw.
/// </summary>
/// <remarks>
/// Pure — rows and games in, entries out, with the set and the window the only other inputs — so that
/// every rule is tested against rows recorded from live IGDB (B5) rather than against a mock of the
/// query. What is cached is IGDB's answer, never this: the set's memberships change the reasons without
/// changing a single row, and composing is cheap enough to do on every request.
/// </remarks>
internal static class ConnectedReleases
{
    /// <summary>
    /// F1: what a player would call a release. The rest are F2's: a bundle, a mod, a fork, a pack and —
    /// by default, §9's second question — an update.
    /// </summary>
    private static readonly HashSet<int> KeptTypes =
    [
        IgdbGameTypes.MainGame,
        IgdbGameTypes.Dlc,
        IgdbGameTypes.Expansion,
        IgdbGameTypes.StandaloneExpansion,
        IgdbGameTypes.Episode,
        IgdbGameTypes.Season,
        IgdbGameTypes.Remake,
        IgdbGameTypes.Remaster,
        IgdbGameTypes.ExpandedGame,
        IgdbGameTypes.Port,
    ];

    /// <summary>
    /// How far up a chain of editions F3 follows. The Witcher 3's "10th Anniversary Edition" is an
    /// edition of its "Complete Edition", which is an edition of the game: two steps, seen live.
    /// </summary>
    private const int MaxEditionDepth = 4;

    /// <summary>A row's period: the day, or the whole month, quarter or year it is known to.</summary>
    internal readonly record struct Period(ReleasePrecision Precision, DateOnly Starts, DateOnly Ends);

    /// <summary>A row that survived the filters, with the game it is shown as and why.</summary>
    private sealed record Kept(ReleaseRow Row, CalendarGame Shown, Period Period, ReleaseReason Reason);

    /// <summary>What an F6 group is named after: a series, or the game a run of DLC belongs to.</summary>
    private sealed record GroupKey(string Id, string Name);

    /// <param name="set">The user's games, each under its strongest membership.</param>
    /// <param name="games">
    /// Every game IGDB described: the set's own, each row's, the editions' ancestors, and the games what is
    /// shown is DLC for.
    /// </param>
    /// <param name="to">Exclusive, like every window here.</param>
    public static IReadOnlyList<ReleaseEntry> Compose(
        IReadOnlyDictionary<int, SetMember> set,
        IReadOnlyDictionary<int, CalendarGame> games,
        IEnumerable<ReleaseRow> rows,
        DateOnly from,
        DateOnly to)
    {
        var setSeries = SeriesOf(set, games);

        var kept = new List<Kept>();
        foreach (var row in rows)
        {
            // A game IGDB would not describe is one nothing can be said about.
            if (!games.TryGetValue(row.GameId, out var released)) continue;

            // F1, F2. A row without a type is an old one, and old games were main games.
            if (!KeptTypes.Contains(released.GameType ?? IgdbGameTypes.MainGame)) continue;

            // F4: a shutdown, a cancellation, an alpha, an old game sold unchanged on a new console.
            if (row.Status is not (null or IgdbReleaseStatuses.FullRelease or IgdbReleaseStatuses.EarlyAccess)) continue;

            if (PeriodOf(row) is not { } period || period.Starts >= to || period.Ends < from) continue;

            // F3, then the relation of whatever the row is shown as.
            var shown = Fold(released, games);
            if (BestReason(released, shown, set, setSeries, games) is not { } reason) continue;

            kept.Add(new Kept(row, shown, period, reason));
        }

        var releases = kept
            .Where(k => !HasFinerRow(k, kept))
            .GroupBy(k => (k.Shown.Id, k.Period.Precision, k.Period.Starts))
            .Select(ToRelease)
            .ToList();

        return Group(releases, setSeries, games);
    }

    /// <summary>
    /// The period a row is known to (spec §4), from its <c>date_format</c> and its year and month —
    /// never from the stored date alone, which for a row known only to its year is the 31st of
    /// December. Null for a row with no date at all.
    /// </summary>
    internal static Period? PeriodOf(ReleaseRow row)
    {
        var year = row.Year ?? row.Date.Year;

        switch (row.DateFormat)
        {
            case null or 0:
                return new Period(ReleasePrecision.Day, row.Date, row.Date);

            case 1:
                var month = row.Month is >= 1 and <= 12 ? row.Month.Value : row.Date.Month;
                var monthStarts = new DateOnly(year, month, 1);
                return new Period(ReleasePrecision.Month, monthStarts, monthStarts.AddMonths(1).AddDays(-1));

            case 2:
                return new Period(ReleasePrecision.Year, new DateOnly(year, 1, 1), new DateOnly(year, 12, 31));

            // 3 to 6 are the first to the fourth quarter.
            case >= 3 and <= 6:
                var quarterStarts = new DateOnly(year, (row.DateFormat.Value - 3) * 3 + 1, 1);
                return new Period(ReleasePrecision.Quarter, quarterStarts, quarterStarts.AddMonths(3).AddDays(-1));

            // 7 is "to be decided": announced, with no date to put anywhere.
            default:
                return null;
        }
    }

    /// <summary>
    /// F3: an edition is shown as the game it is an edition of — "Grand Theft Auto VI: Ultimate
    /// Edition" is Grand Theft Auto VI.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Only a main game with a <c>version_parent</c> is an edition. Of 500 games carrying one, checked
    /// live on 2026-09-29, 426 were main games and 61 bundles, which F2 drops anyway; the ten remasters,
    /// expanded games and ports among them are products of their own, and folding one would hide that it
    /// is new.
    /// </para>
    /// <para>
    /// The same holds above an edition. The chain can pass through a bundle — the Witcher 3's "Complete
    /// Edition" is one — but a remaster, expanded game or port ends it, although it carries a
    /// <c>version_parent</c> of its own: "Rust: Console Edition - Ultimate" is an edition of Rust's console
    /// port, so it is the port, and not Rust. IGDB held seven such editions on 2026-10-04.
    /// </para>
    /// </remarks>
    internal static CalendarGame Fold(CalendarGame released, IReadOnlyDictionary<int, CalendarGame> games)
    {
        if ((released.GameType ?? IgdbGameTypes.MainGame) != IgdbGameTypes.MainGame) return released;

        var shown = released;
        for (var depth = 0; depth < MaxEditionDepth; depth++)
        {
            if (shown.VersionParentId is not int parentId || !games.TryGetValue(parentId, out var parent)) break;
            shown = parent;

            if ((parent.GameType ?? IgdbGameTypes.MainGame) is not (IgdbGameTypes.MainGame or IgdbGameTypes.Bundle)) break;
        }

        return shown;
    }

    /// <summary>
    /// The strongest reason the set gives for a release (spec §3.4): the relation first — the game itself
    /// before its children before its series — then the membership, a favourite before the wishlist
    /// before a list. Null when nothing in the set connects to it.
    /// </summary>
    private static ReleaseReason? BestReason(
        CalendarGame released,
        CalendarGame shown,
        IReadOnlyDictionary<int, SetMember> set,
        IReadOnlyDictionary<int, List<int>> setSeries,
        IReadOnlyDictionary<int, CalendarGame> games)
    {
        var candidates = new List<ReleaseReason>();

        void Offer(ReleaseRelation relation, int viaGameId, SeriesRef? series)
        {
            if (set.TryGetValue(viaGameId, out var member))
            {
                candidates.Add(new ReleaseReason(
                    relation, viaGameId, games.GetValueOrDefault(viaGameId)?.Name, member.Membership, member.ListKey, series));
            }
        }

        // R1. The edition itself counts too: somebody may have wishlisted the Ultimate Edition by name.
        Offer(ReleaseRelation.Itself, shown.Id, null);
        if (released.Id != shown.Id) Offer(ReleaseRelation.Itself, released.Id, null);

        // R2. A remaster, expanded game or port that IGDB links by version_parent rather than
        // parent_game is still a child: F3 left it standing as its own game. So is an edition whose own
        // version_parent is in the set, although F3 has folded it past that game — the query found it by
        // that link: with only the Witcher 3's Complete Edition on a list, its 10th Anniversary Edition is
        // shown as the game, and the Complete Edition is why.
        foreach (var parentId in new[] { shown.ParentGameId, released.ParentGameId, shown.VersionParentId, released.VersionParentId }.OfType<int>().Distinct())
            Offer(ReleaseRelation.Child, parentId, null);

        // R3, through any series the release shares with a game in the set.
        foreach (var series in shown.Series.Concat(released.Series).DistinctBy(s => s.Id))
        {
            if (!setSeries.TryGetValue(series.Id, out var members)) continue;
            foreach (var member in members.Where(id => id != shown.Id && id != released.Id))
                Offer(ReleaseRelation.Series, member, series);
        }

        return candidates.OrderBy(r => r, ReasonOrder).FirstOrDefault();
    }

    /// <summary>
    /// Whether the same game on the same platform has a row that says more, inside this row's period —
    /// "Oct 2026" beside "16 Oct 2026" is the same release known twice, and only the day is worth showing.
    /// </summary>
    private static bool HasFinerRow(Kept coarse, List<Kept> kept) =>
        coarse.Period.Precision != ReleasePrecision.Day
        && kept.Any(other =>
            other.Shown.Id == coarse.Shown.Id
            && other.Row.Platform?.Id == coarse.Row.Platform?.Id
            && other.Period.Precision < coarse.Period.Precision
            && other.Period.Starts >= coarse.Period.Starts
            && other.Period.Starts <= coarse.Period.Ends);

    /// <summary>F5: one release per game and period, its platforms merged.</summary>
    private static ConnectedRelease ToRelease(IGrouping<(int, ReleasePrecision, DateOnly), Kept> rows)
    {
        var first = rows.First();

        var platforms = rows
            .Select(k => k.Row.Platform)
            .OfType<PlatformDto>()
            .DistinctBy(p => p.Id)
            .OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new ConnectedRelease(
            first.Shown,
            first.Period.Precision,
            first.Period.Starts,
            platforms,
            EarlyAccess: rows.All(k => k.Row.Status == IgdbReleaseStatuses.EarlyAccess),
            rows.Select(k => k.Reason).OrderBy(r => r, ReasonOrder).First());
    }

    /// <summary>
    /// F6: releases in the same period that belong together become one entry — the same series, or,
    /// with no series between them, the same game they are DLC for. A group of one is just a release.
    /// </summary>
    /// <remarks>
    /// The parent game is this service's extension of F6, for §9's seventh question: on 13 October 2026
    /// Street Fighter 6 had two DLC rows for one character, "Year 4 - Arjun" and "Additional Character -
    /// Arjun &amp; Outfit 2", and neither is in a series.
    /// </remarks>
    private static List<ReleaseEntry> Group(
        List<ConnectedRelease> releases,
        IReadOnlyDictionary<int, List<int>> setSeries,
        IReadOnlyDictionary<int, CalendarGame> games)
    {
        var entries = new List<ReleaseEntry>();

        foreach (var period in releases.GroupBy(r => (r.Precision, r.Starts)))
        {
            foreach (var (key, group) in GroupsIn(period, setSeries, games))
            {
                if (key is not null && group.Count > 1)
                {
                    var members = group.OrderBy(r => r.Reason, ReasonOrder).ThenBy(r => r.Game.Name, StringComparer.OrdinalIgnoreCase).ToList();
                    entries.Add(new ReleaseEntry(period.Key.Precision, period.Key.Starts, key.Name, members));
                }
                else
                {
                    entries.AddRange(group.Select(r => new ReleaseEntry(r.Precision, r.Starts, null, [r])));
                }
            }
        }

        return entries
            .OrderBy(e => e.Starts)
            .ThenBy(e => e.Precision)
            .ThenBy(e => e.GroupName ?? e.Releases[0].Game.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>One period's releases, in the groups F6 makes of them: by series, then by the game they are DLC for.</summary>
    /// <remarks>
    /// A game can be in several of the set's series, so the series a release groups under is chosen across the
    /// period rather than from the release alone: the series the most of them share takes its releases first,
    /// then the one the most of the rest share, a tie going to the lowest id. Read from each release's own
    /// reason, two releases with a series in common could each cite a different one and stay apart — on
    /// 1 February 2026 Final Fantasy VII Remake and its Episode Intermission did, because IGDB lists their
    /// series in different orders and the reason takes the first.
    /// </remarks>
    private static List<(GroupKey? Key, List<ConnectedRelease> Group)> GroupsIn(
        IEnumerable<ConnectedRelease> period,
        IReadOnlyDictionary<int, List<int>> setSeries,
        IReadOnlyDictionary<int, CalendarGame> games)
    {
        // Every series each release shares with the set: its game's, and the one its reason names, which can
        // be an edition's.
        var left = period
            .Select(r => (Release: r, Series: r.Game.Series.Append(r.Reason.Series).OfType<SeriesRef>()
                .Where(s => setSeries.ContainsKey(s.Id)).DistinctBy(s => s.Id).ToList()))
            .ToList();

        var groups = new List<(GroupKey?, List<ConnectedRelease>)>();
        while (left
                   .SelectMany(l => l.Series)
                   .GroupBy(s => s.Id)
                   .Where(shared => shared.Count() > 1)
                   .OrderByDescending(shared => shared.Count())
                   .ThenBy(shared => shared.Key)
                   .Select(shared => shared.First())
                   .FirstOrDefault() is { } series)
        {
            groups.Add((new GroupKey($"series:{series.Id}", series.Name),
                left.Where(l => l.Series.Any(s => s.Id == series.Id)).Select(l => l.Release).ToList()));
            left.RemoveAll(l => l.Series.Any(s => s.Id == series.Id));
        }

        // What no series gathered, by the game it is DLC for: F6's "with no series between them".
        foreach (var byParent in left.GroupBy(l => l.Release.Game.ParentGameId is int parentId && games.TryGetValue(parentId, out var parent)
                     ? new GroupKey($"game:{parentId}", parent.Name)
                     : null))
        {
            groups.Add((byParent.Key, byParent.Select(l => l.Release).ToList()));
        }

        return groups;
    }

    /// <summary>The series the set's games are in, and which of the set's games are in each.</summary>
    private static Dictionary<int, List<int>> SeriesOf(
        IReadOnlyDictionary<int, SetMember> set,
        IReadOnlyDictionary<int, CalendarGame> games)
    {
        var series = new Dictionary<int, List<int>>();
        foreach (var gameId in set.Keys)
        {
            if (!games.TryGetValue(gameId, out var game)) continue;
            foreach (var s in game.Series)
            {
                if (!series.TryGetValue(s.Id, out var members)) series[s.Id] = members = [];
                members.Add(gameId);
            }
        }

        return series;
    }

    /// <summary>§3.4's order, and after it the title, so that a tie comes out the same way every time.</summary>
    private static readonly Comparer<ReleaseReason> ReasonOrder = Comparer<ReleaseReason>.Create((a, b) =>
    {
        var byRelation = a.Relation.CompareTo(b.Relation);
        if (byRelation != 0) return byRelation;

        var byMembership = a.Membership.CompareTo(b.Membership);
        if (byMembership != 0) return byMembership;

        var byTitle = StringComparer.OrdinalIgnoreCase.Compare(a.ViaTitle, b.ViaTitle);
        return byTitle != 0 ? byTitle : a.ViaGameId.CompareTo(b.ViaGameId);
    });
}
