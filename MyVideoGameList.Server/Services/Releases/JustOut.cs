namespace MyVideoGameList.Server.Services.Releases;

/// <summary>
/// The rules of the home page's Just out panel (ADR 0073, 0104): the new games of the last ninety days that
/// people followed the most ahead of their release and the ones watched the most on Twitch, both by IGDB's
/// own count and turn about, with the admin's pins and hides as the only corrections. Coming soon's mirror:
/// that panel ends where this one starts, on today.
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

    /// <summary>
    /// The most games the panel shows. Nine, because the client's grid leads with one at two columns by two
    /// rows and gives the other eight a cell each: twelve cells, which fill two, three, four or six columns
    /// with no gap left over, and those are the grid's only widths (ADR 0075).
    /// </summary>
    public const int MaxShown = 9;

    /// <param name="candidates">
    /// What IGDB answered: the most watched and the most followed games with a release row in the window, and
    /// the pinned ones.
    /// </param>
    /// <param name="pinned">The games the admin puts on the home page's panels whatever their counts.</param>
    /// <param name="hidden">The games the admin keeps off the home page's panels.</param>
    /// <param name="today">The UTC day the panel is composed on.</param>
    /// <returns>
    /// At most <see cref="MaxShown"/> games, the newest first: the pinned ones that pass the rules, then the
    /// most followed and the most watched of the rest, turn about.
    /// </returns>
    /// <remarks>
    /// <para>
    /// Two counts, because each misses what the other sees (ADR 0104). Twitch's hours are the games being
    /// played now, and IGDB's figure for the largest of them is next to nothing: on 2026-11-22 it had Grand
    /// Theft Auto VI, three days out, far below its five hundred most watched, and Call of Duty and Phantom
    /// Blade Zero beside it. The follows a game had ahead of its release are the games people were waiting
    /// for, and say nothing of one nobody saw coming. That day the nine most watched and the thirty-eight
    /// followed shared no game.
    /// </para>
    /// <para>
    /// Turn about, the followed first, and not one list after the other: either alone fills the panel in a
    /// busy season, and the other would never be seen. A game on both lists is taken once, where it comes
    /// first, and the list it would have come from again moves on to its next.
    /// </para>
    /// <para>
    /// The floor of follows is Coming soon's, so a game that panel could have shown is one this panel can.
    /// No floor on the watched, as before: IGDB's counts of follows and ratings are small for a game this
    /// new — Madden NFL 27, eighth most watched on 2026-10-25, had two follows and one rating — so a floor on
    /// either would cut games people are playing. A game that should not be there is the admin's to hide,
    /// and one that should is the admin's to pin: a pin carries a game past both counts and ahead of the
    /// rest, but never past the dates.
    /// </para>
    /// </remarks>
    public static IReadOnlyList<JustOutRelease> Compose(
        IEnumerable<JustOutCandidate> candidates, IReadOnlySet<int> pinned, IReadOnlySet<int> hidden, DateOnly today)
    {
        var windowStarts = today.AddDays(-WindowDays);
        var eligible = new List<(JustOutRelease Release, double Watched, int Hypes, bool Pinned)>();

        foreach (var candidate in candidates.DistinctBy(c => c.Game.Id))
        {
            var game = candidate.Game;
            if (hidden.Contains(game.Id)) continue;

            // Stated again although the queries ask the same, as Coming soon states its own: a pinned game is
            // asked for by its id, so the queries' filters have not seen it.
            if (!ComingSoon.GameTypes.Contains(game.GameType ?? IgdbGameTypes.MainGame) || game.VersionParentId is not null) continue;

            if (FirstRelease(game, candidate.Rows, today, windowStarts) is { } release)
                eligible.Add((release, candidate.Watched, candidate.Hypes, pinned.Contains(game.Id)));
        }

        var pins = eligible
            .Where(e => e.Pinned)
            .OrderByDescending(e => e.Hypes)
            .ThenByDescending(e => e.Watched)
            .ThenBy(e => e.Release.Game.Id)
            .Select(e => e.Release);
        var followed = eligible
            .Where(e => !e.Pinned && e.Hypes >= ComingSoon.MinHypes)
            .OrderByDescending(e => e.Hypes)
            .ThenBy(e => e.Release.Game.Id)
            .Select(e => e.Release);
        var watched = eligible
            .Where(e => !e.Pinned && e.Watched > 0)
            .OrderByDescending(e => e.Watched)
            .ThenBy(e => e.Release.Game.Id)
            .Select(e => e.Release);

        return pins
            .Concat(TurnAbout(followed, watched))
            .Take(MaxShown)
            // The newest first, so that the panel reads back from today as Coming soon reads forward.
            .OrderByDescending(r => r.Released)
            .ThenBy(r => r.Game.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// One game from the first list and then one from the second, and so on, each giving its next game that
    /// the other has not given already, and running on alone once the other is spent.
    /// </summary>
    private static IEnumerable<JustOutRelease> TurnAbout(IEnumerable<JustOutRelease> first, IEnumerable<JustOutRelease> second)
    {
        var taken = new HashSet<int>();
        using var a = first.GetEnumerator();
        using var b = second.GetEnumerator();

        var (moreA, moreB) = (true, true);
        while (moreA || moreB)
        {
            if (moreA && (moreA = Next(a))) yield return a.Current;
            if (moreB && (moreB = Next(b))) yield return b.Current;
        }

        bool Next(IEnumerator<JustOutRelease> list)
        {
            while (list.MoveNext())
            {
                if (taken.Add(list.Current.Game.Id)) return true;
            }

            return false;
        }
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
