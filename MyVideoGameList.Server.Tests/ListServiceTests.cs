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

    private static ApplicationDbContext NewDb() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

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

    [Fact]
    public async Task GetListsAsync_WithNoEntries_ReturnsEmptyListsWithoutCallingIgdb()
    {
        using var db = NewDb();
        var igdb = Substitute.For<IIgdbService>();
        var service = new ListService(db, igdb);

        var result = await service.GetListsAsync(UserId);

        Assert.Empty(result.Playing);
        Assert.Empty(result.Backlog);
        Assert.Empty(result.Finished);
        await igdb.DidNotReceive()
            .GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task SetListEntryAsync_AddsNewEntry()
    {
        using var db = NewDb();
        var service = new ListService(db, IgdbReturning(Game(10)));

        await service.SetListEntryAsync(UserId, 10, "playing");

        var lists = await service.GetListsAsync(UserId);
        Assert.Single(lists.Playing);
        Assert.Equal(10, lists.Playing.Single().Id);
    }

    [Fact]
    public async Task SetListEntryAsync_CalledTwice_MovesRatherThanDuplicates()
    {
        using var db = NewDb();
        var service = new ListService(db, IgdbReturning(Game(10)));

        await service.SetListEntryAsync(UserId, 10, "playing");
        await service.SetListEntryAsync(UserId, 10, "finished");

        Assert.Equal(1, await db.UserGameLists.CountAsync());

        var lists = await service.GetListsAsync(UserId);
        Assert.Empty(lists.Playing);
        Assert.Single(lists.Finished);
    }

    [Fact]
    public async Task SetListEntryAsync_WithInvalidListType_Throws()
    {
        using var db = NewDb();
        var service = new ListService(db, Substitute.For<IIgdbService>());

        await Assert.ThrowsAsync<ArgumentException>(
            () => service.SetListEntryAsync(UserId, 10, "wishlist"));
    }

    [Fact]
    public async Task RemoveListEntryAsync_ReturnsFalseWhenAbsent()
    {
        using var db = NewDb();
        var service = new ListService(db, Substitute.For<IIgdbService>());

        Assert.False(await service.RemoveListEntryAsync(UserId, 999));
    }

    [Fact]
    public async Task RemoveListEntryAsync_RemovesOnlyTheCallersEntry()
    {
        using var db = NewDb();
        var service = new ListService(db, IgdbReturning(Game(10)));

        await service.SetListEntryAsync(UserId, 10, "playing");
        await service.SetListEntryAsync("someone-else", 10, "playing");

        Assert.True(await service.RemoveListEntryAsync(UserId, 10));

        Assert.Empty((await service.GetListsAsync(UserId)).Playing);
        Assert.Single((await service.GetListsAsync("someone-else")).Playing);
    }

    [Fact]
    public async Task GetListsAsync_SkipsEntriesIgdbCannotResolve()
    {
        using var db = NewDb();
        // IGDB knows about 10 but not 11 — a stale or delisted ID must not produce a null hole.
        var service = new ListService(db, IgdbReturning(Game(10)));

        await service.SetListEntryAsync(UserId, 10, "backlog");
        db.UserGameLists.Add(new UserGameList { UserId = UserId, GameId = 11, ListType = "backlog" });
        await db.SaveChangesAsync();

        var lists = await service.GetListsAsync(UserId);

        Assert.Single(lists.Backlog);
        Assert.Equal(10, lists.Backlog.Single().Id);
    }

    [Theory]
    [InlineData("playing", true)]
    [InlineData("backlog", true)]
    [InlineData("finished", true)]
    [InlineData("Playing", false)]
    [InlineData("wishlist", false)]
    [InlineData("", false)]
    public void IsValidListType_AcceptsOnlyTheThreeKnownLists(string listType, bool expected)
        => Assert.Equal(expected, ListService.IsValidListType(listType));
}
