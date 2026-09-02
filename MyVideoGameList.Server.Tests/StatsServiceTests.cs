using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The metric definitions, which are the substance of this feature — the queries are trivial and
/// the arithmetic is where a stat quietly starts meaning something else.
/// </summary>
public class StatsServiceTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";

    /// <summary>Mid-month on purpose, so a month boundary is never accidentally involved.</summary>
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>
    /// A context whose statuses are the real ones: <c>EnsureCreated</c> applies the context's own
    /// <c>HasData</c>, so these tests read the same five rows and the same three flags the
    /// migration seeds. Seeding a local copy would let the flags drift apart silently, and the
    /// flags are what half of these assertions are about.
    /// </summary>
    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static short StatusId(ApplicationDbContext db, string key) =>
        db.ListStatuses.Single(s => s.Key == key).Id;

    private static StatsService NewService(ApplicationDbContext db, DateTimeOffset? now = null) =>
        new(db, new FixedClock(now ?? Now));

    private static void AddEntry(
        ApplicationDbContext db, int gameId, string? status, short? score = null, string userId = UserId)
    {
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            StatusId = status is null ? null : StatusId(db, status),
            Score = score,
            AddedAt = Now
        });
        db.SaveChanges();
    }

    /// <summary>One transition. `null` at either end is a real event: a first add, or a removal.</summary>
    private static void AddEvent(
        ApplicationDbContext db,
        int gameId,
        string? from,
        string? to,
        DateTimeOffset at,
        string userId = UserId)
    {
        db.UserGameEvents.Add(new UserGameEvent
        {
            UserId = userId,
            GameId = gameId,
            FromStatusId = from is null ? null : StatusId(db, from),
            ToStatusId = to is null ? null : StatusId(db, to),
            OccurredAt = at
        });
        db.SaveChanges();
    }

    [Fact]
    public async Task GetStatsAsync_NoData_ReturnsEmptyRatherThanFailing()
    {
        // The profile has to render for somebody who signed up a minute ago.
        using var db = NewDb();

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(0, stats.Library.Tracked);
        Assert.Equal(0, stats.Library.Recorded);
        Assert.Null(stats.Library.CompletionRate);
        Assert.Null(stats.Scores.Mean);
        Assert.Null(stats.Activity.LogStartedAt);
        Assert.Empty(stats.Activity.Months);
        Assert.Null(stats.Activity.TimeToFinish);
    }

    [Fact]
    public async Task GetStatsAsync_AnotherUsersRows_AreNotCounted()
    {
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Finished, score: 9, userId: OtherUserId);
        AddEvent(db, 1, null, ListStatusKeys.Finished, Now, userId: OtherUserId);
        db.UserWishlistItems.Add(new UserWishlistItem { UserId = OtherUserId, GameId = 2, AddedAt = Now });
        db.SaveChanges();

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(0, stats.Library.Recorded);
        Assert.Equal(0, stats.Library.Wishlisted);
        Assert.Equal(0, stats.Activity.Transitions);
    }

    [Fact]
    public async Task GetStatsAsync_EveryStatus_IsPresentIncludingTheEmptyOnes()
    {
        // The client indexes by key, so a missing key would be a crash rather than a zero.
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Playing);

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(5, stats.Library.ByStatus.Count);
        Assert.Equal(1, stats.Library.ByStatus[ListStatusKeys.Playing]);
        Assert.Equal(0, stats.Library.ByStatus[ListStatusKeys.Dropped]);
    }

    [Fact]
    public async Task GetStatsAsync_EntryWithNoStatus_CountsAsRecordedButNotTracked()
    {
        // Leaving every list keeps the entry and its score (ADR 0019), so the two totals differ and
        // the difference is meaningful rather than a rounding error.
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Playing);
        AddEntry(db, 2, status: null, score: 8);

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(1, stats.Library.Tracked);
        Assert.Equal(2, stats.Library.Recorded);
    }

    [Fact]
    public async Task GetStatsAsync_CompletionRate_DividesFinishedByEverythingTerminal()
    {
        // Three finished, one dropped, and a backlog game that has not been resolved either way and
        // so belongs in neither half of the fraction.
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Finished);
        AddEntry(db, 2, ListStatusKeys.Finished);
        AddEntry(db, 3, ListStatusKeys.Finished);
        AddEntry(db, 4, ListStatusKeys.Dropped);
        AddEntry(db, 5, ListStatusKeys.Backlog);

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(0.75, stats.Library.CompletionRate);
    }

    [Fact]
    public async Task GetStatsAsync_NothingResolvedYet_LeavesTheCompletionRateUnknown()
    {
        // Zero would be a claim about the user. Null is the truth: nothing has finished or been
        // dropped, so there is no rate.
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Backlog);
        AddEntry(db, 2, ListStatusKeys.Playing);

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Null(stats.Library.CompletionRate);
    }

    [Fact]
    public async Task GetStatsAsync_Scores_AreCountedIntoTenBucketsOnTheOneToTenScale()
    {
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Finished, score: 10);
        AddEntry(db, 2, ListStatusKeys.Finished, score: 7);
        AddEntry(db, 3, ListStatusKeys.Finished, score: 7);
        AddEntry(db, 4, ListStatusKeys.Playing);

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(3, stats.Scores.Scored);
        Assert.Equal(8, stats.Scores.Mean);
        Assert.Equal(10, stats.Scores.Distribution.Count);
        Assert.Equal(2, stats.Scores.Distribution[6]);
        Assert.Equal(1, stats.Scores.Distribution[9]);
        Assert.Equal(0, stats.Scores.Distribution[0]);
    }

    [Fact]
    public async Task GetStatsAsync_ScoreOutsideTheScale_IsLeftOutOfEveryFigure()
    {
        // Only the API enforces 1-10; the column does not. Such a row must not take the profile
        // down with an index out of range, and it must not be excluded from the histogram while
        // still counting towards the mean — that would put "24 out of 10" on the page.
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Finished, score: 42);
        AddEntry(db, 2, ListStatusKeys.Finished, score: 6);

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(1, stats.Scores.Scored);
        Assert.Equal(6, stats.Scores.Mean);
        Assert.Equal(1, stats.Scores.Distribution[5]);
        Assert.Equal(1, stats.Scores.Distribution.Sum());
    }

    [Fact]
    public async Task GetStatsAsync_Months_StopAtTheMonthTheLogBegins()
    {
        // The log was not backfilled, so months before a user's first event hold no events whether
        // or not anything happened in them. Twelve bars of zero would read as "you did nothing".
        using var db = NewDb();
        AddEvent(db, 1, null, ListStatusKeys.Playing, new DateTimeOffset(2026, 4, 10, 9, 0, 0, TimeSpan.Zero));

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(["2026-04", "2026-05", "2026-06"], stats.Activity.Months.Select(m => m.Month));
    }

    [Fact]
    public async Task GetStatsAsync_Months_AreCappedAtTwelveForALongerHistory()
    {
        using var db = NewDb();
        AddEvent(db, 1, null, ListStatusKeys.Playing, new DateTimeOffset(2023, 1, 1, 0, 0, 0, TimeSpan.Zero));

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(12, stats.Activity.Months.Count);
        Assert.Equal("2025-07", stats.Activity.Months[0].Month);
        Assert.Equal("2026-06", stats.Activity.Months[^1].Month);
    }

    [Fact]
    public async Task GetStatsAsync_AGameStartedTwice_CountsAsStartedOnlyTheFirstTime()
    {
        // "Started in June" should mean a game newly picked up, not a game replayed. Otherwise
        // somebody dipping back into an old favourite reads as broadening their library.
        using var db = NewDb();
        var april = new DateTimeOffset(2026, 4, 5, 9, 0, 0, TimeSpan.Zero);
        AddEvent(db, 1, null, ListStatusKeys.Playing, april);
        AddEvent(db, 1, ListStatusKeys.Playing, ListStatusKeys.Finished, april.AddDays(2));
        AddEvent(db, 1, ListStatusKeys.Finished, ListStatusKeys.Playing, new DateTimeOffset(2026, 6, 1, 9, 0, 0, TimeSpan.Zero));

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        var months = stats.Activity.Months.ToDictionary(m => m.Month);
        Assert.Equal(1, months["2026-04"].Started);
        Assert.Equal(0, months["2026-06"].Started);
    }

    [Fact]
    public async Task GetStatsAsync_AGameFinishedTwiceInOneMonth_CountsOnce()
    {
        using var db = NewDb();
        var june = new DateTimeOffset(2026, 6, 2, 9, 0, 0, TimeSpan.Zero);
        AddEvent(db, 1, null, ListStatusKeys.Playing, june);
        AddEvent(db, 1, ListStatusKeys.Playing, ListStatusKeys.Finished, june.AddDays(1));
        AddEvent(db, 1, ListStatusKeys.Finished, ListStatusKeys.Playing, june.AddDays(2));
        AddEvent(db, 1, ListStatusKeys.Playing, ListStatusKeys.Finished, june.AddDays(3));

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(1, stats.Activity.Months.Single(m => m.Month == "2026-06").Finished);
    }

    [Fact]
    public async Task GetStatsAsync_ARemoval_IsNeitherAFinishNorADrop()
    {
        // A null target means the game left every list. It is a real event and it is not a verdict
        // on the game, so it must not land in either column.
        using var db = NewDb();
        var june = new DateTimeOffset(2026, 6, 2, 9, 0, 0, TimeSpan.Zero);
        AddEvent(db, 1, null, ListStatusKeys.Playing, june);
        AddEvent(db, 1, ListStatusKeys.Playing, null, june.AddDays(1));

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        var june2026 = stats.Activity.Months.Single(m => m.Month == "2026-06");
        Assert.Equal(1, june2026.Started);
        Assert.Equal(0, june2026.Finished);
        Assert.Equal(0, june2026.Dropped);
        Assert.Equal(2, stats.Activity.Transitions);
    }

    [Fact]
    public async Task GetStatsAsync_ActiveTime_ExcludesTimeSpentOnHold()
    {
        // The case ADR 0018 names: two days playing, a long shelving, then one more day. The honest
        // figure is three days, not the calendar month that separates the ends.
        using var db = NewDb();
        var start = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        AddEvent(db, 1, null, ListStatusKeys.Playing, start);
        AddEvent(db, 1, ListStatusKeys.Playing, ListStatusKeys.OnHold, start.AddDays(2));
        AddEvent(db, 1, ListStatusKeys.OnHold, ListStatusKeys.Playing, start.AddDays(20));
        AddEvent(db, 1, ListStatusKeys.Playing, ListStatusKeys.Finished, start.AddDays(21));

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.NotNull(stats.Activity.TimeToFinish);
        Assert.Equal(1, stats.Activity.TimeToFinish.Samples);
        Assert.Equal(72, stats.Activity.TimeToFinish.MedianHours, precision: 6);
    }

    [Fact]
    public async Task GetStatsAsync_ActiveTime_IgnoresAGameFinishedWithoutBeingPlayed()
    {
        // Marking an old favourite as finished straight from the backlog says nothing about how
        // long it took. Counted as zero it would halve the median.
        using var db = NewDb();
        var start = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        AddEvent(db, 1, null, ListStatusKeys.Playing, start);
        AddEvent(db, 1, ListStatusKeys.Playing, ListStatusKeys.Finished, start.AddDays(4));
        AddEvent(db, 2, null, ListStatusKeys.Backlog, start);
        AddEvent(db, 2, ListStatusKeys.Backlog, ListStatusKeys.Finished, start.AddDays(1));

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.NotNull(stats.Activity.TimeToFinish);
        Assert.Equal(1, stats.Activity.TimeToFinish.Samples);
        Assert.Equal(96, stats.Activity.TimeToFinish.MedianHours, precision: 6);
    }

    [Fact]
    public async Task GetStatsAsync_ActiveTime_MeasuresUpToTheFirstFinishOnly()
    {
        // A game picked up again after finishing is a second playthrough. Letting it keep
        // accumulating would make "time to finish" grow every time somebody revisits a favourite.
        using var db = NewDb();
        var start = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        AddEvent(db, 1, null, ListStatusKeys.Playing, start);
        AddEvent(db, 1, ListStatusKeys.Playing, ListStatusKeys.Finished, start.AddDays(1));
        AddEvent(db, 1, ListStatusKeys.Finished, ListStatusKeys.Playing, start.AddDays(2));
        AddEvent(db, 1, ListStatusKeys.Playing, ListStatusKeys.Finished, start.AddDays(9));

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.NotNull(stats.Activity.TimeToFinish);
        Assert.Equal(24, stats.Activity.TimeToFinish.MedianHours, precision: 6);
    }

    [Fact]
    public async Task GetStatsAsync_ActiveTime_IgnoresAGameStillBeingPlayed()
    {
        // Nothing to measure to. An open interval running to "now" would be a different metric.
        using var db = NewDb();
        AddEvent(db, 1, null, ListStatusKeys.Playing, new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero));

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Null(stats.Activity.TimeToFinish);
    }

    [Fact]
    public async Task GetStatsAsync_ActiveTime_TakesTheMiddleOfAnOddNumberOfSamples()
    {
        using var db = NewDb();
        var start = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        foreach (var (gameId, days) in new[] { (1, 1), (2, 5), (3, 30) })
        {
            AddEvent(db, gameId, null, ListStatusKeys.Playing, start);
            AddEvent(db, gameId, ListStatusKeys.Playing, ListStatusKeys.Finished, start.AddDays(days));
        }

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.NotNull(stats.Activity.TimeToFinish);
        Assert.Equal(3, stats.Activity.TimeToFinish.Samples);
        Assert.Equal(120, stats.Activity.TimeToFinish.MedianHours, precision: 6);
        Assert.Equal(720, stats.Activity.TimeToFinish.LongestHours, precision: 6);
    }

    [Fact]
    public async Task GetStatsAsync_ActiveTime_AveragesTheMiddleTwoOfAnEvenNumber()
    {
        using var db = NewDb();
        var start = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        foreach (var (gameId, days) in new[] { (1, 2), (2, 4), (3, 6), (4, 20) })
        {
            AddEvent(db, gameId, null, ListStatusKeys.Playing, start);
            AddEvent(db, gameId, ListStatusKeys.Playing, ListStatusKeys.Finished, start.AddDays(days));
        }

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.NotNull(stats.Activity.TimeToFinish);
        Assert.Equal(120, stats.Activity.TimeToFinish.MedianHours, precision: 6);
    }

    [Fact]
    public async Task GetStatsAsync_Streak_CountsConsecutiveMonthsWithAFinish()
    {
        using var db = NewDb();
        foreach (var month in new[] { 4, 5, 6 })
        {
            var at = new DateTimeOffset(2026, month, 10, 9, 0, 0, TimeSpan.Zero);
            AddEvent(db, month, null, ListStatusKeys.Playing, at.AddDays(-1));
            AddEvent(db, month, ListStatusKeys.Playing, ListStatusKeys.Finished, at);
        }

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(3, stats.Activity.CurrentStreakMonths);
        Assert.Equal(3, stats.Activity.LongestStreakMonths);
    }

    [Fact]
    public async Task GetStatsAsync_Streak_SurvivesAQuietCurrentMonth()
    {
        // Otherwise every streak in the app breaks on the first of the month and comes back later
        // the same day, which is not a property anybody would call a streak.
        using var db = NewDb();
        foreach (var month in new[] { 4, 5 })
        {
            var at = new DateTimeOffset(2026, month, 10, 9, 0, 0, TimeSpan.Zero);
            AddEvent(db, month, null, ListStatusKeys.Playing, at.AddDays(-1));
            AddEvent(db, month, ListStatusKeys.Playing, ListStatusKeys.Finished, at);
        }

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(2, stats.Activity.CurrentStreakMonths);
    }

    [Fact]
    public async Task GetStatsAsync_Streak_EndsAfterTwoQuietMonths()
    {
        using var db = NewDb();
        var at = new DateTimeOffset(2026, 3, 10, 9, 0, 0, TimeSpan.Zero);
        AddEvent(db, 1, null, ListStatusKeys.Playing, at.AddDays(-1));
        AddEvent(db, 1, ListStatusKeys.Playing, ListStatusKeys.Finished, at);

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(0, stats.Activity.CurrentStreakMonths);
        Assert.Equal(1, stats.Activity.LongestStreakMonths);
    }

    [Fact]
    public async Task GetStatsAsync_Streak_ReportsTheLongestRunFromTheWholeLog()
    {
        // Deliberately older than the twelve months the chart shows: the record stands whether or
        // not it is still on screen.
        using var db = NewDb();
        foreach (var month in new[] { 1, 2, 3, 4 })
        {
            var at = new DateTimeOffset(2024, month, 10, 9, 0, 0, TimeSpan.Zero);
            AddEvent(db, month, null, ListStatusKeys.Playing, at.AddDays(-1));
            AddEvent(db, month, ListStatusKeys.Playing, ListStatusKeys.Finished, at);
        }

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(4, stats.Activity.LongestStreakMonths);
        Assert.Equal(0, stats.Activity.CurrentStreakMonths);
    }

    [Fact]
    public async Task GetStatsAsync_MonthsAndStreaks_UseUtcRatherThanTheServerZone()
    {
        // An event at 23:30 on the last day of the month in a positive offset is the first of the
        // next month in UTC. The label has to say which convention it used, and the timestamps are
        // stored as UTC, so UTC it is.
        using var db = NewDb();
        AddEvent(db, 1, null, ListStatusKeys.Playing, new DateTimeOffset(2026, 5, 31, 23, 30, 0, TimeSpan.FromHours(3)));

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(1, stats.Activity.Months.Single(m => m.Month == "2026-05").Started);
    }

    [Fact]
    public async Task GetStatsAsync_LogStartedAt_IsTheUsersEarliestEvent()
    {
        using var db = NewDb();
        var first = new DateTimeOffset(2026, 2, 3, 8, 0, 0, TimeSpan.Zero);
        AddEvent(db, 1, null, ListStatusKeys.Playing, first.AddDays(30));
        AddEvent(db, 2, null, ListStatusKeys.Backlog, first);

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(first, stats.Activity.LogStartedAt);
    }

    [Fact]
    public async Task GetStatsAsync_Wishlist_IsCountedSeparatelyFromTheLists()
    {
        // A wishlisted game usually has no entry at all, so this is not a subset of anything above.
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Playing);
        db.UserWishlistItems.Add(new UserWishlistItem { UserId = UserId, GameId = 7, AddedAt = Now });
        db.UserWishlistItems.Add(new UserWishlistItem { UserId = UserId, GameId = 8, AddedAt = Now });
        db.SaveChanges();

        var stats = await NewService(db).GetStatsAsync(UserId, default);

        Assert.Equal(2, stats.Library.Wishlisted);
        Assert.Equal(1, stats.Library.Recorded);
    }
}
