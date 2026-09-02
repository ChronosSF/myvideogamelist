using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

public class WishlistServiceTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";

    /// <summary>A controllable clock, so the wishlist ordering can be asserted rather than raced.</summary>
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);

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

    private static WishlistService NewService(
        ApplicationDbContext db, IIgdbService? igdb = null, TimeProvider? clock = null) =>
        new(db, igdb ?? Substitute.For<IIgdbService>(), clock ?? new FixedClock(Midday));

    [Fact]
    public async Task AddAsync_NewGame_RecordsItWithTheCurrentTime()
    {
        using var db = NewDb();
        var service = NewService(db);

        var added = await service.AddAsync(UserId, 42);

        Assert.True(added);
        var item = db.UserWishlistItems.Single();
        Assert.Equal(42, item.GameId);
        Assert.Equal(Midday, item.AddedAt);
    }

    [Fact]
    public async Task AddAsync_AlreadyWishlisted_KeepsTheOriginalTimestamp()
    {
        // The wishlist is ordered by when someone started wanting a game, so a second add must
        // not bump it to the top.
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        var service = NewService(db, clock: clock);

        await service.AddAsync(UserId, 42);
        clock.Advance(TimeSpan.FromDays(30));
        var addedAgain = await service.AddAsync(UserId, 42);

        Assert.False(addedAgain);
        Assert.Equal(Midday, db.UserWishlistItems.Single().AddedAt);
    }

    [Fact]
    public async Task AddAsync_RecordsNoStatusEvent()
    {
        // A wishlist change is not a status transition. The event log is typed and narrow so that
        // every statistic derived from it can assume one shape — see data-model-plan decision 7.
        using var db = NewDb();
        var service = NewService(db);

        await service.AddAsync(UserId, 42);

        Assert.Empty(db.UserGameEvents);
    }

    [Fact]
    public async Task AddAsync_LeavesTheUsersEntryAlone()
    {
        // Wanting a game and tracking it are separate axes. Wishlisting must not create an entry,
        // touch a status or clear a score.
        using var db = NewDb();
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = UserId,
            GameId = 42,
            Score = 8,
            StatusId = db.ListStatuses.Single(s => s.Key == ListStatusKeys.Playing).Id,
            AddedAt = Midday
        });
        await db.SaveChangesAsync();
        var service = NewService(db);

        await service.AddAsync(UserId, 42);

        var entry = db.UserGameEntries.Single();
        Assert.Equal((short)8, entry.Score);
        Assert.NotNull(entry.StatusId);
    }

    [Fact]
    public async Task RemoveAsync_Wishlisted_RemovesIt()
    {
        using var db = NewDb();
        var service = NewService(db);
        await service.AddAsync(UserId, 42);

        var removed = await service.RemoveAsync(UserId, 42);

        Assert.True(removed);
        Assert.Empty(db.UserWishlistItems);
    }

    [Fact]
    public async Task RemoveAsync_NotWishlisted_ReturnsFalse()
    {
        using var db = NewDb();
        var service = NewService(db);

        Assert.False(await service.RemoveAsync(UserId, 42));
    }

    [Fact]
    public async Task RemoveAsync_LeavesTheUsersEntryAlone()
    {
        using var db = NewDb();
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = UserId,
            GameId = 42,
            Score = 8,
            AddedAt = Midday
        });
        await db.SaveChangesAsync();
        var service = NewService(db);
        await service.AddAsync(UserId, 42);

        await service.RemoveAsync(UserId, 42);

        Assert.Equal((short)8, db.UserGameEntries.Single().Score);
    }

    [Fact]
    public async Task GetWishlistAsync_ReturnsMostRecentlyWantedFirst()
    {
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        var service = NewService(db, IgdbReturning(Game(1, "Celeste"), Game(2, "Hades")), clock);

        await service.AddAsync(UserId, 1);
        clock.Advance(TimeSpan.FromDays(1));
        await service.AddAsync(UserId, 2);

        var wishlist = await service.GetWishlistAsync(UserId);

        Assert.Equal(["Hades", "Celeste"], wishlist.Select(w => w.Game.Title));
    }

    [Fact]
    public async Task GetWishlistAsync_SkipsGamesIgdbCannotResolve()
    {
        // The row stays — the id is still the user's data and IGDB gaps have been transient
        // before — but a game with no metadata is not rendered as a hole.
        using var db = NewDb();
        var service = NewService(db, IgdbReturning(Game(1, "Celeste")));
        await service.AddAsync(UserId, 1);
        await service.AddAsync(UserId, 999);

        var wishlist = await service.GetWishlistAsync(UserId);

        Assert.Single(wishlist);
        Assert.Equal("Celeste", wishlist[0].Game.Title);
        Assert.Equal(2, db.UserWishlistItems.Count());
    }

    [Fact]
    public async Task GetWishlistAsync_NoItems_ReturnsEmptyWithoutCallingIgdb()
    {
        using var db = NewDb();
        var igdb = Substitute.For<IIgdbService>();
        var service = NewService(db, igdb);

        Assert.Empty(await service.GetWishlistAsync(UserId));
        await igdb.DidNotReceive().GetGamesByIdsAsync(
            Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetWishlistAsync_ReturnsOnlyTheUsersOwnItems()
    {
        // The userId in the predicate is the authorization boundary, not a filter for tidiness.
        using var db = NewDb();
        var service = NewService(db, IgdbReturning(Game(1, "Celeste"), Game(2, "Hades")));
        await service.AddAsync(UserId, 1);
        await service.AddAsync(OtherUserId, 2);

        var wishlist = await service.GetWishlistAsync(UserId);

        Assert.Single(wishlist);
        Assert.Equal("Celeste", wishlist[0].Game.Title);
    }

    [Fact]
    public async Task AddAsync_SameGameForTwoUsers_IsTwoRows()
    {
        using var db = NewDb();
        var service = NewService(db);

        Assert.True(await service.AddAsync(UserId, 42));
        Assert.True(await service.AddAsync(OtherUserId, 42));

        Assert.Equal(2, db.UserWishlistItems.Count());
    }
}
