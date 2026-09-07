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
/// Four queries and no SQL aggregation, which is a deliberate trade rather than an oversight:
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

        return new UserStatsDto(
            BuildLibrary(entries, statuses, wishlisted),
            BuildScores(entries),
            BuildActivity(events, statuses));
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
        // Only the API enforces 1-10; the column is a plain short. A score outside it is corrupt
        // rather than merely unusual, and it is left out of all three figures together — a 42
        // dropped from the histogram but kept in the mean would put "24 out of 10" on the page,
        // which is worse than a mean over one fewer game.
        var scores = entries
            .Select(e => e.Score)
            .Where(score => score is >= 1 and <= 10)
            .Select(score => (int)score!.Value)
            .ToList();

        var distribution = new int[10];
        foreach (var score in scores) distribution[score - 1]++;

        return new ScoreStatsDto(
            scores.Count,
            scores.Count == 0 ? null : scores.Average(),
            distribution);
    }

    private ActivityStatsDto BuildActivity(List<EventRow> events, List<ListStatus> statuses)
    {
        if (events.Count == 0) return new ActivityStatsDto(null, [], 0, 0, 0, null);

        var finishing = statuses.Where(s => s.CountsAsCompletion).Select(s => s.Id).ToHashSet();
        var dropping = statuses.Where(s => s.IsTerminal && !s.CountsAsCompletion).Select(s => s.Id).ToHashSet();
        var starting = statuses.Where(s => s.IsStarted).Select(s => s.Id).ToHashSet();

        // The one place a specific key is unavoidable. Active time is by definition time spent
        // playing, and no combination of the flags picks that status out: `IsStarted` also covers
        // On Hold, which is precisely the interval ADR 0018 says not to count. The key is a
        // permanent identifier by that same ADR, so naming it is safe where naming a *set* of keys
        // would not be.
        var playing = statuses.SingleOrDefault(s => s.Key == ListStatusKeys.Playing)?.Id;

        var months = BuildMonths(events, starting, finishing, dropping);
        var (current, longest) = BuildStreaks(events, finishing);

        return new ActivityStatsDto(
            LogStartedAt: events[0].OccurredAt,
            Months: months,
            Transitions: events.Count,
            CurrentStreakMonths: current,
            LongestStreakMonths: longest,
            TimeToFinish: playing is short playingId
                ? BuildTimeToFinish(events, playingId, finishing)
                : null);
    }

    /// <summary>
    /// The last twelve months, cut short at the month the user's log begins.
    /// </summary>
    /// <remarks>
    /// The log was not backfilled when it shipped, so months before a user's first event hold no
    /// events whether or not anything happened in them. Padding the chart out to a fixed twelve
    /// would draw those as bars of zero, which reads as "you did nothing" rather than "nothing was
    /// recorded".
    /// </remarks>
    private List<ActivityMonthDto> BuildMonths(
        List<EventRow> events,
        HashSet<short> starting,
        HashSet<short> finishing,
        HashSet<short> dropping)
    {
        // A game counts as started in the month it was *first* started, so replaying something
        // does not read as picking up a new game. Finishes and drops are counted per month as they
        // happen: finishing a game twice in one month is one finish, but finishing it again next
        // year is a finish in that year too.
        var firstStart = events
            .Where(e => e.ToStatusId is short to && starting.Contains(to))
            .GroupBy(e => e.GameId)
            .ToDictionary(g => g.Key, g => MonthIndex(g.First().OccurredAt));

        var startsByMonth = firstStart.Values
            .GroupBy(month => month)
            .ToDictionary(g => g.Key, g => g.Count());

        var finishesByMonth = CountDistinctGamesByMonth(events, finishing);
        var dropsByMonth = CountDistinctGamesByMonth(events, dropping);

        var last = MonthIndex(clock.GetUtcNow());
        var first = Math.Max(last - (MonthsShown - 1), MonthIndex(events[0].OccurredAt));

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

    private static Dictionary<int, int> CountDistinctGamesByMonth(
        List<EventRow> events, HashSet<short> toStatuses) =>
        events
            .Where(e => e.ToStatusId is short to && toStatuses.Contains(to))
            .GroupBy(e => MonthIndex(e.OccurredAt))
            .ToDictionary(g => g.Key, g => g.Select(e => e.GameId).Distinct().Count());

    /// <summary>
    /// Consecutive months containing a finish: the run ending now, and the longest ever.
    /// </summary>
    private (int Current, int Longest) BuildStreaks(List<EventRow> events, HashSet<short> finishing)
    {
        var finishMonths = events
            .Where(e => e.ToStatusId is short to && finishing.Contains(to))
            .Select(e => MonthIndex(e.OccurredAt))
            .ToHashSet();

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
        var now = MonthIndex(clock.GetUtcNow());
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

    private static string MonthLabel(int monthIndex) =>
        $"{monthIndex / 12:0000}-{monthIndex % 12 + 1:00}";
}
