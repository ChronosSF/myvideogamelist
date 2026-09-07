using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What a playthrough promises: it belongs to one account, it creates the entry it needs, it
/// records no history, and the community median it feeds says how little it may rest on.
/// </summary>
/// <remarks>
/// The scoping tests are the important ones. Everything else here is a shape somebody would notice
/// on screen; a service that let one account read or overwrite another's playthrough would not be
/// noticed at all.
/// </remarks>
public class PlaythroughServiceTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";
    private const int GameId = 42;

    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    /// <summary>
    /// A context whose playthrough types are the real ones: <c>EnsureCreated</c> applies the
    /// context's own <c>HasData</c>, so these tests resolve the three keys the migration seeds
    /// rather than a local copy that could drift from them.
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

    private static IMemoryCache NewCache() => new MemoryCache(new MemoryCacheOptions());

    private static PlaythroughService NewService(
        ApplicationDbContext db, IMemoryCache? cache = null, TimeProvider? clock = null) =>
        new(db, cache ?? NewCache(), clock ?? new FixedClock(Midday));

    private static PlaythroughInputDto Input(
        string? type = PlaythroughTypeKeys.Normally,
        int? platformId = 6,
        int? minutesPlayed = 600,
        DateOnly? startedOn = null,
        DateOnly? finishedOn = null,
        string? notes = null) =>
        new(type, platformId, minutesPlayed, startedOn, finishedOn, notes);

    /// <summary>An entry somebody else owns, so the scoping tests have something real to miss.</summary>
    private static async Task<PlaythroughDto> AddFor(
        ApplicationDbContext db, string userId, int gameId = GameId, PlaythroughInputDto? input = null) =>
        await NewService(db).AddAsync(userId, gameId, input ?? Input());

    // ---------------------------------------------------------------------------------------
    // Scoping
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task GetForGameAsync_AnotherUsersPlaythrough_IsNotReturned()
    {
        using var db = NewDb();
        await AddFor(db, OtherUserId);

        var mine = await NewService(db).GetForGameAsync(UserId, GameId);

        Assert.Empty(mine);
    }

    [Fact]
    public async Task UpdateAsync_AnotherUsersPlaythrough_ReturnsNullAndChangesNothing()
    {
        using var db = NewDb();
        var theirs = await AddFor(db, OtherUserId, input: Input(minutesPlayed: 600));

        var updated = await NewService(db).UpdateAsync(
            UserId, GameId, theirs.Id, Input(minutesPlayed: 1));

        Assert.Null(updated);
        Assert.Equal(600, db.UserGamePlaythroughs.Single().MinutesPlayed);
    }

    [Fact]
    public async Task DeleteAsync_AnotherUsersPlaythrough_ReportsNothingRemovedAndLeavesItAlone()
    {
        using var db = NewDb();
        var theirs = await AddFor(db, OtherUserId);

        var deleted = await NewService(db).DeleteAsync(UserId, GameId, theirs.Id);

        Assert.False(deleted);
        Assert.Single(db.UserGamePlaythroughs);
    }

    [Fact]
    public async Task UpdateAsync_PlaythroughOfADifferentGame_IsNotFound()
    {
        // The id alone is not the key: a playthrough reached under the wrong game would let the
        // route say one thing while the write did another.
        using var db = NewDb();
        var other = await AddFor(db, UserId, gameId: 99);

        var updated = await NewService(db).UpdateAsync(UserId, GameId, other.Id, Input());

        Assert.Null(updated);
    }

    // ---------------------------------------------------------------------------------------
    // Adding
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task AddAsync_GameWithNothingRecorded_CreatesTheEntryWithNoStatus()
    {
        // Logging a playthrough of a game that was never in a list is legitimate, exactly as
        // scoring one is (ADR 0019).
        using var db = NewDb();

        await NewService(db).AddAsync(UserId, GameId, Input());

        var entry = db.UserGameEntries.Single();
        Assert.Equal(GameId, entry.GameId);
        Assert.Null(entry.StatusId);
        Assert.Equal(Midday, entry.AddedAt);
    }

    [Fact]
    public async Task AddAsync_GameWithNothingRecorded_WritesNoEvent()
    {
        // The rule this feature exists under: a playthrough is not a status transition, and the
        // event log stays typed and narrow (ADR 0018).
        using var db = NewDb();

        await NewService(db).AddAsync(UserId, GameId, Input());

        Assert.Empty(db.UserGameEvents);
    }

    [Fact]
    public async Task AddAsync_GameAlreadyRecorded_AttachesToTheExistingEntry()
    {
        using var db = NewDb();
        var listService = new ListService(
            db, NSubstitute.Substitute.For<IIgdbService>(), new FixedClock(Midday));
        await listService.SetListEntryAsync(UserId, GameId, ListStatusKeys.Finished);

        await NewService(db).AddAsync(UserId, GameId, Input());

        var entry = db.UserGameEntries.Single();
        Assert.Equal(entry.Id, db.UserGamePlaythroughs.Single().UserGameEntryId);

        // And the status is exactly where ListService left it — nothing here moved it.
        Assert.Equal(db.ListStatuses.Single(s => s.Key == ListStatusKeys.Finished).Id, entry.StatusId);
    }

    [Fact]
    public async Task AddAsync_SecondPlaythroughOfTheSameGame_IsASecondRowOnOneEntry()
    {
        // The whole reason playtime and platform are not columns on the entry: a replay on another
        // platform is a new row, not an overwrite.
        using var db = NewDb();
        var service = NewService(db);

        await service.AddAsync(UserId, GameId, Input(platformId: 6));
        await service.AddAsync(UserId, GameId, Input(platformId: 48));

        Assert.Single(db.UserGameEntries);
        Assert.Equal([6, 48], db.UserGamePlaythroughs.Select(p => p.PlatformId).Order());
    }

    [Fact]
    public async Task AddAsync_UnknownType_Throws()
    {
        using var db = NewDb();

        await Assert.ThrowsAsync<ArgumentException>(
            () => NewService(db).AddAsync(UserId, GameId, Input(type: "leisurely")));
    }

    [Fact]
    public async Task AddAsync_NoType_IsRecordedAsUntyped()
    {
        // "Still playing, do not know yet" has to be expressible, so the type is optional.
        using var db = NewDb();

        var added = await NewService(db).AddAsync(UserId, GameId, Input(type: null));

        Assert.Null(added.Type);
        Assert.Null(db.UserGamePlaythroughs.Single().TypeId);
    }

    [Fact]
    public async Task AddAsync_ReportsTheTypeAsItsKeyRatherThanItsId()
    {
        using var db = NewDb();

        var added = await NewService(db).AddAsync(
            UserId, GameId, Input(type: PlaythroughTypeKeys.Completionist));

        Assert.Equal(PlaythroughTypeKeys.Completionist, added.Type);
    }

    [Fact]
    public async Task AddAsync_StampsBothTimestampsFromTheClock()
    {
        using var db = NewDb();

        var added = await NewService(db).AddAsync(UserId, GameId, Input());

        Assert.Equal(Midday, added.CreatedAt);
        Assert.Equal(Midday, added.UpdatedAt);
    }

    [Fact]
    public async Task AddAsync_BlankNotes_AreStoredAsNone()
    {
        using var db = NewDb();

        var added = await NewService(db).AddAsync(UserId, GameId, Input(notes: "   "));

        Assert.Null(added.Notes);
    }

    // ---------------------------------------------------------------------------------------
    // Updating and deleting
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task UpdateAsync_OwnPlaythrough_ReplacesTheFieldsAndMovesUpdatedAtOnly()
    {
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        var service = NewService(db, clock: clock);
        var added = await service.AddAsync(UserId, GameId, Input(minutesPlayed: 600, notes: "First run"));

        clock.Advance(TimeSpan.FromDays(3));
        var updated = await service.UpdateAsync(
            UserId, GameId, added.Id,
            Input(type: PlaythroughTypeKeys.Completionist, minutesPlayed: 2400, notes: "Went back for the rest"));

        Assert.NotNull(updated);
        Assert.Equal(PlaythroughTypeKeys.Completionist, updated.Type);
        Assert.Equal(2400, updated.MinutesPlayed);
        Assert.Equal("Went back for the rest", updated.Notes);
        Assert.Equal(Midday, updated.CreatedAt);
        Assert.Equal(Midday.AddDays(3), updated.UpdatedAt);
    }

    [Fact]
    public async Task UpdateAsync_UnknownType_ThrowsBeforeChangingAnything()
    {
        using var db = NewDb();
        var service = NewService(db);
        var added = await service.AddAsync(UserId, GameId, Input(minutesPlayed: 600));

        await Assert.ThrowsAsync<ArgumentException>(
            () => service.UpdateAsync(UserId, GameId, added.Id, Input(type: "leisurely", minutesPlayed: 1)));

        Assert.Equal(600, db.UserGamePlaythroughs.Single().MinutesPlayed);
    }

    [Fact]
    public async Task UpdateAsync_WritesNoEvent()
    {
        using var db = NewDb();
        var service = NewService(db);
        var added = await service.AddAsync(UserId, GameId, Input());

        await service.UpdateAsync(UserId, GameId, added.Id, Input(minutesPlayed: 30));

        Assert.Empty(db.UserGameEvents);
    }

    [Fact]
    public async Task DeleteAsync_OwnPlaythrough_RemovesItAndKeepsTheEntry()
    {
        // Deleting the record of playing a game is not deleting the record of the game.
        using var db = NewDb();
        var service = NewService(db);
        var added = await service.AddAsync(UserId, GameId, Input());

        var deleted = await service.DeleteAsync(UserId, GameId, added.Id);

        Assert.True(deleted);
        Assert.Empty(db.UserGamePlaythroughs);
        Assert.Single(db.UserGameEntries);
        Assert.Empty(db.UserGameEvents);
    }

    [Fact]
    public async Task DeleteAsync_NothingThere_ReportsNothingRemoved()
    {
        using var db = NewDb();

        Assert.False(await NewService(db).DeleteAsync(UserId, GameId, 9999));
    }

    // ---------------------------------------------------------------------------------------
    // Reading one game's playthroughs
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task GetForGameAsync_NothingLogged_IsEmptyRatherThanNull()
    {
        using var db = NewDb();

        Assert.Empty(await NewService(db).GetForGameAsync(UserId, GameId));
    }

    [Fact]
    public async Task GetForGameAsync_OrdersByStartDateThenByWhenLogged()
    {
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        var service = NewService(db, clock: clock);

        await service.AddAsync(UserId, GameId, Input(startedOn: new DateOnly(2026, 5, 1)));
        clock.Advance(TimeSpan.FromDays(1));
        await service.AddAsync(UserId, GameId, Input(startedOn: null, notes: "Undated"));
        clock.Advance(TimeSpan.FromDays(1));
        await service.AddAsync(UserId, GameId, Input(startedOn: new DateOnly(2026, 1, 9)));

        var ordered = await service.GetForGameAsync(UserId, GameId);

        Assert.Equal(
            [null, new DateOnly(2026, 1, 9), new DateOnly(2026, 5, 1)],
            ordered.Select(p => p.StartedOn));
    }

    [Fact]
    public async Task GetForGameAsync_AnotherGame_IsNotIncluded()
    {
        using var db = NewDb();
        var service = NewService(db);
        await service.AddAsync(UserId, GameId, Input());
        await service.AddAsync(UserId, 99, Input());

        var forGame = await service.GetForGameAsync(UserId, GameId);

        Assert.Single(forGame);
    }

    // ---------------------------------------------------------------------------------------
    // The community aggregate
    // ---------------------------------------------------------------------------------------

    /// <summary>The median for one tier, or null when it has no samples.</summary>
    private static CommunityTimeBucketDto Bucket(CommunityTimesDto times, string type) =>
        times.Buckets.Single(b => b.Type == type);

    [Fact]
    public async Task GetCommunityTimesAsync_NothingLogged_StillListsAllThreeTiers()
    {
        // "Nobody has logged this yet" is an answer, and the client should never have to guard a
        // missing tier.
        using var db = NewDb();

        var times = await NewService(db).GetCommunityTimesAsync(GameId);

        Assert.Equal(
            [PlaythroughTypeKeys.Rushed, PlaythroughTypeKeys.Normally, PlaythroughTypeKeys.Completionist],
            times.Buckets.Select(b => b.Type));
        Assert.All(times.Buckets, bucket =>
        {
            Assert.Equal(0, bucket.Samples);
            Assert.Null(bucket.MedianMinutes);
        });
    }

    [Fact]
    public async Task GetCommunityTimesAsync_OddCount_IsTheMiddleValue()
    {
        using var db = NewDb();
        foreach (var (user, minutes) in new[] { ("a", 300), ("b", 900), ("c", 600) })
            await AddFor(db, user, input: Input(minutesPlayed: minutes));

        var normally = Bucket(await NewService(db).GetCommunityTimesAsync(GameId), PlaythroughTypeKeys.Normally);

        Assert.Equal(3, normally.Samples);
        Assert.Equal(600, normally.MedianMinutes);
    }

    [Fact]
    public async Task GetCommunityTimesAsync_EvenCount_AveragesTheTwoMiddleValues()
    {
        using var db = NewDb();
        foreach (var (user, minutes) in new[] { ("a", 300), ("b", 500), ("c", 700), ("d", 9000) })
            await AddFor(db, user, input: Input(minutesPlayed: minutes));

        var normally = Bucket(await NewService(db).GetCommunityTimesAsync(GameId), PlaythroughTypeKeys.Normally);

        Assert.Equal(4, normally.Samples);
        Assert.Equal(600, normally.MedianMinutes);
    }

    [Fact]
    public async Task GetCommunityTimesAsync_OneLongOutlier_DoesNotMoveTheFigure()
    {
        // Why the median and not the mean: self-reported playtime has a long idle-hours tail, and
        // one person who left the game running over a weekend should not move the number. The mean
        // of these five is 2320.
        using var db = NewDb();
        foreach (var (user, minutes) in new[] { ("a", 540), ("b", 600), ("c", 660), ("d", 780), ("e", 9000) })
            await AddFor(db, user, input: Input(minutesPlayed: minutes));

        var normally = Bucket(await NewService(db).GetCommunityTimesAsync(GameId), PlaythroughTypeKeys.Normally);

        Assert.Equal(660, normally.MedianMinutes);
    }

    [Fact]
    public async Task GetCommunityTimesAsync_UntypedOrHourlessPlaythroughs_AreCountedNowhere()
    {
        // An untyped run has no tier to belong to and one with no duration has nothing to
        // contribute. Counting either would inflate a sample size behind a figure it did not help
        // produce, which is exactly what ADR 0016 says a count is for.
        using var db = NewDb();
        await AddFor(db, "a", input: Input(minutesPlayed: 600));
        await AddFor(db, "b", input: Input(type: null, minutesPlayed: 6000));
        await AddFor(db, "c", input: Input(minutesPlayed: null));

        var times = await NewService(db).GetCommunityTimesAsync(GameId);

        var normally = Bucket(times, PlaythroughTypeKeys.Normally);
        Assert.Equal(1, normally.Samples);
        Assert.Equal(600, normally.MedianMinutes);
        Assert.Equal(3, times.Buckets.Count);
    }

    [Fact]
    public async Task GetCommunityTimesAsync_CountsEachTierSeparately()
    {
        using var db = NewDb();
        await AddFor(db, "a", input: Input(type: PlaythroughTypeKeys.Rushed, minutesPlayed: 300));
        await AddFor(db, "b", input: Input(type: PlaythroughTypeKeys.Normally, minutesPlayed: 900));
        await AddFor(db, "c", input: Input(type: PlaythroughTypeKeys.Completionist, minutesPlayed: 2400));

        var times = await NewService(db).GetCommunityTimesAsync(GameId);

        Assert.Equal(300, Bucket(times, PlaythroughTypeKeys.Rushed).MedianMinutes);
        Assert.Equal(900, Bucket(times, PlaythroughTypeKeys.Normally).MedianMinutes);
        Assert.Equal(2400, Bucket(times, PlaythroughTypeKeys.Completionist).MedianMinutes);
    }

    [Fact]
    public async Task GetCommunityTimesAsync_AnotherGame_IsNotCounted()
    {
        using var db = NewDb();
        await AddFor(db, "a", gameId: 99, input: Input(minutesPlayed: 600));

        var normally = Bucket(await NewService(db).GetCommunityTimesAsync(GameId), PlaythroughTypeKeys.Normally);

        Assert.Equal(0, normally.Samples);
    }

    [Fact]
    public async Task GetCommunityTimesAsync_AfterAnAdd_ReflectsItRatherThanServingTheCachedFigure()
    {
        // The person most likely to look at this row is the one who has just logged a playthrough,
        // so the write evicts the key rather than leaving them to wait out the TTL.
        using var db = NewDb();
        var cache = NewCache();
        await AddFor(db, "a", input: Input(minutesPlayed: 600));

        var before = Bucket(await NewService(db, cache).GetCommunityTimesAsync(GameId), PlaythroughTypeKeys.Normally);
        await NewService(db, cache).AddAsync(UserId, GameId, Input(minutesPlayed: 1200));
        var after = Bucket(await NewService(db, cache).GetCommunityTimesAsync(GameId), PlaythroughTypeKeys.Normally);

        Assert.Equal(1, before.Samples);
        Assert.Equal(2, after.Samples);
        Assert.Equal(900, after.MedianMinutes);
    }

    [Fact]
    public async Task GetCommunityTimesAsync_AfterAnUpdate_ReflectsIt()
    {
        using var db = NewDb();
        var cache = NewCache();
        var added = await NewService(db, cache).AddAsync(UserId, GameId, Input(minutesPlayed: 600));

        await NewService(db, cache).GetCommunityTimesAsync(GameId);
        await NewService(db, cache).UpdateAsync(UserId, GameId, added.Id, Input(minutesPlayed: 1500));
        var after = Bucket(await NewService(db, cache).GetCommunityTimesAsync(GameId), PlaythroughTypeKeys.Normally);

        Assert.Equal(1500, after.MedianMinutes);
    }

    [Fact]
    public async Task GetCommunityTimesAsync_AfterADelete_ReflectsIt()
    {
        using var db = NewDb();
        var cache = NewCache();
        var added = await NewService(db, cache).AddAsync(UserId, GameId, Input(minutesPlayed: 600));

        await NewService(db, cache).GetCommunityTimesAsync(GameId);
        await NewService(db, cache).DeleteAsync(UserId, GameId, added.Id);
        var after = Bucket(await NewService(db, cache).GetCommunityTimesAsync(GameId), PlaythroughTypeKeys.Normally);

        Assert.Equal(0, after.Samples);
        Assert.Null(after.MedianMinutes);
    }

    [Fact]
    public async Task GetCommunityTimesAsync_AnotherGamesWrite_DoesNotEvictThisGame()
    {
        // Eviction is keyed on the game, so one member logging a run of something else must not
        // cost every other game its cached figure.
        using var db = NewDb();
        var cache = NewCache();
        await AddFor(db, "a", input: Input(minutesPlayed: 600));
        await NewService(db, cache).GetCommunityTimesAsync(GameId);

        // One write through the shared cache, for the *other* game, and one for this game through
        // a service with a cache of its own — so this game's key is only ever evicted by the first
        // if the eviction is not actually keyed on the game.
        await NewService(db, cache).AddAsync(UserId, 99, Input(minutesPlayed: 1200));
        await AddFor(db, "b", input: Input(minutesPlayed: 1800));

        var still = Bucket(await NewService(db, cache).GetCommunityTimesAsync(GameId), PlaythroughTypeKeys.Normally);
        Assert.Equal(1, still.Samples);
    }

    // ---------------------------------------------------------------------------------------
    // Input validation, which is model validation rather than a guard in the controller
    // ---------------------------------------------------------------------------------------

    private static List<string> Problems(PlaythroughInputDto input) =>
        input.Validate(new System.ComponentModel.DataAnnotations.ValidationContext(input))
            .Select(result => result.ErrorMessage ?? string.Empty)
            .ToList();

    [Fact]
    public void Validate_FinishBeforeStart_IsRejected()
    {
        // A 400 next to the date field rather than a 500 out of
        // CK_UserGamePlaythroughs_Dates_Order. The constraint holds either way; this is about
        // which of the two the user sees.
        var problems = Problems(Input(
            startedOn: new DateOnly(2026, 5, 10), finishedOn: new DateOnly(2026, 5, 1)));

        Assert.Contains(problems, message => message.Contains("before the start date"));
    }

    [Fact]
    public void Validate_FinishOnTheStartDate_IsAccepted()
    {
        // A game finished the day it was started is ordinary, so the constraint is >= and not >.
        var problems = Problems(Input(
            startedOn: new DateOnly(2026, 5, 1), finishedOn: new DateOnly(2026, 5, 1)));

        Assert.Empty(problems);
    }

    [Fact]
    public void Validate_AnOpenRunWithNoFinish_IsAccepted()
    {
        Assert.Empty(Problems(Input(startedOn: new DateOnly(2026, 5, 1), finishedOn: null)));
    }
}
