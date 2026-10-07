using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Profile statistics, read from the user's own rows and aggregated in memory.
/// </summary>
/// <remarks>
/// <para>
/// Five queries and no SQL aggregation, which is a deliberate trade rather than an oversight:
/// </para>
/// <list type="bullet">
/// <item>
/// The data is small per user. ADR 0018 sizes the event log at roughly 600 rows a year for a heavy
/// user and says never to prune it; entries are one row per game. Reading one user's history costs
/// less than the round trips a set of GROUP BYs would take.
/// </item>
/// <item>
/// Active time needs an ordered walk over each game's transitions, carrying an open interval. SQL
/// expresses that as window functions that no ORM writes for you, so the choice was really "all in
/// C#" or "some in C# and some in SQL", and one place is easier to reason about than two.
/// </item>
/// <item>
/// The tests run on the EF in-memory provider, which does not translate what PostgreSQL would run.
/// A <c>GROUP BY</c> verified there proves nothing about production; the same aggregation in C# is
/// exercised by the tests exactly as it ships.
/// </item>
/// </list>
/// <para>
/// Worth revisiting if one user's log reaches tens of thousands of rows, which at the rate above is
/// decades away.
/// </para>
/// <para>
/// Not cached, though ADR 0018 anticipated a cache for monthly rollups. Every figure changes the
/// moment the user moves a game, and a stats page that disagrees with the list the user just
/// changed reads as a bug — so a TTL would have to be short enough to be pointless, and correct
/// invalidation is work with no measured problem behind it yet. What that ADR actually ruled out is
/// a rollup <em>table</em>, and there is none.
/// </para>
/// </remarks>
public class StatsService(ApplicationDbContext db, TimeProvider clock) : IStatsService
{
    /// <summary>How much of the activity chart the API offers, at most.</summary>
    private const int MonthsShown = 12;

    /// <summary>One event, flattened to what the aggregation needs.</summary>
    private record EventRow(int GameId, short? FromStatusId, short? ToStatusId, DateTimeOffset OccurredAt);

    /// <summary>One entry, flattened likewise. No game metadata is fetched or needed.</summary>
    private record EntryRow(short? StatusId, short? Score);

    /// <summary>
    /// One playthrough, flattened to what two sections need: the platform and the minutes for the
    /// playtime figures, and the game and the two dates for the activity chart, which counts them
    /// for a game its status changes say nothing about (ADR 0047). The type and the notes are still
    /// not read — nothing here aggregates them.
    /// </summary>
    private record PlaythroughRow(
        int GameId, int? PlatformId, int? MinutesPlayed, DateOnly? StartedOn, DateOnly? FinishedOn);

    public async Task<UserStatsDto> GetStatsAsync(string userId, CancellationToken cancellationToken)
    {
        var statuses = await db.ListStatuses
            .AsNoTracking()
            .OrderBy(s => s.SortOrder)
            .ToListAsync(cancellationToken);

        var entries = await db.UserGameEntries
            .AsNoTracking()
            .Where(e => e.UserId == userId)
            .Select(e => new EntryRow(e.StatusId, e.Score))
            .ToListAsync(cancellationToken);

        var wishlisted = await db.UserWishlistItems
            .AsNoTracking()
            .CountAsync(w => w.UserId == userId, cancellationToken);

        // Ordered by the clock, then by the key as a tie-break. Two events can share a timestamp —
        // a coarse clock, or a fixed one in a test — and the active-time walk below depends on
        // seeing a game's transitions in the order they happened, so the order cannot be left to
        // whatever the database returns.
        var events = await db.UserGameEvents
            .AsNoTracking()
            .Where(e => e.UserId == userId)
            .OrderBy(e => e.OccurredAt)
            .ThenBy(e => e.Id)
            .Select(e => new EventRow(e.GameId, e.FromStatusId, e.ToStatusId, e.OccurredAt))
            .ToListAsync(cancellationToken);

        // The fifth query, and the first one about playing rather than about listing. Scoped on
        // the playthrough's own UserId, like every other read here. The game id comes through the
        // entry, because a playthrough holds only the entry's key — and the composite foreign key
        // on (UserGameEntryId, UserId) is what makes that entry this user's as well (ADR 0025 §3),
        // so the join cannot reach into somebody else's rows.
        var playthroughs = await db.UserGamePlaythroughs
            .AsNoTracking()
            .Where(p => p.UserId == userId)
            .Select(p => new PlaythroughRow(
                p.Entry.GameId, p.PlatformId, p.MinutesPlayed, p.StartedOn, p.FinishedOn))
            .ToListAsync(cancellationToken);

        return new UserStatsDto(
            BuildLibrary(entries, statuses, wishlisted),
            BuildScores(entries),
            BuildActivity(events, playthroughs, statuses),
            BuildPlaytime(playthroughs));
    }

    private static LibraryStatsDto BuildLibrary(
        List<EntryRow> entries, List<ListStatus> statuses, int wishlisted)
    {
        var byStatus = statuses.ToDictionary(
            s => s.Key,
            s => entries.Count(e => e.StatusId == s.Id));

        // Both sets come from the flags rather than from a list of keys, so adding a status cannot
        // silently leave it out of the rate. Terminal is the denominator and completion the
        // numerator, which is the distinction ADR 0018 added the third flag for: dropped is just as
        // terminal as finished and must not count towards it.
        var terminal = statuses.Where(s => s.IsTerminal).Select(s => s.Id).ToHashSet();
        var completing = statuses.Where(s => s.CountsAsCompletion).Select(s => s.Id).ToHashSet();

        var resolved = entries.Count(e => e.StatusId is short id && terminal.Contains(id));
        var completed = entries.Count(e => e.StatusId is short id && completing.Contains(id));

        return new LibraryStatsDto(
            Tracked: entries.Count(e => e.StatusId is not null),
            Recorded: entries.Count,
            Wishlisted: wishlisted,
            ByStatus: byStatus,
            CompletionRate: resolved == 0 ? null : (double)completed / resolved);
    }

    private static ScoreStatsDto BuildScores(List<EntryRow> entries)
    {
        // Shared with the game page's distribution of everybody's scores, so the two cannot come to
        // treat an out-of-range score differently.
        var (scored, mean, distribution) = ScoreSummary.Of(entries.Select(e => e.Score));
        return new ScoreStatsDto(scored, mean, distribution);
    }

    /// <summary>
    /// Hours logged, and where they were spent.
    /// </summary>
    /// <remarks>
    /// A playthrough with no recorded duration counts towards <c>Playthroughs</c> and nothing else,
    /// so the total never claims to cover runs that never said how long they took. One with no
    /// platform counts towards the totals but appears in no platform row — the time was real even
    /// when the user did not say where it was spent, and inventing an "Unknown" bucket would put a
    /// platform-shaped thing in a list of platforms.
    /// </remarks>
    private static PlaytimeStatsDto BuildPlaytime(List<PlaythroughRow> playthroughs)
    {
        var timed = playthroughs.Where(p => p.MinutesPlayed is > 0).ToList();

        var byPlatform = timed
            .Where(p => p.PlatformId is not null)
            .GroupBy(p => p.PlatformId!.Value)
            .Select(group => new PlatformMinutesDto(
                group.Key,
                group.Sum(p => p.MinutesPlayed!.Value),
                group.Count()))
            // Ties broken by platform id, so the order does not depend on which row the database
            // happened to return first.
            .OrderByDescending(platform => platform.Minutes)
            .ThenBy(platform => platform.PlatformId)
            .ToList();

        return new PlaytimeStatsDto(
            Playthroughs: playthroughs.Count,
            TotalMinutes: timed.Sum(p => p.MinutesPlayed!.Value),
            WithHours: timed.Count,
            ByPlatform: byPlatform);
    }

    /// <summary>
    /// What the user started, finished and dropped month by month, and the streaks and the median
    /// that follow from it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Two sources, and a status change always takes precedence</b> — per game, and per kind of
    /// act (ADR 0047). The event log is this app's own tracking, and after an import it is the
    /// record: a game with a change to Finished counts its finishes from those changes alone, and a
    /// game with a change to any started status takes its first start from them. Only a game the log
    /// says nothing about, for that kind, falls back to the dates on its playthroughs. That fallback
    /// is how an imported history counts at all, because an import writes no events (ADR 0026 §2)
    /// and none are ever synthesised for it here or anywhere else.
    /// </para>
    /// <para>
    /// Per game rather than per playthrough, because nothing links an event to a run — the log holds
    /// no key to the entry (ADR 0018) — so the same finish recorded both ways cannot be matched, only
    /// kept from counting twice. A union would count it twice whenever the two dates straddle a
    /// month: a run logged as finished on the 30th and a move to Finished on the 2nd would be two
    /// finishes, and a streak, out of one.
    /// </para>
    /// <para>
    /// For every playthrough, whatever <see cref="UserGameEntry.Origin"/> says. The precedence
    /// already makes our own tracking win, and a finish date on a game nobody ever moved to Finished
    /// is a real finish whether it was typed here or into another tracker.
    /// </para>
    /// <para>
    /// Three things stay events-only. Drops, because a playthrough cannot say a game was dropped;
    /// <see cref="ActivityStatsDto.Transitions"/>, because it counts status changes and nothing
    /// else; and the time to finish, because it is time spent in Playing with the shelved intervals
    /// left out (ADR 0018), where a playthrough's dates are only the calendar span around it.
    /// </para>
    /// </remarks>
    private ActivityStatsDto BuildActivity(
        List<EventRow> events, List<PlaythroughRow> playthroughs, List<ListStatus> statuses)
    {
        var finishing = statuses.Where(s => s.CountsAsCompletion).Select(s => s.Id).ToHashSet();
        var dropping = statuses.Where(s => s.IsTerminal && !s.CountsAsCompletion).Select(s => s.Id).ToHashSet();
        var starting = statuses.Where(s => s.IsStarted).Select(s => s.Id).ToHashSet();

        // The one place a specific key is unavoidable. Active time is by definition time spent
        // playing, and no combination of the flags picks that status out: `IsStarted` also covers
        // On Hold, which is precisely the interval ADR 0018 says not to count. The key is a
        // permanent identifier by that same ADR, so naming it is safe where naming a *set* of keys
        // would not be.
        var playing = statuses.SingleOrDefault(s => s.Key == ListStatusKeys.Playing)?.Id;

        // Read once, so that the chart and the streak cannot fall either side of a month boundary.
        var now = MonthIndex(clock.GetUtcNow());

        // A run's start is its start date, or its finish date when it recorded none: a game that was
        // finished had been started by then. That is the reading ADR 0023 gives the `IsStarted`
        // flag, under which a game ticked off straight from the backlog counts as started in the
        // month it was finished, and it keeps 0023's promise within either source — nothing is
        // counted as finished in a month before it has been counted as started. Across the two it
        // cannot, because the precedence is per kind: an imported game moved to Playing here months
        // after its imported finish date starts when the log says and finished when the date says.
        var starts = ByPrecedence(
            EventMonths(events, starting),
            PlaythroughMonths(playthroughs, p => p.StartedOn ?? p.FinishedOn, now));
        var finishes = ByPrecedence(
            EventMonths(events, finishing),
            PlaythroughMonths(playthroughs, p => p.FinishedOn, now));
        var drops = MonthsByGame(EventMonths(events, dropping));

        // The chart begins at the earliest thing on record: the log's first event, as it always
        // did — from that moment every status change was being written down, whatever it was — or
        // the earliest month a playthrough's date is *counted* in, if that is sooner. Counted,
        // because a date the precedence overrides is not on the chart, and a chart reaching back to
        // it would open on months of nothing for no visible reason. And it must reach back to the
        // counted ones: starting at the first event instead would drop every imported finish before
        // it, and with them "finished this year", the moment somebody moved a single game.
        var recorded = starts.Values.Concat(finishes.Values)
            .SelectMany(months => months)
            .Concat(events.Take(1).Select(e => MonthIndex(e.OccurredAt)))
            .ToList();

        if (recorded.Count == 0) return new ActivityStatsDto(null, [], 0, 0, 0, null);

        var first = Math.Max(now - (MonthsShown - 1), recorded.Min());
        var (current, longest) = BuildStreaks(
            finishes.Values.SelectMany(months => months).ToHashSet(), now);

        return new ActivityStatsDto(
            // The first status change, never a playthrough's date. "Tracking here since" means since
            // this app began recording, and an imported date says when a game was played elsewhere —
            // possibly years before the account existed (ADR 0047). So an account with dates and no
            // status change has months on its chart and no log start, which is the truth.
            LogStartedAt: events.Count > 0 ? events[0].OccurredAt : null,
            Months: BuildMonths(starts, finishes, drops, first, now),
            Transitions: events.Count,
            CurrentStreakMonths: current,
            LongestStreakMonths: longest,
            TimeToFinish: playing is short playingId
                ? BuildTimeToFinish(events, playingId, finishing)
                : null);
    }

    /// <summary>
    /// The last twelve months, cut short at the earliest month anything was recorded in.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Months before the first record hold nothing whether or not anything happened in them: the log
    /// was not backfilled when it shipped, and an import carries only the dates its owner wrote down.
    /// Padding the chart out to a fixed twelve would draw those as bars of zero, which reads as "you
    /// did nothing" rather than "nothing was recorded".
    /// </para>
    /// <para>
    /// A game counts as started in the month it was <em>first</em> started, so replaying something
    /// does not read as picking up a new game. Finishes and drops are counted per month as they
    /// happen: finishing a game twice in one month is one finish, but finishing it again next year is
    /// a finish in that year too. Each game's months are a set, which is what makes both true for
    /// either source.
    /// </para>
    /// </remarks>
    private static List<ActivityMonthDto> BuildMonths(
        Dictionary<int, HashSet<int>> starts,
        Dictionary<int, HashSet<int>> finishes,
        Dictionary<int, HashSet<int>> drops,
        int first,
        int last)
    {
        var startsByMonth = CountByMonth(starts.Values.Select(months => months.Min()));
        var finishesByMonth = CountByMonth(finishes.Values.SelectMany(months => months));
        var dropsByMonth = CountByMonth(drops.Values.SelectMany(months => months));

        var months = new List<ActivityMonthDto>();
        for (var month = first; month <= last; month++)
        {
            months.Add(new ActivityMonthDto(
                MonthLabel(month),
                startsByMonth.GetValueOrDefault(month),
                finishesByMonth.GetValueOrDefault(month),
                dropsByMonth.GetValueOrDefault(month)));
        }

        return months;
    }

    private static Dictionary<int, int> CountByMonth(IEnumerable<int> months) =>
        months.GroupBy(month => month).ToDictionary(g => g.Key, g => g.Count());

    /// <summary>The month of every event that moved a game into one of these statuses.</summary>
    private static IEnumerable<(int GameId, int Month)> EventMonths(
        List<EventRow> events, HashSet<short> toStatuses) =>
        events
            .Where(e => e.ToStatusId is short to && toStatuses.Contains(to))
            .Select(e => (e.GameId, MonthIndex(e.OccurredAt)));

    /// <summary>
    /// The month of whichever day <paramref name="dayOf"/> picks out of each playthrough that has
    /// one, leaving out a month that has not begun yet.
    /// </summary>
    /// <remarks>
    /// An event is stamped by our own clock and cannot be in the future. A playthrough's date is
    /// typed by a person, and a slipped key would otherwise count a finish that has not happened and
    /// run a streak on into months the chart does not show.
    /// </remarks>
    private static IEnumerable<(int GameId, int Month)> PlaythroughMonths(
        List<PlaythroughRow> playthroughs, Func<PlaythroughRow, DateOnly?> dayOf, int now) =>
        playthroughs
            .Select(p => (p.GameId, Day: dayOf(p)))
            .Where(p => p.Day is not null)
            .Select(p => (p.GameId, Month: MonthIndex(p.Day!.Value)))
            .Where(p => p.Month <= now);

    /// <summary>Each game's months, as a set, so that a game counts once in any one month.</summary>
    private static Dictionary<int, HashSet<int>> MonthsByGame(IEnumerable<(int GameId, int Month)> acts) =>
        acts
            .GroupBy(act => act.GameId)
            .ToDictionary(game => game.Key, game => game.Select(act => act.Month).ToHashSet());

    /// <summary>
    /// Each game's months for one kind of act: from its status changes if it has any of that kind,
    /// and from its playthroughs only if it has none.
    /// </summary>
    /// <remarks>
    /// Never merged. A game the log speaks for is settled by the log, and its playthroughs are not
    /// consulted for that kind at all — not counted beside the events, and not used to fill a month
    /// the events left empty.
    /// </remarks>
    private static Dictionary<int, HashSet<int>> ByPrecedence(
        IEnumerable<(int GameId, int Month)> fromEvents,
        IEnumerable<(int GameId, int Month)> fromPlaythroughs)
    {
        var months = MonthsByGame(fromEvents);

        foreach (var (gameId, dated) in MonthsByGame(fromPlaythroughs))
            months.TryAdd(gameId, dated);

        return months;
    }

    /// <summary>
    /// Consecutive months containing a finish: the run ending now, and the longest ever.
    /// </summary>
    private static (int Current, int Longest) BuildStreaks(HashSet<int> finishMonths, int now)
    {
        if (finishMonths.Count == 0) return (0, 0);

        var longest = 0;
        foreach (var month in finishMonths)
        {
            // Count only from the start of a run, so each run is measured once.
            if (finishMonths.Contains(month - 1)) continue;

            var length = 0;
            while (finishMonths.Contains(month + length)) length++;
            longest = Math.Max(longest, length);
        }

        // A month with no finish *yet* must not read as a broken streak: on the first of the month
        // everybody's would be. So the run is anchored to this month if it has a finish and to last
        // month otherwise, and only a second empty month ends it.
        var anchor = finishMonths.Contains(now) ? now
            : finishMonths.Contains(now - 1) ? now - 1
            : (int?)null;

        var current = 0;
        for (var month = anchor; month is int m && finishMonths.Contains(m); month--) current++;

        return (current, longest);
    }

    /// <summary>
    /// Time actually spent playing each finished game, up to the first time it was finished.
    /// </summary>
    private static ActiveTimeDto? BuildTimeToFinish(
        List<EventRow> events, short playing, HashSet<short> finishing)
    {
        var samples = new List<TimeSpan>();

        foreach (var game in events.GroupBy(e => e.GameId))
        {
            var active = TimeSpan.Zero;
            DateTimeOffset? playingSince = null;
            var finished = false;

            foreach (var e in game)
            {
                // Any move that is not *to* playing closes an open interval, which is what keeps a
                // shelved game from billing the eight months it sat on hold.
                if (playingSince is DateTimeOffset since && e.ToStatusId != playing)
                {
                    active += e.OccurredAt - since;
                    playingSince = null;
                }

                if (e.ToStatusId == playing) playingSince ??= e.OccurredAt;

                // The first finish is the one measured. A game picked up again afterwards starts
                // accumulating a second playthrough, which is a playthrough's stat and not this one.
                if (e.ToStatusId is short to && finishing.Contains(to))
                {
                    finished = true;
                    break;
                }
            }

            // A game finished without ever being marked as playing has nothing to measure. Counted
            // as zero it would drag the median towards nothing; excluded, `Samples` says how many
            // games the figure actually rests on.
            if (finished && active > TimeSpan.Zero) samples.Add(active);
        }

        if (samples.Count == 0) return null;

        samples.Sort();
        return new ActiveTimeDto(samples.Count, Median(samples).TotalHours, samples[^1].TotalHours);
    }

    /// <summary>The middle of a sorted list, averaging the two middle values for an even count.</summary>
    private static TimeSpan Median(List<TimeSpan> sorted) =>
        sorted.Count % 2 == 1
            ? sorted[sorted.Count / 2]
            : (sorted[sorted.Count / 2 - 1] + sorted[sorted.Count / 2]) / 2;

    /// <summary>
    /// Months as a single integer so that "the month before" is subtraction rather than calendar
    /// arithmetic. UTC throughout, matching how the timestamps are stored.
    /// </summary>
    private static int MonthIndex(DateTimeOffset at)
    {
        var utc = at.UtcDateTime;
        return utc.Year * 12 + utc.Month - 1;
    }

    /// <summary>
    /// The month a calendar date names, on the same scale as an event's, so the two sources share
    /// one axis.
    /// </summary>
    /// <remarks>
    /// A playthrough's date is a day with no time and no zone — nobody records the hour they finished
    /// a game — so there is nothing to convert, and its month is the one written on it. Read as
    /// midnight UTC it would land in the same month, which is why this agrees with the overload
    /// above. An event near midnight at the turn of a month can still fall in a different month from
    /// the date its owner would write for it; that is the UTC convention ADR 0023 already states
    /// for events, not a disagreement between the sources.
    /// </remarks>
    private static int MonthIndex(DateOnly day) => day.Year * 12 + day.Month - 1;

    private static string MonthLabel(int monthIndex) =>
        $"{monthIndex / 12:0000}-{monthIndex % 12 + 1:00}";
}
