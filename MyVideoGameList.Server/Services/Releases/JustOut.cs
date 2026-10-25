namespace MyVideoGameList.Server.Services.Releases;

/// <summary>
/// The rules of the home page's Just out panel (ADR 0073): the new games of the last ninety days that are
/// watched the most on Twitch, by IGDB's own count, with the admin's hides as the only correction. Coming
/// soon's mirror: that panel ends where this one starts, on today.
/// </summary>
/// <remarks>
/// Pure, like <see cref="ComingSoon"/> — candidates in, the panel out — so every rule is tested against rows
/// recorded from live IGDB. What is cached is IGDB's answer, for a day; this runs on every composition of
/// the home page, so a game leaves the panel the day its ninety days are up however old that answer is.
/// </remarks>
internal static class JustOut
{
    /// <summary>How far back the panel looks, from today.</summary>
    public const int WindowDays = 90;

    /// <summary>The most games the panel shows.</summary>
    public const int MaxShown = 10;

    /// <param name="candidates">What IGDB answered: the most watched games with a release row in the window.</param>
    /// <param name="hidden">The games the admin keeps off the home page's panels.</param>
    /// <param name="today">The UTC day the panel is composed on.</param>
    /// <returns>At most <see cref="MaxShown"/> of the most watched games, the newest first.</returns>
    /// <remarks>
    /// No floor beside the cap, unlike Coming soon's follows: on 2026-10-25 seventy games passed the rules,
    /// and IGDB's counts of follows and ratings are small for a game this new — Madden NFL 27, eighth most
    /// watched, had two follows and one rating — so a floor on either would cut games people are playing.
    /// A game that should not be there is the admin's to hide.
    /// </remarks>
    public static IReadOnlyList<JustOutRelease> Compose(
        IEnumerable<JustOutCandidate> candidates, IReadOnlySet<int> hidden, DateOnly today)
    {
        var windowStarts = today.AddDays(-WindowDays);
        var eligible = new List<(JustOutRelease Release, double Watched)>();

        foreach (var candidate in candidates.DistinctBy(c => c.Game.Id))
        {
            var game = candidate.Game;
            if (hidden.Contains(game.Id)) continue;

            // Stated again although the query asks the same, as Coming soon states its own.
            if (!ComingSoon.GameTypes.Contains(game.GameType ?? IgdbGameTypes.MainGame) || game.VersionParentId is not null) continue;

            if (FirstRelease(game, candidate.Rows, today, windowStarts) is { } release)
                eligible.Add((release, candidate.Watched));
        }

        return eligible
            .OrderByDescending(e => e.Watched)
            .ThenBy(e => e.Release.Game.Id)
            .Take(MaxShown)
            .Select(e => e.Release)
            // The newest first, so that the panel reads back from today as Coming soon reads forward.
            .OrderByDescending(r => r.Released)
            .ThenBy(r => r.Game.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// The day of the game's first full release, when that is in the window, with every platform it has been
    /// fully released on since; null otherwise.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The release is a full release on a known day. Early access and IGDB's paid early start are not the
    /// release — Enshrouded, in early access since January 2024, came out on the 15th of October 2026 — and a
    /// month, a quarter or a year inside the window says too little to put a day on the card.
    /// </para>
    /// <para>
    /// The first such day decides, so a game out years ago with a new platform in the window is not just out,
    /// as Coming soon does not count it as coming. A full release IGDB knows only to a month, a quarter or a
    /// year that ended before the window says the same: an older game IGDB dates only to "2019" is out, and
    /// its port this autumn is the port's news, not the game's. That can hide a new game whose date IGDB
    /// planned and never came back to on one platform; none of the seventy-one games that passed on
    /// 2026-10-25 had such a row, and a game missing from the front page is a smaller wrong than an old one
    /// on it as new.
    /// </para>
    /// <para>
    /// And the day has to be before today: a game out today is still Coming soon's, so the two panels never
    /// show one game at once.
    /// </para>
    /// </remarks>
    private static JustOutRelease? FirstRelease(
        CalendarGame game, IReadOnlyList<ReleaseRow> rows, DateOnly today, DateOnly windowStarts)
    {
        var known = rows
            .Where(r => r.Status is null or IgdbReleaseStatuses.FullRelease)
            .Select(r => (Row: r, Period: ConnectedReleases.PeriodOf(r)))
            .Where(r => r.Period is not null)
            .Select(r => (r.Row, Period: r.Period!.Value))
            .ToList();

        if (known.Any(k => k.Period.Precision != ReleasePrecision.Day && k.Period.Ends < windowStarts)) return null;

        var days = known
            .Where(k => k.Period.Precision == ReleasePrecision.Day)
            .Select(k => (k.Row, Day: k.Period.Starts))
            .ToList();
        if (days.Count == 0) return null;

        var first = days.Min(d => d.Day);
        if (first >= today || first < windowStarts) return null;

        var platforms = ConnectedReleases.MergedPlatforms(days.Where(d => d.Day < today).Select(d => d.Row.Platform));
        return new JustOutRelease(game, first, platforms);
    }
}
