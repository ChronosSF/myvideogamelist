using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

public class ListServiceTests
{
    private const string UserId = "user-1";

    /// <summary>
    /// A controllable clock, so the event log's timestamps can be asserted. Hand-rolled rather
    /// than pulling in <c>Microsoft.Extensions.TimeProvider.Testing</c> for four lines.
    /// </summary>
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// <c>EnsureCreated</c> is what applies the <c>ListStatuses</c> seed on the in-memory
    /// provider. Without it every status lookup misses and the service throws.
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

    private static GameDto Game(int id, string title = "Game") =>
        new(id, title, null, null, null, null, null, null, null, null, null, null, null,
            Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    /// <summary>Returns the given games for any ID lookup, so list composition can be asserted.</summary>
    private static IIgdbService IgdbReturning(params GameDto[] games)
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(games);
        return igdb;
    }

    private static ListService NewService(
        ApplicationDbContext db, IIgdbService? igdb = null, TimeProvider? clock = null) =>
        new(db, igdb ?? Substitute.For<IIgdbService>(), clock ?? new FixedClock(Midday));

    private static short StatusId(ApplicationDbContext db, string key) =>
        db.ListStatuses.Single(s => s.Key == key).Id;

    // ---------------------------------------------------------------- reading

    [Fact]
    public async Task GetListsAsync_WithNoEntries_ReturnsEveryStatusEmptyWithoutCallingIgdb()
    {
        using var db = NewDb();
        var igdb = Substitute.For<IIgdbService>();
        var service = NewService(db, igdb);

        var result = await service.GetListsAsync(UserId);

        // Every status present even when empty, so the client never guards a missing key.
        Assert.Equal(5, result.Lists.Count);
        Assert.All(result.Lists.Values, games => Assert.Empty(games));
        await igdb.DidNotReceive()
            .GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetListsAsync_KeysEveryListByItsStatusKey()
    {
        using var db = NewDb();
        var service = NewService(db, IgdbReturning(Game(10)));

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.OnHold);

        var lists = (await service.GetListsAsync(UserId)).Lists;

        Assert.Equal(10, Assert.Single(lists[ListStatusKeys.OnHold]).Game.Id);
        Assert.Empty(lists[ListStatusKeys.Playing]);
    }

    [Fact]
    public async Task GetListsAsync_SkipsEntriesIgdbCannotResolve()
    {
        using var db = NewDb();
        // IGDB knows about 10 but not 11 — a stale or delisted ID must not produce a null hole.
        var service = NewService(db, IgdbReturning(Game(10)));

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Backlog);
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = UserId,
            GameId = 11,
            StatusId = StatusId(db, ListStatusKeys.Backlog),
            AddedAt = Midday
        });
        await db.SaveChangesAsync();

        var backlog = (await service.GetListsAsync(UserId)).Lists[ListStatusKeys.Backlog];

        Assert.Equal(10, Assert.Single(backlog).Game.Id);
    }

    // ---------------------------------------------------------------- writing

    [Fact]
    public async Task SetListEntryAsync_AddsNewEntry()
    {
        using var db = NewDb();
        var service = NewService(db, IgdbReturning(Game(10)));

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);

        var playing = (await service.GetListsAsync(UserId)).Lists[ListStatusKeys.Playing];
        Assert.Equal(10, Assert.Single(playing).Game.Id);
    }

    [Fact]
    public async Task SetListEntryAsync_CalledTwice_MovesRatherThanDuplicates()
    {
        using var db = NewDb();
        var service = NewService(db, IgdbReturning(Game(10)));

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Finished);

        Assert.Equal(1, await db.UserGameEntries.CountAsync());

        var lists = (await service.GetListsAsync(UserId)).Lists;
        Assert.Empty(lists[ListStatusKeys.Playing]);
        Assert.Single(lists[ListStatusKeys.Finished]);
    }

    [Theory]
    [InlineData("wishlist")]
    [InlineData("Playing")]
    [InlineData("")]
    public async Task SetListEntryAsync_WithUnknownStatus_Throws(string status)
    {
        using var db = NewDb();
        var service = NewService(db);

        await Assert.ThrowsAsync<ArgumentException>(
            () => service.SetListEntryAsync(UserId, 10, status));
    }

    [Fact]
    public async Task RemoveListEntryAsync_ReturnsFalseWhenAbsent()
    {
        using var db = NewDb();
        var service = NewService(db);

        Assert.False(await service.RemoveListEntryAsync(UserId, 999));
    }

    [Fact]
    public async Task RemoveListEntryAsync_RemovesOnlyTheCallersEntry()
    {
        using var db = NewDb();
        var service = NewService(db, IgdbReturning(Game(10)));

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        await service.SetListEntryAsync("someone-else", 10, ListStatusKeys.Playing);

        Assert.True(await service.RemoveListEntryAsync(UserId, 10));

        Assert.Empty((await service.GetListsAsync(UserId)).Lists[ListStatusKeys.Playing]);
        Assert.Single((await service.GetListsAsync("someone-else")).Lists[ListStatusKeys.Playing]);
    }

    // ---------------------------------------------------------------- the event log

    [Fact]
    public async Task SetListEntryAsync_OnFirstAdd_RecordsAnArrivalFromNothing()
    {
        using var db = NewDb();
        var service = NewService(db, clock: new FixedClock(Midday));

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Backlog);

        var logged = Assert.Single(await db.UserGameEvents.ToListAsync());
        Assert.Equal(UserId, logged.UserId);
        Assert.Equal(10, logged.GameId);
        Assert.Null(logged.FromStatusId);
        Assert.Equal(StatusId(db, ListStatusKeys.Backlog), logged.ToStatusId);
        Assert.Equal(Midday, logged.OccurredAt);
    }

    [Fact]
    public async Task SetListEntryAsync_OnMove_RecordsBothEndsOfTheTransition()
    {
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        var service = NewService(db, clock: clock);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        clock.Advance(TimeSpan.FromDays(30));
        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Finished);

        var events = await db.UserGameEvents.OrderBy(e => e.OccurredAt).ToListAsync();

        Assert.Equal(2, events.Count);
        Assert.Equal(StatusId(db, ListStatusKeys.Playing), events[1].FromStatusId);
        Assert.Equal(StatusId(db, ListStatusKeys.Finished), events[1].ToStatusId);
        Assert.Equal(Midday.AddDays(30), events[1].OccurredAt);
    }

    [Fact]
    public async Task SetListEntryAsync_ToTheStatusAlreadyHeld_RecordsNothing()
    {
        // The optimistic-update UI and ordinary double-clicks both send these. Recording them
        // would inflate every count later derived from the log.
        using var db = NewDb();
        var service = NewService(db);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);

        Assert.Equal(1, await db.UserGameEvents.CountAsync());
        Assert.Equal(1, await db.UserGameEntries.CountAsync());
    }

    [Fact]
    public async Task RemoveListEntryAsync_RecordsADepartureToNothing()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Dropped);
        await service.RemoveListEntryAsync(UserId, 10);

        var last = await db.UserGameEvents.OrderBy(e => e.Id).LastAsync();
        Assert.Equal(StatusId(db, ListStatusKeys.Dropped), last.FromStatusId);
        Assert.Null(last.ToStatusId);
    }

    [Fact]
    public async Task RemoveListEntryAsync_LeavesTheEntryAndTheHistoryIntact()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Backlog);
        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Finished);
        await service.RemoveListEntryAsync(UserId, 10);

        // The row survives with no status: leaving every list is not the same as being forgotten.
        var entry = Assert.Single(await db.UserGameEntries.ToListAsync());
        Assert.Null(entry.StatusId);
        Assert.Equal(4, await db.UserGameEvents.CountAsync(e => e.GameId == 10));
    }

    [Fact]
    public async Task RemoveListEntryAsync_CalledTwice_ReportsNothingToDoTheSecondTime()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);

        Assert.True(await service.RemoveListEntryAsync(UserId, 10));
        Assert.False(await service.RemoveListEntryAsync(UserId, 10));

        // And the second call records no phantom departure.
        Assert.Equal(2, await db.UserGameEvents.CountAsync());
    }

    [Fact]
    public async Task TheEventLog_IsScopedToTheUserWhoActed()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        await service.SetListEntryAsync("someone-else", 10, ListStatusKeys.Finished);

        Assert.Equal(1, await db.UserGameEvents.CountAsync(e => e.UserId == UserId));
        Assert.Equal(1, await db.UserGameEvents.CountAsync(e => e.UserId == "someone-else"));
    }

    [Fact]
    public async Task CompletionsForAMonth_AreCountableFromTheLogAlone()
    {
        // The query the whole table exists for, and the one a current-state table cannot answer.
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        var service = NewService(db, clock: clock);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Finished);
        clock.Advance(TimeSpan.FromDays(60));
        await service.SetListEntryAsync(UserId, 20, ListStatusKeys.Finished);

        var finished = StatusId(db, ListStatusKeys.Finished);
        var inMarch = await db.UserGameEvents.CountAsync(e =>
            e.ToStatusId == finished
            && e.OccurredAt >= Midday
            && e.OccurredAt < Midday.AddDays(31));

        Assert.Equal(1, inMarch);
    }
}

public class ListStatusSeedTests
{
    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    [Fact]
    public void SeedsTheFivePredefinedStatusesInLifecycleOrder()
    {
        using var db = NewDb();

        var keys = db.ListStatuses.OrderBy(s => s.SortOrder).Select(s => s.Key).ToList();

        Assert.Equal(
            [
                ListStatusKeys.Backlog,
                ListStatusKeys.Playing,
                ListStatusKeys.OnHold,
                ListStatusKeys.Finished,
                ListStatusKeys.Dropped
            ],
            keys);
    }

    [Fact]
    public void OnlyFinishedCountsAsACompletion()
    {
        using var db = NewDb();

        var counting = db.ListStatuses.Where(s => s.CountsAsCompletion).Select(s => s.Key).ToList();

        Assert.Equal([ListStatusKeys.Finished], counting);
    }

    [Fact]
    public void FinishedAndDroppedAreTheTerminalStatuses()
    {
        // Both resolve a game, which is why terminality alone cannot tell a completion from an
        // abandonment — the completion rate needs both flags.
        using var db = NewDb();

        var terminal = db.ListStatuses
            .Where(s => s.IsTerminal)
            .OrderBy(s => s.SortOrder)
            .Select(s => s.Key)
            .ToList();

        Assert.Equal([ListStatusKeys.Finished, ListStatusKeys.Dropped], terminal);
    }

    [Fact]
    public void BacklogIsTheOnlyStatusThatIsNotStarted()
    {
        using var db = NewDb();

        var notStarted = db.ListStatuses.Where(s => !s.IsStarted).Select(s => s.Key).ToList();

        Assert.Equal([ListStatusKeys.Backlog], notStarted);
    }
}

public class ScoreAndEntryTests
{
    private const string UserId = "user-1";
    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static GameDto Game(int id, string title = "Game") =>
        new(id, title, null, null, null, null, null, null, null, null, null, null, null,
            Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    private static IIgdbService IgdbReturning(params GameDto[] games)
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(games);
        return igdb;
    }

    private static ListService NewService(
        ApplicationDbContext db, IIgdbService? igdb = null, TimeProvider? clock = null) =>
        new(db, igdb ?? IgdbReturning(Game(10)), clock ?? new FixedClock(Midday));

    // ------------------------------------------------ the score stands on its own

    [Fact]
    public async Task SetScoreAsync_OnAGameInNoList_CreatesTheEntryWithNoStatus()
    {
        // Scoring is a judgement about a game, not a statement about a list.
        using var db = NewDb();
        var service = NewService(db);

        await service.SetScoreAsync(UserId, 10, 8);

        var entry = Assert.Single(await db.UserGameEntries.ToListAsync());
        Assert.Equal((short)8, entry.Score);
        Assert.Null(entry.StatusId);
        Assert.Equal(Midday, entry.AddedAt);
    }

    [Fact]
    public async Task SetScoreAsync_RecordsNoStatusEvent()
    {
        // Only status transitions belong in the log; a score is not one.
        using var db = NewDb();
        var service = NewService(db);

        await service.SetScoreAsync(UserId, 10, 8);

        Assert.Empty(await db.UserGameEvents.ToListAsync());
    }

    [Fact]
    public async Task TheScore_SurvivesEveryStatusChangeAndLeavingAllLists()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetScoreAsync(UserId, 10, 9);
        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Dropped);
        await service.RemoveListEntryAsync(UserId, 10);

        var entry = Assert.Single(await db.UserGameEntries.ToListAsync());
        Assert.Equal((short)9, entry.Score);
        Assert.Null(entry.StatusId);
    }

    [Fact]
    public async Task SetScoreAsync_WithNull_ClearsTheScoreWithoutTouchingTheStatus()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Finished);
        await service.SetScoreAsync(UserId, 10, 7);
        await service.SetScoreAsync(UserId, 10, null);

        var entry = Assert.Single(await db.UserGameEntries.ToListAsync());
        Assert.Null(entry.Score);
        Assert.NotNull(entry.StatusId);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(11)]
    [InlineData(-1)]
    public async Task SetScoreAsync_OutsideOneToTen_Throws(short score)
    {
        using var db = NewDb();
        var service = NewService(db);

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => service.SetScoreAsync(UserId, 10, score));
    }

    // ------------------------------------------------ statusless entries are in no list

    [Fact]
    public async Task GetListsAsync_ExcludesEntriesWithNoStatus()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetScoreAsync(UserId, 10, 8);

        var lists = (await service.GetListsAsync(UserId)).Lists;
        Assert.All(lists.Values, entries => Assert.Empty(entries));
    }

    [Fact]
    public async Task GetEntryAsync_FindsAScoredGameThatIsInNoList()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetScoreAsync(UserId, 10, 8);

        var entry = await service.GetEntryAsync(UserId, 10);

        Assert.NotNull(entry);
        Assert.Equal((short)8, entry.Score);
        Assert.Equal(10, entry.Game.Id);
    }

    [Fact]
    public async Task GetEntryAsync_ReturnsNullWhenNothingIsRecorded()
        => Assert.Null(await NewService(NewDb()).GetEntryAsync(UserId, 999));

    // ------------------------------------------------ deleting everything

    [Fact]
    public async Task DeleteEntryAsync_RemovesTheRowAndTheScore()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Finished);
        await service.SetScoreAsync(UserId, 10, 10);

        Assert.True(await service.DeleteEntryAsync(UserId, 10));
        Assert.Empty(await db.UserGameEntries.ToListAsync());
    }

    [Fact]
    public async Task DeleteEntryAsync_RecordsTheDepartureAndKeepsTheHistory()
    {
        // The log outlives the entry: it holds no key to the row it describes.
        using var db = NewDb();
        var service = NewService(db);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        await service.DeleteEntryAsync(UserId, 10);

        var events = await db.UserGameEvents.OrderBy(e => e.Id).ToListAsync();
        Assert.Equal(2, events.Count);
        Assert.Null(events[1].ToStatusId);
    }

    [Fact]
    public async Task DeleteEntryAsync_OnAStatuslessEntry_RecordsNoDeparture()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetScoreAsync(UserId, 10, 5);
        Assert.True(await service.DeleteEntryAsync(UserId, 10));

        Assert.Empty(await db.UserGameEvents.ToListAsync());
    }

    [Fact]
    public async Task DeleteEntryAsync_ReturnsFalseWhenNothingIsRecorded()
        => Assert.False(await NewService(NewDb()).DeleteEntryAsync(UserId, 999));

    // ------------------------------------------------ the sort keys

    [Fact]
    public async Task AddedAt_IsSetOnceAndNeverMovesAgain()
    {
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        var service = NewService(db, clock: clock);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Backlog);
        clock.Advance(TimeSpan.FromDays(90));
        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Finished);

        var entry = Assert.Single(await db.UserGameEntries.ToListAsync());
        Assert.Equal(Midday, entry.AddedAt);
    }

    [Fact]
    public async Task StatusChangedAt_MovesOnARealTransitionButNotOnANoOp()
    {
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        var service = NewService(db, clock: clock);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        clock.Advance(TimeSpan.FromDays(2));
        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);

        var afterNoOp = await db.UserGameEntries.SingleAsync();
        Assert.Equal(Midday, afterNoOp.StatusChangedAt);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Finished);

        var afterMove = await db.UserGameEntries.SingleAsync();
        Assert.Equal(Midday.AddDays(2), afterMove.StatusChangedAt);
    }

    [Fact]
    public async Task StatusChangedAt_IsNullForAnEntryThatHasNeverBeenInAList()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetScoreAsync(UserId, 10, 6);

        Assert.Null((await db.UserGameEntries.SingleAsync()).StatusChangedAt);
    }

    [Fact]
    public async Task TheListPayload_CarriesTheScoreAndBothTimestamps()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Finished);
        await service.SetScoreAsync(UserId, 10, 9);

        var entry = Assert.Single(
            (await service.GetListsAsync(UserId)).Lists[ListStatusKeys.Finished]);

        Assert.Equal((short)9, entry.Score);
        Assert.Equal(Midday, entry.AddedAt);
        Assert.Equal(Midday, entry.StatusChangedAt);
    }
}
