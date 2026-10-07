using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
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
        ApplicationDbContext db,
        int gameId,
        string? status,
        short? score = null,
        string userId = UserId,
        string origin = EntryOrigins.Manual)
    {
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            StatusId = status is null ? null : StatusId(db, status),
            Score = score,
            Origin = origin,
            AddedAt = Now
        });
        db.SaveChanges();
    }

    /// <summary>
    /// One playthrough on the user's entry for a game, creating that entry if it is not there.
    /// </summary>
    private static void AddPlaythrough(
        ApplicationDbContext db,
        int gameId,
        int? platformId = 6,
        int? minutesPlayed = 600,
        string userId = UserId,
        DateOnly? startedOn = null,
        DateOnly? finishedOn = null)
    {
        var entry = db.UserGameEntries.FirstOrDefault(e => e.UserId == userId && e.GameId == gameId);
        if (entry is null)
        {
            AddEntry(db, gameId, status: null, userId: userId);
            entry = db.UserGameEntries.Single(e => e.UserId == userId && e.GameId == gameId);
        }

        db.UserGamePlaythroughs.Add(new UserGamePlaythrough
        {
            UserId = userId,
            Entry = entry,
            PlatformId = platformId,
            MinutesPlayed = minutesPlayed,
            StartedOn = startedOn,
            FinishedOn = finishedOn,
            CreatedAt = Now,
            UpdatedAt = Now
        });
        db.SaveChanges();
    }

    /// <summary>
    /// A game as a Grouvee import leaves it: a status with no event behind it, the source named in
    /// <c>Origin</c>, and a playthrough carrying whichever dates the export had (ADR 0037). Further
    /// runs go on the same entry through <see cref="AddPlaythrough"/>.
    /// </summary>
    private static void AddImported(
        ApplicationDbContext db,
        int gameId,
        DateOnly? startedOn = null,
        DateOnly? finishedOn = null,
        string userId = UserId)
    {
        AddEntry(
            db,
            gameId,
            finishedOn is null ? ListStatusKeys.Playing : ListStatusKeys.Finished,
            userId: userId,
            origin: EntryOrigins.Grouvee);
        AddPlaythrough(
            db, gameId, minutesPlayed: null, userId: userId, startedOn: startedOn, finishedOn: finishedOn);
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

    // -----------------------------------------------------------------------------------
    // Playtime — the first figures on this page that hours actually back
    // -----------------------------------------------------------------------------------

    [Fact]
    public async Task GetStatsAsync_NoPlaythroughs_ReportsNothingRatherThanZeroesWithAPlatform()
    {
        using var db = NewDb();

        var playtime = (await NewService(db).GetStatsAsync(UserId, default)).Playtime;

        Assert.Equal(0, playtime.Playthroughs);
        Assert.Equal(0, playtime.TotalMinutes);
        Assert.Equal(0, playtime.WithHours);
        Assert.Empty(playtime.ByPlatform);
    }

    [Fact]
    public async Task GetStatsAsync_Playthroughs_SumTheirMinutes()
    {
        using var db = NewDb();
        AddPlaythrough(db, gameId: 1, minutesPlayed: 600);
        AddPlaythrough(db, gameId: 2, minutesPlayed: 195);

        var playtime = (await NewService(db).GetStatsAsync(UserId, default)).Playtime;

        Assert.Equal(2, playtime.Playthroughs);
        Assert.Equal(795, playtime.TotalMinutes);
        Assert.Equal(2, playtime.WithHours);
    }

    [Fact]
    public async Task GetStatsAsync_PlaythroughWithNoHours_IsCountedButAddsNothing()
    {
        // The gap between Playthroughs and WithHours is what stops the total reading as though it
        // covered every run.
        using var db = NewDb();
        AddPlaythrough(db, gameId: 1, minutesPlayed: 600);
        AddPlaythrough(db, gameId: 2, minutesPlayed: null);

        var playtime = (await NewService(db).GetStatsAsync(UserId, default)).Playtime;

        Assert.Equal(2, playtime.Playthroughs);
        Assert.Equal(1, playtime.WithHours);
        Assert.Equal(600, playtime.TotalMinutes);
    }

    [Fact]
    public async Task GetStatsAsync_PlaythroughWithNoPlatform_CountsTowardsTheTotalAndNoPlatformRow()
    {
        // The time was real even where the user did not say where it was spent. Inventing an
        // "Unknown" bucket would put a platform-shaped thing in a list of platforms.
        using var db = NewDb();
        AddPlaythrough(db, gameId: 1, platformId: null, minutesPlayed: 500);
        AddPlaythrough(db, gameId: 2, platformId: 6, minutesPlayed: 100);

        var playtime = (await NewService(db).GetStatsAsync(UserId, default)).Playtime;

        Assert.Equal(600, playtime.TotalMinutes);
        Assert.Equal([6], playtime.ByPlatform.Select(p => p.PlatformId));
        Assert.Equal(100, playtime.ByPlatform.Single().Minutes);
    }

    [Fact]
    public async Task GetStatsAsync_ByPlatform_IsOrderedByMinutesDescending()
    {
        using var db = NewDb();
        AddPlaythrough(db, gameId: 1, platformId: 6, minutesPlayed: 100);
        AddPlaythrough(db, gameId: 2, platformId: 48, minutesPlayed: 900);
        AddPlaythrough(db, gameId: 3, platformId: 130, minutesPlayed: 400);

        var playtime = (await NewService(db).GetStatsAsync(UserId, default)).Playtime;

        Assert.Equal([48, 130, 6], playtime.ByPlatform.Select(p => p.PlatformId));
    }

    [Fact]
    public async Task GetStatsAsync_ByPlatform_BreaksTiesOnPlatformId()
    {
        // Otherwise the order depends on which row the database happened to return first, and two
        // requests could disagree about a page that has not changed.
        using var db = NewDb();
        AddPlaythrough(db, gameId: 1, platformId: 130, minutesPlayed: 300);
        AddPlaythrough(db, gameId: 2, platformId: 6, minutesPlayed: 300);
        AddPlaythrough(db, gameId: 3, platformId: 48, minutesPlayed: 300);

        var playtime = (await NewService(db).GetStatsAsync(UserId, default)).Playtime;

        Assert.Equal([6, 48, 130], playtime.ByPlatform.Select(p => p.PlatformId));
    }

    [Fact]
    public async Task GetStatsAsync_TwoRunsOnOnePlatform_AreOneRowWithBothCounted()
    {
        using var db = NewDb();
        AddPlaythrough(db, gameId: 1, platformId: 6, minutesPlayed: 600);
        AddPlaythrough(db, gameId: 2, platformId: 6, minutesPlayed: 200);

        var byPlatform = (await NewService(db).GetStatsAsync(UserId, default)).Playtime.ByPlatform;

        var pc = Assert.Single(byPlatform);
        Assert.Equal(800, pc.Minutes);
        Assert.Equal(2, pc.Playthroughs);
    }

    [Fact]
    public async Task GetStatsAsync_AnotherUsersPlaythroughs_AreNotCounted()
    {
        using var db = NewDb();
        AddPlaythrough(db, gameId: 1, minutesPlayed: 600, userId: OtherUserId);

        var playtime = (await NewService(db).GetStatsAsync(UserId, default)).Playtime;

        Assert.Equal(0, playtime.Playthroughs);
        Assert.Empty(playtime.ByPlatform);
    }

    // -----------------------------------------------------------------------------------
    // A playthrough's dates in the activity figures — a status change first, the dates second
    // -----------------------------------------------------------------------------------

    /// <summary>The chart's months by label, for a test about what lands in which.</summary>
    private static async Task<Dictionary<string, ActivityMonthDto>> MonthsOf(ApplicationDbContext db) =>
        (await NewService(db).GetStatsAsync(UserId, default)).Activity.Months.ToDictionary(m => m.Month);

    [Fact]
    public async Task GetStatsAsync_ImportedFinishDatesAndNoEvents_CountAsFinishes()
    {
        // The case #194 is about. An import writes no events (ADR 0026 §2), so an imported library
        // used to chart nothing at all, however many dated finishes it carried.
        using var db = NewDb();
        AddImported(db, 1, finishedOn: new DateOnly(2026, 4, 12));
        AddImported(db, 2, finishedOn: new DateOnly(2026, 5, 3));
        AddImported(db, 3, finishedOn: new DateOnly(2026, 5, 28));

        var activity = (await NewService(db).GetStatsAsync(UserId, default)).Activity;

        Assert.Equal(["2026-04", "2026-05", "2026-06"], activity.Months.Select(m => m.Month));
        Assert.Equal([1, 2, 0], activity.Months.Select(m => m.Finished));
    }

    [Fact]
    public async Task GetStatsAsync_NoEventsAtAll_StillChartsAndKeepsAStreak()
    {
        // The owner's own account in miniature: a whole library imported and not one status change.
        // Nothing about the dates needs the log to exist.
        using var db = NewDb();
        AddImported(db, 1, finishedOn: new DateOnly(2026, 3, 9));
        AddImported(db, 2, finishedOn: new DateOnly(2026, 4, 20));
        AddImported(db, 3, finishedOn: new DateOnly(2026, 5, 1));

        var activity = (await NewService(db).GetStatsAsync(UserId, default)).Activity;

        Assert.Equal(["2026-03", "2026-04", "2026-05", "2026-06"], activity.Months.Select(m => m.Month));
        // June has no finish yet, so the run is anchored to May, exactly as it is for status changes.
        Assert.Equal(3, activity.CurrentStreakMonths);
        Assert.Equal(3, activity.LongestStreakMonths);
        // And there is still no log to have begun: a date is not a status change.
        Assert.Null(activity.LogStartedAt);
        Assert.Equal(0, activity.Transitions);
    }

    [Fact]
    public async Task GetStatsAsync_AFinishEventAndAFinishDateInDifferentMonths_CountOnlyTheEventMonth()
    {
        // One finish recorded both ways across a month boundary: a run logged as finished on the
        // 30th of April, and the game moved to Finished on the 2nd of May. The status change is our
        // own tracking and takes precedence. A union would make it two finishes and a streak.
        using var db = NewDb();
        AddEvent(db, 1, null, ListStatusKeys.Playing, new DateTimeOffset(2026, 4, 10, 9, 0, 0, TimeSpan.Zero));
        AddEvent(db, 1, ListStatusKeys.Playing, ListStatusKeys.Finished, new DateTimeOffset(2026, 5, 2, 9, 0, 0, TimeSpan.Zero));
        AddPlaythrough(db, gameId: 1, startedOn: new DateOnly(2026, 4, 10), finishedOn: new DateOnly(2026, 4, 30));

        var activity = (await NewService(db).GetStatsAsync(UserId, default)).Activity;

        var months = activity.Months.ToDictionary(m => m.Month);
        Assert.Equal(0, months["2026-04"].Finished);
        Assert.Equal(1, months["2026-05"].Finished);
        Assert.Equal(1, activity.LongestStreakMonths);
    }

    [Fact]
    public async Task GetStatsAsync_AFinishDateWithNoFinishEvent_CountsBesideOtherEvents()
    {
        // Precedence is per kind of act, not per game as a whole. A move to Playing says when the
        // game was started and nothing about whether it was ever finished, so the date still
        // answers that.
        using var db = NewDb();
        AddEvent(db, 1, null, ListStatusKeys.Backlog, new DateTimeOffset(2026, 4, 1, 9, 0, 0, TimeSpan.Zero));
        AddEvent(db, 1, ListStatusKeys.Backlog, ListStatusKeys.Playing, new DateTimeOffset(2026, 4, 20, 9, 0, 0, TimeSpan.Zero));
        AddPlaythrough(db, gameId: 1, finishedOn: new DateOnly(2026, 5, 17));

        var months = await MonthsOf(db);

        Assert.Equal(1, months["2026-04"].Started);
        Assert.Equal(1, months["2026-05"].Finished);
    }

    [Fact]
    public async Task GetStatsAsync_NoStartEvent_StartsFromTheEarliestPlaythroughDate()
    {
        // Two runs of one game: started once, in March, however often it was played after that.
        using var db = NewDb();
        AddImported(db, 1, startedOn: new DateOnly(2026, 3, 14), finishedOn: new DateOnly(2026, 3, 30));
        AddPlaythrough(db, gameId: 1, startedOn: new DateOnly(2026, 5, 2));

        var months = await MonthsOf(db);

        Assert.Equal(1, months["2026-03"].Started);
        Assert.Equal(0, months["2026-05"].Started);
    }

    [Fact]
    public async Task GetStatsAsync_AFinishDateWithNoStartDate_CountsAsStartedThatMonth()
    {
        // 94 rows of the real Grouvee export carry a finish and no start (ADR 0037). A game that was
        // finished had been started by then — the reading ADR 0023 gives a game ticked off straight
        // from the backlog — and without it the chart would show finishes nobody ever started.
        using var db = NewDb();
        AddImported(db, 1, finishedOn: new DateOnly(2026, 4, 12));

        var april = (await MonthsOf(db))["2026-04"];

        Assert.Equal(1, april.Started);
        Assert.Equal(1, april.Finished);
    }

    [Fact]
    public async Task GetStatsAsync_AStartEvent_OutranksAnEarlierStartDate()
    {
        using var db = NewDb();
        AddEvent(db, 1, null, ListStatusKeys.Playing, new DateTimeOffset(2026, 5, 6, 9, 0, 0, TimeSpan.Zero));
        AddPlaythrough(db, gameId: 1, startedOn: new DateOnly(2026, 2, 20));

        var activity = (await NewService(db).GetStatsAsync(UserId, default)).Activity;

        // Started when the log says. And the overridden date does not drag the chart back to
        // February either — only a date that is counted extends it, or the chart would open on three
        // months of nothing with no visible reason for them.
        Assert.Equal(["2026-05", "2026-06"], activity.Months.Select(m => m.Month));
        Assert.Equal(1, activity.Months[0].Started);
    }

    [Fact]
    public async Task GetStatsAsync_AnImportedGamePickedUpAgain_StartsByTheLogAndFinishesByTheDate()
    {
        // The one place the two sources disagree, pinned so that it stays a decision (ADR 0047). The
        // move back to Playing is a status change and settles the start; nothing has moved the game
        // to Finished here, so the imported date still settles that — and the chart shows a finish
        // in a month before the start it counts.
        using var db = NewDb();
        AddImported(db, 1, finishedOn: new DateOnly(2026, 3, 8));
        AddEvent(db, 1, ListStatusKeys.Finished, ListStatusKeys.Playing, new DateTimeOffset(2026, 5, 6, 9, 0, 0, TimeSpan.Zero));

        var months = await MonthsOf(db);

        Assert.Equal(0, months["2026-03"].Started);
        Assert.Equal(1, months["2026-03"].Finished);
        Assert.Equal(1, months["2026-05"].Started);
    }

    [Fact]
    public async Task GetStatsAsync_RunsFinishedTwiceInOneMonth_CountOnceAndAgainInALaterMonth()
    {
        // At most one finish per game per month, as for status changes, and a finish of the same
        // game in a later month is a finish of its own.
        using var db = NewDb();
        AddImported(db, 1, startedOn: new DateOnly(2026, 4, 1), finishedOn: new DateOnly(2026, 4, 3));
        AddPlaythrough(db, gameId: 1, startedOn: new DateOnly(2026, 4, 10), finishedOn: new DateOnly(2026, 4, 25));
        AddPlaythrough(db, gameId: 1, startedOn: new DateOnly(2026, 5, 30), finishedOn: new DateOnly(2026, 6, 2));

        var months = await MonthsOf(db);

        Assert.Equal([1, 0, 1], new[] { "2026-04", "2026-05", "2026-06" }.Select(m => months[m].Finished));
    }

    [Fact]
    public async Task GetStatsAsync_Months_ReachBackToTheEarliestCountedDate()
    {
        // An imported finish from before the log began stays on the chart. Starting at the first
        // event would drop it — and "finished this year" with it — the moment its owner moved a
        // single game here.
        using var db = NewDb();
        var firstChange = new DateTimeOffset(2026, 5, 6, 9, 0, 0, TimeSpan.Zero);
        AddImported(db, 1, finishedOn: new DateOnly(2026, 2, 14));
        AddEvent(db, 2, null, ListStatusKeys.Playing, firstChange);

        var activity = (await NewService(db).GetStatsAsync(UserId, default)).Activity;

        Assert.Equal("2026-02", activity.Months[0].Month);
        Assert.Equal(1, activity.Months[0].Finished);
        // The log still began when it began. A playthrough's date says when a game was played, not
        // when anybody started tracking here.
        Assert.Equal(firstChange, activity.LogStartedAt);
    }

    [Fact]
    public async Task GetStatsAsync_Months_FromAnOldDateAreStillCappedAtTwelve()
    {
        // An import can carry a decade. The chart shows the last year of it, and the streak record
        // still reaches all the way back, as it does for status changes.
        using var db = NewDb();
        foreach (var month in new[] { 1, 2, 3 })
            AddImported(db, month, finishedOn: new DateOnly(2019, month, 10));

        var activity = (await NewService(db).GetStatsAsync(UserId, default)).Activity;

        Assert.Equal(12, activity.Months.Count);
        Assert.Equal("2025-07", activity.Months[0].Month);
        Assert.Equal(0, activity.Months.Sum(m => m.Finished));
        Assert.Equal(3, activity.LongestStreakMonths);
        Assert.Equal(0, activity.CurrentStreakMonths);
    }

    [Fact]
    public async Task GetStatsAsync_ADateInAMonthNotYetBegun_IsNotCounted()
    {
        // A typed date can be wrong in a way our clock cannot. July has not begun, so a finish in it
        // has not happened — and must not stretch a one-month streak into two.
        using var db = NewDb();
        AddImported(db, 1, finishedOn: new DateOnly(2026, 6, 3));
        AddImported(db, 2, finishedOn: new DateOnly(2026, 7, 2));

        var activity = (await NewService(db).GetStatsAsync(UserId, default)).Activity;

        Assert.Equal(["2026-06"], activity.Months.Select(m => m.Month));
        Assert.Equal(1, activity.Months[0].Finished);
        Assert.Equal(1, activity.Months[0].Started);
        Assert.Equal(1, activity.LongestStreakMonths);
    }

    [Fact]
    public async Task GetStatsAsync_DatesOnARunLoggedHere_CountAsWellAsImportedOnes()
    {
        // Every playthrough, not only imported ones (ADR 0047). A finish date logged here on a game
        // that was never moved to Finished is as real a finish as one typed into another tracker,
        // and the precedence already lets our own status changes win wherever there are any.
        using var db = NewDb();
        AddPlaythrough(db, gameId: 1, finishedOn: new DateOnly(2026, 5, 20));

        var may = (await MonthsOf(db))["2026-05"];

        Assert.Equal(1, may.Finished);
    }

    [Fact]
    public async Task GetStatsAsync_PlaythroughDates_LeaveDropsTransitionsAndTimeToFinishAlone()
    {
        // A playthrough cannot say a game was dropped, the transition count is a count of status
        // changes, and a run's calendar span is not time spent in Playing (ADR 0018). So a dated
        // import adds to none of the three.
        using var db = NewDb();
        var may = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        AddEvent(db, 1, null, ListStatusKeys.Playing, may);
        AddEvent(db, 1, ListStatusKeys.Playing, ListStatusKeys.Finished, may.AddDays(3));
        AddEvent(db, 2, null, ListStatusKeys.Playing, may);
        AddEvent(db, 2, ListStatusKeys.Playing, ListStatusKeys.Dropped, may.AddDays(1));
        AddImported(db, 3, startedOn: new DateOnly(2026, 3, 1), finishedOn: new DateOnly(2026, 3, 21));

        var activity = (await NewService(db).GetStatsAsync(UserId, default)).Activity;

        Assert.Equal(4, activity.Transitions);
        Assert.Equal(1, activity.Months.Sum(m => m.Dropped));
        Assert.Equal(1, activity.Months.Single(m => m.Month == "2026-05").Dropped);
        Assert.NotNull(activity.TimeToFinish);
        Assert.Equal(1, activity.TimeToFinish.Samples);
        Assert.Equal(72, activity.TimeToFinish.MedianHours, precision: 6);
    }

    [Fact]
    public async Task GetStatsAsync_Streak_RunsAcrossBothSources()
    {
        // Imported finishes in April and May, and one marked Finished here in June: one run of
        // three, because a streak is about months with a finish in them, not where each was written.
        using var db = NewDb();
        AddImported(db, 1, finishedOn: new DateOnly(2026, 4, 11));
        AddImported(db, 2, finishedOn: new DateOnly(2026, 5, 19));
        AddEvent(db, 3, null, ListStatusKeys.Playing, new DateTimeOffset(2026, 6, 1, 9, 0, 0, TimeSpan.Zero));
        AddEvent(db, 3, ListStatusKeys.Playing, ListStatusKeys.Finished, new DateTimeOffset(2026, 6, 10, 9, 0, 0, TimeSpan.Zero));

        var activity = (await NewService(db).GetStatsAsync(UserId, default)).Activity;

        Assert.Equal(3, activity.CurrentStreakMonths);
        Assert.Equal(3, activity.LongestStreakMonths);
    }

    [Fact]
    public async Task GetStatsAsync_AnotherUsersPlaythroughDates_AreNotCounted()
    {
        using var db = NewDb();
        AddImported(db, 1, finishedOn: new DateOnly(2026, 5, 2), userId: OtherUserId);

        var activity = (await NewService(db).GetStatsAsync(UserId, default)).Activity;

        Assert.Empty(activity.Months);
        Assert.Equal(0, activity.LongestStreakMonths);
    }
}
