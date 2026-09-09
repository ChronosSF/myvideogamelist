using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What a review promises: one per game, belonging to one account, recording no history, and
/// pointing only at a playthrough its author actually owns.
/// </summary>
public class ReviewServiceTests
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

    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static ReviewService NewService(ApplicationDbContext db, TimeProvider? clock = null) =>
        new(db, clock ?? new FixedClock(Midday));

    private static PlaythroughService NewPlaythroughs(ApplicationDbContext db) =>
        new(db, new MemoryCache(new MemoryCacheOptions()), new FixedClock(Midday));

    private static ReviewInputDto Input(
        string body = "Worth every hour.",
        bool hasSpoilers = false,
        string visibility = ReviewVisibility.Private,
        int? playthroughId = null) =>
        new(body, hasSpoilers, visibility, playthroughId);

    // ---------------------------------------------------------------------------------------
    // Scoping
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task GetAsync_AnotherUsersReview_IsNotReturned()
    {
        using var db = NewDb();
        await NewService(db).UpsertAsync(OtherUserId, GameId, Input());

        Assert.Null(await NewService(db).GetAsync(UserId, GameId));
    }

    [Fact]
    public async Task UpsertAsync_WhenAnotherUserHasOne_WritesItsOwnRatherThanOverwriting()
    {
        // The unique index is per entry, and each account has its own entry for the game.
        using var db = NewDb();
        await NewService(db).UpsertAsync(OtherUserId, GameId, Input("Theirs"));

        await NewService(db).UpsertAsync(UserId, GameId, Input("Mine"));

        Assert.Equal(2, db.Reviews.Count());
        Assert.Equal("Mine", (await NewService(db).GetAsync(UserId, GameId))!.Body);
    }

    [Fact]
    public async Task DeleteAsync_AnotherUsersReview_ReportsNothingRemovedAndLeavesItAlone()
    {
        using var db = NewDb();
        await NewService(db).UpsertAsync(OtherUserId, GameId, Input());

        Assert.False(await NewService(db).DeleteAsync(UserId, GameId));
        Assert.Single(db.Reviews);
    }

    [Fact]
    public async Task GetAsync_AnotherGamesReview_IsNotReturned()
    {
        using var db = NewDb();
        await NewService(db).UpsertAsync(UserId, 99, Input());

        Assert.Null(await NewService(db).GetAsync(UserId, GameId));
    }

    // ---------------------------------------------------------------------------------------
    // Writing
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task UpsertAsync_GameWithNothingRecorded_CreatesTheEntryWithNoStatus()
    {
        using var db = NewDb();

        await NewService(db).UpsertAsync(UserId, GameId, Input());

        var entry = db.UserGameEntries.Single();
        Assert.Equal(GameId, entry.GameId);
        Assert.Null(entry.StatusId);
    }

    [Fact]
    public async Task UpsertAsync_WritesNoEvent()
    {
        // Writing about a game is not a status transition, and the log stays typed and narrow.
        using var db = NewDb();

        await NewService(db).UpsertAsync(UserId, GameId, Input());

        Assert.Empty(db.UserGameEvents);
    }

    [Fact]
    public async Task UpsertAsync_GameAlreadyInAList_LeavesTheStatusAlone()
    {
        using var db = NewDb();
        var lists = new ListService(db, Substitute.For<IIgdbService>(), new FixedClock(Midday));
        await lists.SetListEntryAsync(UserId, GameId, ListStatusKeys.Finished);

        await NewService(db).UpsertAsync(UserId, GameId, Input());

        var finished = db.ListStatuses.Single(s => s.Key == ListStatusKeys.Finished).Id;
        Assert.Equal(finished, db.UserGameEntries.Single().StatusId);
    }

    [Fact]
    public async Task UpsertAsync_Twice_RewritesTheOneRowRatherThanAddingASecond()
    {
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        var service = NewService(db, clock);

        var first = await service.UpsertAsync(UserId, GameId, Input("First thoughts."));
        clock.Advance(TimeSpan.FromDays(7));
        var second = await service.UpsertAsync(
            UserId, GameId, Input("Second thoughts.", hasSpoilers: true, visibility: ReviewVisibility.Public));

        Assert.Single(db.Reviews);
        Assert.Equal(first.Id, second.Id);
        Assert.Equal("Second thoughts.", second.Body);
        Assert.True(second.HasSpoilers);
        Assert.Equal(ReviewVisibility.Public, second.Visibility);

        // Created once, updated twice.
        Assert.Equal(Midday, second.CreatedAt);
        Assert.Equal(Midday.AddDays(7), second.UpdatedAt);
    }

    [Fact]
    public async Task UpsertAsync_OwnPlaythrough_IsRecordedAsTheSubject()
    {
        using var db = NewDb();
        var run = await NewPlaythroughs(db).AddAsync(
            UserId, GameId, new PlaythroughInputDto(PlaythroughTypeKeys.Normally, 6, 600, null, null, null));

        var review = await NewService(db).UpsertAsync(UserId, GameId, Input(playthroughId: run.Id));

        Assert.Equal(run.Id, review.PlaythroughId);
    }

    [Fact]
    public async Task UpsertAsync_AnotherUsersPlaythrough_IsRejected()
    {
        // A foreign key alone would accept it — the pointer is not covered by the composite key
        // that guards the entry — so the service checks ownership itself.
        using var db = NewDb();
        var theirs = await NewPlaythroughs(db).AddAsync(
            OtherUserId, GameId, new PlaythroughInputDto(null, null, null, null, null, null));

        await Assert.ThrowsAsync<ArgumentException>(
            () => NewService(db).UpsertAsync(UserId, GameId, Input(playthroughId: theirs.Id)));

        Assert.Empty(db.Reviews);
    }

    [Fact]
    public async Task UpsertAsync_OwnPlaythroughOfADifferentGame_IsRejected()
    {
        using var db = NewDb();
        var elsewhere = await NewPlaythroughs(db).AddAsync(
            UserId, 99, new PlaythroughInputDto(null, null, null, null, null, null));

        await Assert.ThrowsAsync<ArgumentException>(
            () => NewService(db).UpsertAsync(UserId, GameId, Input(playthroughId: elsewhere.Id)));
    }

    [Fact]
    public async Task UpsertAsync_NoPlaythroughNamed_StoresNoPointer()
    {
        // The common case: a review is usually about the game, not about one run through it.
        using var db = NewDb();

        var review = await NewService(db).UpsertAsync(UserId, GameId, Input(playthroughId: null));

        Assert.Null(review.PlaythroughId);
    }

    // ---------------------------------------------------------------------------------------
    // Deleting
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task DeleteAsync_OwnReview_RemovesItAndKeepsEverythingElse()
    {
        // Deleting what you wrote about a game is not deleting your record of it.
        using var db = NewDb();
        await NewPlaythroughs(db).AddAsync(
            UserId, GameId, new PlaythroughInputDto(null, null, null, null, null, null));
        await NewService(db).UpsertAsync(UserId, GameId, Input());

        Assert.True(await NewService(db).DeleteAsync(UserId, GameId));

        Assert.Empty(db.Reviews);
        Assert.Single(db.UserGameEntries);
        Assert.Single(db.UserGamePlaythroughs);
        Assert.Empty(db.UserGameEvents);
    }

    [Fact]
    public async Task DeleteAsync_NothingWritten_ReportsNothingRemoved()
    {
        using var db = NewDb();

        Assert.False(await NewService(db).DeleteAsync(UserId, GameId));
    }
}
