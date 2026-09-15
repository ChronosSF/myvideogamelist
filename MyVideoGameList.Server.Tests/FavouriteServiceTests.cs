using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Favourites are an axis like the wishlist: a membership and a timestamp, beside the status lists
/// and independent of them. See <c>docs/decisions/0029-favourites-are-an-axis-and-a-showcase.md</c>.
/// </summary>
public class FavouriteServiceTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";

    /// <summary>A controllable clock, so the ordering can be asserted rather than raced.</summary>
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    private static readonly DateTimeOffset Midday = new(2026, 9, 15, 12, 0, 0, TimeSpan.Zero);

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

    private static FavouriteService NewService(
        ApplicationDbContext db, IIgdbService? igdb = null, TimeProvider? clock = null) =>
        new(db, igdb ?? Substitute.For<IIgdbService>(), clock ?? new FixedClock(Midday));

    [Fact]
    public async Task AddAsync_NewGame_RecordsItWithTheCurrentTime()
    {
        using var db = NewDb();
        var service = NewService(db);

        var added = await service.AddAsync(UserId, 42);

        Assert.True(added);
        var favourite = db.UserFavourites.Single();
        Assert.Equal(42, favourite.GameId);
        Assert.Equal(Midday, favourite.AddedAt);
    }

    [Fact]
    public async Task AddAsync_AlreadyAFavourite_KeepsTheOriginalTimestamp()
    {
        // The favourites are shown newest first, so a second add must not move one to the front.
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        var service = NewService(db, clock: clock);

        await service.AddAsync(UserId, 42);
        clock.Advance(TimeSpan.FromDays(30));
        var addedAgain = await service.AddAsync(UserId, 42);

        Assert.False(addedAgain);
        Assert.Equal(Midday, db.UserFavourites.Single().AddedAt);
    }

    [Fact]
    public async Task AddAsync_RecordsNoStatusEventAndCreatesNoEntry()
    {
        // Loving a game is not a status transition, and it needs no entry: a favourite can be a game
        // finished years ago that was never tracked here.
        using var db = NewDb();
        var service = NewService(db);

        await service.AddAsync(UserId, 42);

        Assert.Empty(db.UserGameEvents);
        Assert.Empty(db.UserGameEntries);
    }

    [Fact]
    public async Task AddAsync_LeavesTheEntryAndTheWishlistAlone()
    {
        using var db = NewDb();
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = UserId,
            GameId = 42,
            Score = 7,
            StatusId = db.ListStatuses.Single(s => s.Key == ListStatusKeys.Dropped).Id,
            AddedAt = Midday
        });
        db.UserWishlistItems.Add(new UserWishlistItem { UserId = UserId, GameId = 42, AddedAt = Midday });
        await db.SaveChangesAsync();
        var service = NewService(db);

        await service.AddAsync(UserId, 42);
        await service.RemoveAsync(UserId, 42);

        var entry = db.UserGameEntries.Single();
        Assert.Equal((short)7, entry.Score);
        Assert.NotNull(entry.StatusId);
        Assert.Single(db.UserWishlistItems);
    }

    [Fact]
    public async Task RemoveAsync_AFavourite_RemovesIt()
    {
        using var db = NewDb();
        var service = NewService(db);
        await service.AddAsync(UserId, 42);

        Assert.True(await service.RemoveAsync(UserId, 42));
        Assert.Empty(db.UserFavourites);
    }

    [Fact]
    public async Task RemoveAsync_NotAFavourite_ReturnsFalse()
    {
        using var db = NewDb();

        Assert.False(await NewService(db).RemoveAsync(UserId, 42));
    }

    [Fact]
    public async Task RemoveAsync_AnotherUsersFavourite_IsNotTouched()
    {
        // The userId in the predicate is the authorization boundary, and GameAxisStore is where it
        // is written — this is what fails if that store ever stops scoping by it.
        using var db = NewDb();
        var service = NewService(db);
        await service.AddAsync(OtherUserId, 42);

        Assert.False(await service.RemoveAsync(UserId, 42));
        Assert.Single(db.UserFavourites);
    }

    [Fact]
    public async Task GetFavouritesAsync_ReturnsTheMostRecentFirst()
    {
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        var service = NewService(db, IgdbReturning(Game(1, "Celeste"), Game(2, "Hades")), clock);

        await service.AddAsync(UserId, 1);
        clock.Advance(TimeSpan.FromDays(1));
        await service.AddAsync(UserId, 2);

        var favourites = await service.GetFavouritesAsync(UserId);

        Assert.Equal(["Hades", "Celeste"], favourites.Select(f => f.Game.Title));
    }

    [Fact]
    public async Task GetFavouritesAsync_SkipsGamesIgdbCannotResolve()
    {
        // The row stays — the id is still the user's data — but a game with no metadata is not
        // rendered as a hole.
        using var db = NewDb();
        var service = NewService(db, IgdbReturning(Game(1, "Celeste")));
        await service.AddAsync(UserId, 1);
        await service.AddAsync(UserId, 999);

        var favourites = await service.GetFavouritesAsync(UserId);

        Assert.Equal("Celeste", Assert.Single(favourites).Game.Title);
        Assert.Equal(2, db.UserFavourites.Count());
    }

    [Fact]
    public async Task GetFavouritesAsync_NoFavourites_ReturnsEmptyWithoutCallingIgdb()
    {
        using var db = NewDb();
        var igdb = Substitute.For<IIgdbService>();

        Assert.Empty(await NewService(db, igdb).GetFavouritesAsync(UserId));
        await igdb.DidNotReceive().GetGamesByIdsAsync(
            Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetFavouritesAsync_ReturnsOnlyTheUsersOwn()
    {
        using var db = NewDb();
        var service = NewService(db, IgdbReturning(Game(1, "Celeste"), Game(2, "Hades")));
        await service.AddAsync(UserId, 1);
        await service.AddAsync(OtherUserId, 2);

        var favourites = await service.GetFavouritesAsync(UserId);

        Assert.Equal("Celeste", Assert.Single(favourites).Game.Title);
    }
}
