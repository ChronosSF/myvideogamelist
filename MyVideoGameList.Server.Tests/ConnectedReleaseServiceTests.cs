using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Releases;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The service around the rules: which of a user's games make their set, and when IGDB is asked again.
/// </summary>
public class ConnectedReleaseServiceTests
{
    private const string UserId = "user-1";

    private static readonly DateOnly From = new(2026, 9, 29);
    private static readonly DateOnly To = new(2026, 10, 13);

    private static readonly CalendarGame WitcherIii =
        new(1942, "The Witcher 3: Wild Hunt", null, IgdbGameTypes.MainGame, null, null, [new SeriesRef(62, "The Witcher")]);

    private static readonly CalendarGame WitcherIiiRemastered =
        new(415005, "The Witcher 3: Wild Hunt Remastered", "https://images.igdb.com/igdb/image/upload/t_cover_big/x.jpg",
            IgdbGameTypes.Remaster, 1942, null, [new SeriesRef(62, "The Witcher")]);

    private static readonly ReleaseRow RemasteredOnSwitch2 = new(
        957250, 415005, new DateOnly(2026, 9, 29), 0, 2026, 9, new PlatformDto(508, "Nintendo Switch 2", "Switch 2", null, null), 6);

    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

        // The statuses are seeded by the model, and the set reads them through the entry's navigation.
        db.Database.EnsureCreated();
        return db;
    }

    private static short StatusId(ApplicationDbContext db, string key) =>
        db.ListStatuses.Single(s => s.Key == key).Id;

    private static void Track(ApplicationDbContext db, int gameId, string? statusKey, string userId = UserId) =>
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            StatusId = statusKey is null ? null : StatusId(db, statusKey),
        });

    /// <summary>An IGDB that knows the Witcher 3 and its remaster, and counts what it is asked.</summary>
    private static IIgdbService Igdb(bool truncated = false)
    {
        var igdb = Substitute.For<IIgdbService>();
        var known = new[] { WitcherIii, WitcherIiiRemastered }.ToDictionary(g => g.Id);

        igdb.GetCalendarGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult<IReadOnlyDictionary<int, CalendarGame>>(
                call.Arg<IEnumerable<int>>().Where(known.ContainsKey).ToDictionary(id => id, id => known[id])));

        igdb.GetConnectedReleaseRowsAsync(
                Arg.Any<IReadOnlyCollection<int>>(), Arg.Any<IReadOnlyCollection<int>>(),
                Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<bool>(), Arg.Any<CancellationToken>())
            .Returns(new ConnectedReleaseRows([RemasteredOnSwitch2], truncated));

        return igdb;
    }

    private static ConnectedReleaseService NewService(ApplicationDbContext db, IIgdbService igdb, IMemoryCache? cache = null) =>
        new(db, igdb, cache ?? new MemoryCache(new MemoryCacheOptions()));

    private static Task RowQueries(IIgdbService igdb, int count) =>
        igdb.Received(count).GetConnectedReleaseRowsAsync(
            Arg.Any<IReadOnlyCollection<int>>(), Arg.Any<IReadOnlyCollection<int>>(),
            Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<bool>(), Arg.Any<CancellationToken>());

    [Fact]
    public async Task ReadSetAsync_LeavesOutDroppedAndWhatHasLeftEveryList()
    {
        using var db = NewDb();
        Track(db, 1, ListStatusKeys.Backlog);
        Track(db, 2, ListStatusKeys.Dropped);
        Track(db, 3, statusKey: null);
        Track(db, 4, ListStatusKeys.Finished, userId: "somebody-else");
        await db.SaveChangesAsync();

        var set = await NewService(db, Igdb()).ReadSetAsync(UserId, CancellationToken.None);

        Assert.Equal([1], set.Keys);
        Assert.Equal(new SetMember(1, SetMembership.List, ListStatusKeys.Backlog), set[1]);
    }

    [Fact]
    public async Task ReadSetAsync_HoldsEachGameUnderItsStrongestMembership()
    {
        using var db = NewDb();
        Track(db, 1, ListStatusKeys.Playing);
        Track(db, 2, ListStatusKeys.Finished);
        db.UserFavourites.Add(new UserFavourite { UserId = UserId, GameId = 1 });
        db.UserWishlistItems.Add(new UserWishlistItem { UserId = UserId, GameId = 2 });
        db.UserWishlistItems.Add(new UserWishlistItem { UserId = UserId, GameId = 3 });
        await db.SaveChangesAsync();

        var set = await NewService(db, Igdb()).ReadSetAsync(UserId, CancellationToken.None);

        Assert.Equal(SetMembership.Favourite, set[1].Membership);
        Assert.Equal(SetMembership.Wishlist, set[2].Membership);
        Assert.Equal(SetMembership.Wishlist, set[3].Membership);
    }

    [Fact]
    public async Task GetAsync_WithNothingTracked_AsksIgdbNothing()
    {
        using var db = NewDb();
        var igdb = Igdb();

        Assert.Empty(await NewService(db, igdb).GetAsync(UserId, From, To, withPeriods: false));
        await RowQueries(igdb, 0);
    }

    [Fact]
    public async Task GetAsync_SaysWhatIsComingAndWhy_InTheApisWords()
    {
        using var db = NewDb();
        db.UserFavourites.Add(new UserFavourite { UserId = UserId, GameId = 1942 });
        await db.SaveChangesAsync();

        var entry = Assert.Single(await NewService(db, Igdb()).GetAsync(UserId, From, To, withPeriods: false));

        Assert.Equal("day", entry.Precision);
        Assert.Equal(new DateOnly(2026, 9, 29), entry.Starts);
        var release = Assert.Single(entry.Releases);
        Assert.Equal("remaster", release.Kind);
        Assert.Equal(new ReleaseReasonDto("child", 1942, "The Witcher 3: Wild Hunt", "favourite", null, null), release.Reason);
    }

    [Fact]
    public async Task GetAsync_TheSameSetAgain_IsAnsweredFromMemory()
    {
        using var db = NewDb();
        db.UserFavourites.Add(new UserFavourite { UserId = UserId, GameId = 1942 });
        await db.SaveChangesAsync();
        var igdb = Igdb();
        var service = NewService(db, igdb);

        await service.GetAsync(UserId, From, To, withPeriods: false);
        await service.GetAsync(UserId, From, To, withPeriods: false);

        await RowQueries(igdb, 1);
    }

    [Fact]
    public async Task GetAsync_AMembershipChanging_ChangesTheReasonWithoutAskingIgdbAgain()
    {
        // What is kept is IGDB's answer, not the entries: moving a game between the favourites and a
        // list changes why a release is shown, and not which rows there are.
        using var db = NewDb();
        db.UserFavourites.Add(new UserFavourite { UserId = UserId, GameId = 1942 });
        Track(db, 1942, ListStatusKeys.Finished);
        await db.SaveChangesAsync();
        var igdb = Igdb();
        var service = NewService(db, igdb);

        await service.GetAsync(UserId, From, To, withPeriods: false);
        db.UserFavourites.RemoveRange(db.UserFavourites);
        await db.SaveChangesAsync();
        var after = await service.GetAsync(UserId, From, To, withPeriods: false);

        Assert.Equal("list", Assert.Single(Assert.Single(after).Releases).Reason.Membership);
        await RowQueries(igdb, 1);
    }

    [Fact]
    public async Task GetAsync_AGameAddedToTheSet_AsksIgdbAgainAtOnce()
    {
        using var db = NewDb();
        db.UserFavourites.Add(new UserFavourite { UserId = UserId, GameId = 1942 });
        await db.SaveChangesAsync();
        var igdb = Igdb();
        var service = NewService(db, igdb);

        await service.GetAsync(UserId, From, To, withPeriods: false);
        db.UserWishlistItems.Add(new UserWishlistItem { UserId = UserId, GameId = 5 });
        await db.SaveChangesAsync();
        await service.GetAsync(UserId, From, To, withPeriods: false);

        await RowQueries(igdb, 2);
    }

    [Fact]
    public async Task GetAsync_TwoPeopleWithTheSameGames_ShareOneAnswer()
    {
        using var db = NewDb();
        db.UserFavourites.Add(new UserFavourite { UserId = UserId, GameId = 1942 });
        Track(db, 1942, ListStatusKeys.Backlog, userId: "user-2");
        await db.SaveChangesAsync();
        var igdb = Igdb();
        var service = NewService(db, igdb);

        await service.GetAsync(UserId, From, To, withPeriods: false);
        await service.GetAsync("user-2", From, To, withPeriods: false);

        await RowQueries(igdb, 1);
    }

    [Fact]
    public async Task GetAsync_APartialAnswer_IsNotKept()
    {
        // §8.1: an answer cut short by the page ceiling is used once and asked for again next time.
        using var db = NewDb();
        db.UserFavourites.Add(new UserFavourite { UserId = UserId, GameId = 1942 });
        await db.SaveChangesAsync();
        var igdb = Igdb(truncated: true);
        var service = NewService(db, igdb);

        await service.GetAsync(UserId, From, To, withPeriods: false);
        await service.GetAsync(UserId, From, To, withPeriods: false);

        await RowQueries(igdb, 2);
    }

    [Fact]
    public async Task GetAsync_AnEdition_FetchesTheGamesItIsAnEditionOf()
    {
        // F3 can only fold what it has been told about: the 10th Anniversary Edition's row needs the
        // Complete Edition, and that needs the game.
        using var db = NewDb();
        db.UserFavourites.Add(new UserFavourite { UserId = UserId, GameId = 1942 });
        await db.SaveChangesAsync();

        var tenth = new CalendarGame(372654, "The Witcher 3: Wild Hunt - Complete Edition: 10th Anniversary Edition", null, IgdbGameTypes.MainGame, null, 119402, []);
        var complete = new CalendarGame(119402, "The Witcher 3: Wild Hunt - Complete Edition", null, IgdbGameTypes.Bundle, null, 1942, []);
        var known = new[] { WitcherIii, tenth, complete }.ToDictionary(g => g.Id);
        var asked = new List<int[]>();

        var igdb = Substitute.For<IIgdbService>();
        igdb.GetCalendarGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                var ids = call.Arg<IEnumerable<int>>().ToArray();
                asked.Add(ids);
                return Task.FromResult<IReadOnlyDictionary<int, CalendarGame>>(ids.Where(known.ContainsKey).ToDictionary(id => id, id => known[id]));
            });
        igdb.GetConnectedReleaseRowsAsync(
                Arg.Any<IReadOnlyCollection<int>>(), Arg.Any<IReadOnlyCollection<int>>(),
                Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<bool>(), Arg.Any<CancellationToken>())
            .Returns(new ConnectedReleaseRows([RemasteredOnSwitch2 with { Id = 1, GameId = 372654 }], false));

        var entry = Assert.Single(await NewService(db, igdb).GetAsync(UserId, From, To, withPeriods: false));

        Assert.Equal([[1942], [372654], [119402]], asked);
        Assert.Equal("The Witcher 3: Wild Hunt", Assert.Single(entry.Releases).Title);
    }

    [Fact]
    public async Task GetAsync_DlcForAGameOutsideTheSet_FetchesThatGameToNameTheirGroup()
    {
        // F6 groups DLC for one game on one day under that game's name, and the game need not be in the set:
        // somebody can wishlist both of Street Fighter 6's Arjun DLC without it. As recorded on 2026-09-29,
        // both are due on 13 October 2026 on Switch 2 and PC, and neither is in a series.
        using var db = NewDb();
        db.UserWishlistItems.Add(new UserWishlistItem { UserId = UserId, GameId = 404718 });
        db.UserWishlistItems.Add(new UserWishlistItem { UserId = UserId, GameId = 407142 });
        await db.SaveChangesAsync();

        var known = new CalendarGame[]
        {
            new(191692, "Street Fighter 6", null, IgdbGameTypes.MainGame, null, null, [new SeriesRef(219, "Street Fighter")]),
            new(404718, "Street Fighter 6: Year 4 - Arjun", null, IgdbGameTypes.Dlc, 191692, null, []),
            new(407142, "Street Fighter 6: Additional Character - Arjun & Outfit 2", null, IgdbGameTypes.Dlc, 191692, null, []),
        }.ToDictionary(g => g.Id);
        var day = new DateOnly(2026, 10, 13);
        var switch2 = new PlatformDto(508, "Nintendo Switch 2", "Switch 2", null, null);
        var pc = new PlatformDto(6, "PC (Microsoft Windows)", "PC", null, null);

        var igdb = Substitute.For<IIgdbService>();
        igdb.GetCalendarGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult<IReadOnlyDictionary<int, CalendarGame>>(
                call.Arg<IEnumerable<int>>().Where(known.ContainsKey).ToDictionary(id => id, id => known[id])));
        igdb.GetConnectedReleaseRowsAsync(
                Arg.Any<IReadOnlyCollection<int>>(), Arg.Any<IReadOnlyCollection<int>>(),
                Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<bool>(), Arg.Any<CancellationToken>())
            .Returns(new ConnectedReleaseRows(
            [
                new(962456, 404718, day, 0, 2026, 10, switch2, 6),
                new(962457, 404718, day, 0, 2026, 10, pc, 6),
                new(963709, 407142, day, 0, 2026, 10, switch2, 6),
                new(963710, 407142, day, 0, 2026, 10, pc, 6),
            ], false));

        var entry = Assert.Single(await NewService(db, igdb).GetAsync(UserId, day, day.AddDays(1), withPeriods: false));

        Assert.Equal("Street Fighter 6", entry.GroupName);
        Assert.Equal(2, entry.Releases.Count);
    }
}
