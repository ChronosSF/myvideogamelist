using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Which of the user's games are asked about, and in what order. The order is the substance: the
/// news aggregate keeps only the first dozen Steam-backed games it is given, so a game handed over
/// late is a game whose news never appears.
/// </summary>
public class TrackedNewsServiceTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";

    private static readonly DateTimeOffset Start = new(2026, 3, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// A context whose statuses are the real ones: <c>EnsureCreated</c> applies the context's own
    /// <c>HasData</c>, so the grouping reads the same flags and sort orders the migration seeds.
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

    /// <summary>An entry in a list, last moved <paramref name="daysIn"/> days after the start.</summary>
    private static void AddEntry(
        ApplicationDbContext db, int gameId, string? status, int daysIn = 0, string userId = UserId)
    {
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            StatusId = status is null ? null : db.ListStatuses.Single(s => s.Key == status).Id,
            AddedAt = Start,
            StatusChangedAt = status is null ? null : Start.AddDays(daysIn),
        });
        db.SaveChanges();
    }

    private static void AddWishlisted(ApplicationDbContext db, int gameId, int daysIn = 0, string userId = UserId)
    {
        db.UserWishlistItems.Add(new UserWishlistItem { UserId = userId, GameId = gameId, AddedAt = Start.AddDays(daysIn) });
        db.SaveChanges();
    }

    /// <summary>The service, plus the games it handed to the aggregate on its last call, in order.</summary>
    private static (TrackedNewsService Service, ISteamNewsService Steam, List<int> AskedAbout) NewService(
        ApplicationDbContext db, IReadOnlyList<NewsItemDto>? news = null)
    {
        var askedAbout = new List<int>();
        var steam = Substitute.For<ISteamNewsService>();
        steam.GetLatestNewsAsync(
                Arg.Do<IEnumerable<int>>(ids => { askedAbout.Clear(); askedAbout.AddRange(ids); }),
                Arg.Any<int>(),
                Arg.Any<int?>(),
                Arg.Any<CancellationToken>())
            .Returns(news ?? []);

        return (new TrackedNewsService(db, steam), steam, askedAbout);
    }

    [Fact]
    public async Task GetNewsAsync_GamesInEveryPlace_AsksInProgressThenWishlistThenBacklogThenResolved()
    {
        using var db = NewDb();
        AddEntry(db, 50, ListStatusKeys.Dropped);
        AddEntry(db, 40, ListStatusKeys.Finished);
        AddEntry(db, 30, ListStatusKeys.Backlog);
        AddWishlisted(db, 25);
        AddEntry(db, 20, ListStatusKeys.OnHold);
        AddEntry(db, 10, ListStatusKeys.Playing);
        var (service, _, askedAbout) = NewService(db);

        await service.GetNewsAsync(UserId);

        Assert.Equal([10, 20, 25, 30, 40, 50], askedAbout);
    }

    [Fact]
    public async Task GetNewsAsync_SeveralInOnePlace_MostRecentlyMovedFirst()
    {
        // The game started last night leads the one started in March, as on the home page's rail.
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Playing, daysIn: 1);
        AddEntry(db, 2, ListStatusKeys.Playing, daysIn: 30);
        AddWishlisted(db, 3, daysIn: 2);
        AddWishlisted(db, 4, daysIn: 20);
        var (service, _, askedAbout) = NewService(db);

        await service.GetNewsAsync(UserId);

        Assert.Equal([2, 1, 4, 3], askedAbout);
    }

    [Fact]
    public async Task GetNewsAsync_GameInAListAndOnTheWishlist_AsksOnceAtTheHigherPlace()
    {
        // Wanting a game and playing it are not exclusive (ADR 0022). Asked about twice, it would take
        // two of the dozen places the aggregate keeps.
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Backlog);
        AddWishlisted(db, 2);
        AddEntry(db, 3, ListStatusKeys.Playing);
        AddWishlisted(db, 3);
        var (service, _, askedAbout) = NewService(db);

        await service.GetNewsAsync(UserId);

        Assert.Equal([3, 2, 1], askedAbout);
    }

    [Fact]
    public async Task GetNewsAsync_EntryInNoList_IsLeftOut()
    {
        // A game the user scored and then took out of every list is data, not tracking (ADR 0019).
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Playing);
        AddEntry(db, 2, status: null);
        var (service, _, askedAbout) = NewService(db);

        await service.GetNewsAsync(UserId);

        Assert.Equal([1], askedAbout);
    }

    [Fact]
    public async Task GetNewsAsync_AnotherUsersGames_AreLeftOut()
    {
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Playing);
        AddEntry(db, 2, ListStatusKeys.Playing, userId: OtherUserId);
        AddWishlisted(db, 3, userId: OtherUserId);
        var (service, _, askedAbout) = NewService(db);

        await service.GetNewsAsync(UserId);

        Assert.Equal([1], askedAbout);
    }

    [Fact]
    public async Task GetNewsAsync_TracksNothing_ReturnsEmptyWithoutAskingSteam()
    {
        using var db = NewDb();
        AddEntry(db, 2, ListStatusKeys.Playing, userId: OtherUserId);
        var (service, steam, _) = NewService(db);

        var news = await service.GetNewsAsync(UserId);

        Assert.Empty(news);
        await steam.DidNotReceiveWithAnyArgs().GetLatestNewsAsync(default!, default, default, default);
    }

    [Fact]
    public async Task GetNewsAsync_LargeLibrary_AsksAboutABoundedNumberOfTheMostRelevantGames()
    {
        // Every game handed over is resolved to a Steam AppID first, so the bound is what keeps a
        // huge library from costing IGDB a query per two hundred games on every visit.
        using var db = NewDb();
        for (var gameId = 1; gameId <= TrackedNewsService.MaxCandidateGames + 30; gameId++)
            AddEntry(db, gameId, ListStatusKeys.Backlog, daysIn: gameId);
        AddEntry(db, 9999, ListStatusKeys.Playing);
        var (service, _, askedAbout) = NewService(db);

        await service.GetNewsAsync(UserId);

        Assert.Equal(TrackedNewsService.MaxCandidateGames, askedAbout.Count);
        Assert.Equal(9999, askedAbout[0]);
    }

    [Fact]
    public async Task GetNewsAsync_CapsWhatAnyOneGameContributes()
    {
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Playing);
        var (service, steam, _) = NewService(db);

        await service.GetNewsAsync(UserId);

        await steam.Received(1).GetLatestNewsAsync(
            Arg.Any<IEnumerable<int>>(), Arg.Any<int>(), Arg.Is<int?>(cap => cap.HasValue && cap > 0), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetNewsAsync_ReturnsTheAggregatesNewsAsItIs()
    {
        using var db = NewDb();
        AddEntry(db, 1, ListStatusKeys.Playing);
        NewsItemDto item = new("gid-1", 1, "Hades", null, "Patch 1.1", "https://example.test/1", "Steam", null, Start);
        var (service, _, _) = NewService(db, [item]);

        var news = await service.GetNewsAsync(UserId);

        Assert.Equal([item], news);
    }
}
