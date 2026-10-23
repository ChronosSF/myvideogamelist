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

    private static IGameCacheService IgdbReturning(params GameDto[] games)
    {
        var igdb = Substitute.For<IGameCacheService>();
        igdb.GetGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(games);
        return igdb;
    }

    private static FavouriteService NewService(
        ApplicationDbContext db, IGameCacheService? igdb = null, TimeProvider? clock = null) =>
        new(db, igdb ?? Substitute.For<IGameCacheService>(), clock ?? new FixedClock(Midday));

    [Fact]
    public async Task AddAsync_NewGame_RecordsItWithTheCurrentTime()
    {
        using var db = NewDb();
        var service = NewService(db);

        var added = await service.AddAsync(UserId, 42);

        Assert.Equal(Midday, added.AddedAt);
        Assert.Null(added.Position);
        var favourite = db.UserFavourites.Single();
        Assert.Equal(42, favourite.GameId);
        Assert.Equal(Midday, favourite.AddedAt);
    }

    [Fact]
    public async Task AddAsync_AlreadyAFavourite_KeepsAndReturnsTheOriginalTimestamp()
    {
        // The favourites are shown newest first, so a second add must not move one to the front, and
        // it answers with the original time so that a second tab does not move it there either.
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        var service = NewService(db, clock: clock);

        await service.AddAsync(UserId, 42);
        clock.Advance(TimeSpan.FromDays(30));
        var addedAgain = await service.AddAsync(UserId, 42);

        Assert.Equal(Midday, addedAgain.AddedAt);
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
    public async Task GetFavouritesAsync_TwoMadeAtOnce_OrdersThemByGameId()
    {
        // As the wishlist does: two rows can share a timestamp, and the order has to be the same
        // one on every read for the client to be able to keep it.
        using var db = NewDb();
        var service = NewService(db, IgdbReturning(Game(1, "Celeste"), Game(2, "Hades")));

        await service.AddAsync(UserId, 2);
        await service.AddAsync(UserId, 1);

        var favourites = await service.GetFavouritesAsync(UserId);

        Assert.Equal(["Celeste", "Hades"], favourites.Select(f => f.Game.Title));
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
        var igdb = Substitute.For<IGameCacheService>();

        Assert.Empty(await NewService(db, igdb).GetFavouritesAsync(UserId));
        await igdb.DidNotReceive().GetGamesAsync(
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

    // ── The showcase's hand order (ADR 0054, ADR 0064) ──────────────────────────────────

    /// <summary>Four favourites, made a day apart: Celeste first and Inside last.</summary>
    private static async Task<FavouriteService> FourFavouritesAsync(ApplicationDbContext db)
    {
        var clock = new FixedClock(Midday);
        var service = NewService(
            db,
            IgdbReturning(Game(1, "Celeste"), Game(2, "Hades"), Game(3, "Tunic"), Game(4, "Inside")),
            clock);

        foreach (var gameId in new[] { 1, 2, 3, 4 })
        {
            await service.AddAsync(UserId, gameId);
            clock.Advance(TimeSpan.FromDays(1));
        }
        return service;
    }

    private static int? PositionOf(ApplicationDbContext db, int gameId, string userId = UserId) =>
        db.UserFavourites.AsNoTracking().Single(f => f.UserId == userId && f.GameId == gameId).Position;

    [Fact]
    public async Task GetFavouritesAsync_SomePlacedByHand_ReturnsThemFirstByPositionThenTheRestMostRecentFirst()
    {
        // The two the owner placed lead, in their order and against their dates — Celeste is the oldest
        // and Inside the newest — and the two never placed follow as every favourite did before there
        // was an order, newest first.
        using var db = NewDb();
        var service = await FourFavouritesAsync(db);
        await service.SetPositionsAsync(UserId, [new PositionDto(4, 2048), new PositionDto(1, -1024)]);

        var favourites = await service.GetFavouritesAsync(UserId);

        Assert.Equal(["Celeste", "Inside", "Tunic", "Hades"], favourites.Select(f => f.Game.Title));
        Assert.Equal([-1024, 2048, null, null], favourites.Select(f => f.Position));
    }

    [Fact]
    public async Task GetFavouritesAsync_TwoAtOnePosition_AreOrderedTheSameWayEveryTime()
    {
        // Two tabs can give two favourites one number. The newer leads, as it does among the unplaced,
        // so the order is the same on every read and the client plans its next move against the order
        // it was shown.
        using var db = NewDb();
        var service = await FourFavouritesAsync(db);
        await service.SetPositionsAsync(UserId, [new PositionDto(1, 0), new PositionDto(2, 0)]);

        var favourites = await service.GetFavouritesAsync(UserId);

        Assert.Equal(["Hades", "Celeste", "Inside", "Tunic"], favourites.Select(f => f.Game.Title));
    }

    [Fact]
    public async Task SetPositionsAsync_SomeFavouritesNamed_PlacesThoseAndNoOthers()
    {
        using var db = NewDb();
        var service = await FourFavouritesAsync(db);
        await service.SetPositionsAsync(UserId, [new PositionDto(1, 1024), new PositionDto(2, 2048)]);

        await service.SetPositionsAsync(UserId, [new PositionDto(2, 512)]);

        Assert.Equal(1024, PositionOf(db, 1));
        Assert.Equal(512, PositionOf(db, 2));
        Assert.Null(PositionOf(db, 3));
        Assert.Null(PositionOf(db, 4));
    }

    [Fact]
    public async Task SetPositionsAsync_AGameThatIsNotAFavourite_IsPassedOverAndMakesNoRow()
    {
        // A tab that still shows a favourite another tab has taken off names it in a move. A place in
        // the showcase is not a reason for the game to be back in it.
        using var db = NewDb();
        var service = await FourFavouritesAsync(db);
        await service.RemoveAsync(UserId, 4);

        await service.SetPositionsAsync(UserId, [new PositionDto(1, 1024), new PositionDto(4, 2048)]);

        Assert.Equal(1024, PositionOf(db, 1));
        Assert.Equal([1, 2, 3], db.UserFavourites.Select(f => f.GameId).Order());
    }

    [Fact]
    public async Task SetPositionsAsync_TheSameGameAmongAnotherUsersFavourites_LeavesTheirsAlone()
    {
        // The same game among somebody else's favourites. The user is in the store's predicate, not
        // taken on trust from anything the request says.
        using var db = NewDb();
        var service = NewService(db);
        await service.AddAsync(UserId, 42);
        await service.AddAsync(OtherUserId, 42);
        await service.SetPositionsAsync(OtherUserId, [new PositionDto(42, 4096)]);

        await service.SetPositionsAsync(UserId, [new PositionDto(42, 1024)]);

        Assert.Equal(1024, PositionOf(db, 42));
        Assert.Equal(4096, PositionOf(db, 42, OtherUserId));
    }

    [Fact]
    public async Task SetPositionsAsync_AGameAlsoInTheBacklogAndOnTheWishlist_TouchesOnlyTheFavourite()
    {
        // The same game holds a place in the backlog's own order and sits on the wishlist. A place in
        // the showcase is a column of the favourite and of nothing else, and it records no event.
        using var db = NewDb();
        var service = await FourFavouritesAsync(db);
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = UserId,
            GameId = 1,
            StatusId = db.ListStatuses.Single(s => s.Key == ListStatusKeys.Backlog).Id,
            Position = 4096,
            AddedAt = Midday
        });
        db.UserWishlistItems.Add(new UserWishlistItem { UserId = UserId, GameId = 1, AddedAt = Midday });
        await db.SaveChangesAsync();

        await service.SetPositionsAsync(UserId, [new PositionDto(1, 1024)]);

        Assert.Equal(1024, PositionOf(db, 1));
        Assert.Equal(4096, db.UserGameEntries.AsNoTracking().Single(e => e.GameId == 1).Position);
        Assert.Single(db.UserWishlistItems.AsNoTracking());
        Assert.Empty(db.UserGameEvents);
    }

    [Fact]
    public async Task AddAsync_AlreadyAFavourite_KeepsItsPlace()
    {
        // The idempotent add is a no-op all the way down: a second click on the panel's rosette must
        // not send a placed favourite back among the unplaced.
        using var db = NewDb();
        var service = NewService(db);
        await service.AddAsync(UserId, 42);
        await service.SetPositionsAsync(UserId, [new PositionDto(42, 1024)]);

        await service.AddAsync(UserId, 42);

        Assert.Equal(1024, PositionOf(db, 42));
    }

    [Fact]
    public async Task AddAsync_AlreadyAFavouritePlacedByAnotherTab_AnswersWithItsPlace()
    {
        // A tab that has not seen the favourite asks to make it one. It learns when the game really
        // became one, and where it already stands, so that it files it there rather than among the
        // unplaced (ADR 0029 §1, ADR 0064).
        using var db = NewDb();
        var service = NewService(db);
        await service.AddAsync(UserId, 42);
        await service.SetPositionsAsync(UserId, [new PositionDto(42, -2048)]);

        var added = await service.AddAsync(UserId, 42);

        Assert.Equal(Midday, added.AddedAt);
        Assert.Equal(-2048, added.Position);
    }

    [Fact]
    public async Task AddAsync_AFavouriteMadeAgainAfterItWasTakenOff_ArrivesUnplaced()
    {
        // Taking a game off the favourites deletes its row, and its place goes with the row: made a
        // favourite again, it arrives as any new favourite does.
        using var db = NewDb();
        var service = NewService(db);
        await service.AddAsync(UserId, 42);
        await service.SetPositionsAsync(UserId, [new PositionDto(42, 1024)]);

        await service.RemoveAsync(UserId, 42);
        await service.AddAsync(UserId, 42);

        Assert.Null(PositionOf(db, 42));
    }
}
