namespace MyVideoGameList.Server.Services.Releases;

/// <summary>
/// The rules of the home page's Coming soon panel (ADR 0071): the new games first released in the next
/// ninety days that the most people are waiting for, by IGDB's own count of follows ahead of release, with
/// the admin's pins and hides as the only corrections.
/// </summary>
/// <remarks>
/// Pure, like <see cref="ConnectedReleases"/> — candidates in, the panel out, with the day and the picks the
/// only other inputs — so every rule is tested against rows recorded from live IGDB. What is cached is
/// IGDB's answer, for a day; this runs on every composition of the home page, so a game leaves the panel
/// the day it comes out however old that answer is.
/// </remarks>
internal static class ComingSoon
{
    /// <summary>How far ahead the panel looks, from today.</summary>
    public const int WindowDays = 90;

    /// <summary>The most games the panel shows, pinned ones included.</summary>
    public const int MaxShown = 10;

    /// <summary>
    /// The fewest follows a game needs to be shown without a pin. On 2026-10-25 the tenth most followed game
    /// that passed the rules had 48 and the twentieth 20, so it is the cap of ten that binds; this is what
    /// keeps a quiet stretch from filling the panel with games nobody has heard of.
    /// </summary>
    public const int MinHypes = 20;

    /// <summary>
    /// New games only: a main game, a standalone expansion, a remake or a remaster. Not DLC, a port, a bundle
    /// or an update — what the panel is for is a game people are waiting for, and the rest would fill it with
    /// expansions and with ports of last year's games to new consoles.
    /// </summary>
    public static readonly IReadOnlyList<int> GameTypes =
    [
        IgdbGameTypes.MainGame,
        IgdbGameTypes.StandaloneExpansion,
        IgdbGameTypes.Remake,
        IgdbGameTypes.Remaster,
    ];

    /// <param name="candidates">What IGDB answered: the most followed upcoming games, and the pinned ones.</param>
    /// <param name="today">The UTC day the panel is composed on.</param>
    /// <returns>
    /// At most <see cref="MaxShown"/> games: the pinned ones that pass the rules, then the most followed of
    /// the rest. In the order the panel draws them, by when they arrive.
    /// </returns>
    public static IReadOnlyList<ComingSoonRelease> Compose(
        IEnumerable<ComingSoonCandidate> candidates,
        IReadOnlySet<int> pinned,
        IReadOnlySet<int> hidden,
        DateOnly today)
    {
        var windowEnds = today.AddDays(WindowDays);
        var eligible = new List<(ComingSoonRelease Release, int Hypes, bool Pinned)>();

        foreach (var candidate in candidates.DistinctBy(c => c.Game.Id))
        {
            var game = candidate.Game;
            if (hidden.Contains(game.Id)) continue;

            // A pinned game is asked for by its id, so the query's filters have not seen it: these are
            // stated again here, where they hold for it as well.
            if (!GameTypes.Contains(game.GameType ?? IgdbGameTypes.MainGame) || game.VersionParentId is not null) continue;
            if (!ConnectedReleases.IsAnnounced(game)) continue;

            // A pin carries a game past the follows it lacks and past the cap, but never past the dates: the
            // panel says when, and a game with nothing to say there has no place on it.
            var isPinned = pinned.Contains(game.Id);
            if (!isPinned && candidate.Hypes < MinHypes) continue;

            if (FirstRelease(game, candidate.Rows, today, windowEnds) is { } release)
                eligible.Add((release, candidate.Hypes, isPinned));
        }

        return eligible
            .OrderByDescending(e => e.Pinned)
            .ThenByDescending(e => e.Hypes)
            .ThenBy(e => e.Release.Game.Id)
            .Take(MaxShown)
            .Select(e => e.Release)
            // By when the period ends, so that "Q1 2027" follows the days of January rather than leading them.
            .OrderBy(r => Ends(r.Precision, r.Starts))
            .ThenBy(r => r.Precision)
            .ThenBy(r => r.Game.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// The game's first full release in the window, or null when it has none there — or is out already.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Only full releases count: an alpha, a beta, early access or the paid early start IGDB calls advanced
    /// access is not the release people are waiting for. A year alone is not a date the panel can stand
    /// behind — in late October a bare "2026" is more often a delay to come than a promise — so a game known
    /// only to its year waits until IGDB knows more.
    /// </para>
    /// <para>
    /// A full release on a day already past means the game is out somewhere: a later platform or region is
    /// not news for everybody. A month or a quarter already past is not the same thing — it is a date IGDB
    /// never came back to — so it is passed over rather than taken as a release.
    /// </para>
    /// <para>
    /// Of the rows in the window, the finest wins and then the earliest: a game known to arrive on the 19th
    /// of November on two consoles and "in Q1" on a third is a November game, on those two.
    /// </para>
    /// </remarks>
    private static ComingSoonRelease? FirstRelease(
        CalendarGame game, IReadOnlyList<ReleaseRow> rows, DateOnly today, DateOnly windowEnds)
    {
        var known = rows
            .Where(r => r.Status is null or IgdbReleaseStatuses.FullRelease)
            .Select(r => (Row: r, Period: ConnectedReleases.PeriodOf(r)))
            .Where(r => r.Period is { Precision: not ReleasePrecision.Year })
            .Select(r => (r.Row, Period: r.Period!.Value))
            .ToList();

        if (known.Any(k => k.Period.Precision == ReleasePrecision.Day && k.Period.Starts < today)) return null;

        var inWindow = known
            .Where(k => k.Period.Starts < windowEnds && k.Period.Ends >= today)
            .ToList();
        if (inWindow.Count == 0) return null;

        var first = inWindow.OrderBy(k => k.Period.Precision).ThenBy(k => k.Period.Starts).First();
        var platforms = ConnectedReleases.MergedPlatforms(
            inWindow.Where(k => k.Period == first.Period).Select(k => k.Row.Platform));

        return new ComingSoonRelease(game, first.Period.Precision, first.Period.Starts, platforms);
    }

    /// <summary>The last day of a period: the day itself, or the month's or the quarter's last.</summary>
    private static DateOnly Ends(ReleasePrecision precision, DateOnly starts) => precision switch
    {
        ReleasePrecision.Month => starts.AddMonths(1).AddDays(-1),
        ReleasePrecision.Quarter => starts.AddMonths(3).AddDays(-1),
        _ => starts,
    };
}
