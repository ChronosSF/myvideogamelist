using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Which answers the home composite owns up to as degraded. It answers 200 either way, on purpose,
/// so the flag is all that stops a page built from a failure being kept as though it were the
/// page — by this process, and by the CDN in front of the SSR server. See
/// <c>docs/decisions/0013-http-caching-policy.md</c>.
/// </summary>
public class HomeServiceTests
{
    private static readonly DateTimeOffset Published = new(2026, 9, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>A game with a cover, and with the wide artwork the hero needs only when asked for.</summary>
    private static GameDto Game(int id, string? artwork = null) =>
        new(id, $"Game {id}", null, null, $"https://images.example/cover-{id}.jpg", artwork,
            null, null, null, null, null, null, null,
            Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    private static NewsItemDto NewsFor(int gameId) =>
        new($"gid-{gameId}", gameId, $"Game {gameId}", null, "Patch notes", $"https://example.test/{gameId}",
            "Steam", null, Published);

    private static IIgdbService IgdbTrending(params GameDto[] games)
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>()).Returns(games);
        return igdb;
    }

    private static ISteamNewsService SteamReturning(params NewsItemDto[] news)
    {
        var steam = Substitute.For<ISteamNewsService>();
        steam.GetLatestNewsAsync(
                Arg.Any<IEnumerable<int>>(), Arg.Any<int>(), Arg.Any<int?>(), Arg.Any<CancellationToken>())
            .Returns(news);
        return steam;
    }

    private static HomeService NewService(IIgdbService igdb, ISteamNewsService steam, IMemoryCache? cache = null) =>
        new(igdb, steam, cache ?? new MemoryCache(new MemoryCacheOptions()), NullLogger<HomeService>.Instance);

    /// <summary>
    /// How long the service asked for its answer to be kept. A substitute rather than a clock,
    /// because what is asserted is the lifetime asked for, not the cache's own timekeeping.
    /// </summary>
    private static async Task<TimeSpan?> LifetimeOfAsync(IIgdbService igdb, ISteamNewsService steam)
    {
        var entry = Substitute.For<ICacheEntry>();
        var cache = Substitute.For<IMemoryCache>();
        cache.CreateEntry(Arg.Any<object>()).Returns(entry);

        await NewService(igdb, steam, cache).GetHomeAsync();

        return entry.AbsoluteExpirationRelativeToNow;
    }

    [Fact]
    public async Task GetHomeAsync_TrendingThrows_AnswersEmptyAndDegraded()
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down"));
        var service = NewService(igdb, SteamReturning());

        var home = await service.GetHomeAsync();

        // Still an answer rather than an exception: the page renders without its rails.
        Assert.Null(home.Spotlight);
        Assert.Empty(home.Popular);
        Assert.Empty(home.News);
        Assert.True(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_TrendingComesBackEmpty_IsDegraded()
    {
        // IGDB answering with no popularity rows throws nothing — GetTrendingAsync returns empty —
        // and is the same empty page as the outage above. It is also all a removed field looks like.
        var service = NewService(IgdbTrending(), SteamReturning());

        var home = await service.GetHomeAsync();

        Assert.Empty(home.Popular);
        Assert.True(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_NewsComesBackEmpty_IsDegradedAndKeepsTheCovers()
    {
        // Reachable from an IGDB outage as well as a Steam one: the trending rail is answered from
        // an hour-long cache, and the lookups behind the news are then the first to fail.
        var service = NewService(IgdbTrending(Game(1, "https://images.example/art-1.jpg"), Game(2)), SteamReturning());

        var home = await service.GetHomeAsync();

        Assert.Equal([1, 2], home.Popular.Select(g => g.Id));
        Assert.Equal(1, home.Spotlight?.Id);
        Assert.True(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_BothRailsFilled_IsNotDegraded()
    {
        var service = NewService(
            IgdbTrending(Game(1), Game(2, "https://images.example/art-2.jpg")), SteamReturning(NewsFor(1)));

        var home = await service.GetHomeAsync();

        // The first game with artwork, not the first game: the hero needs a wide image.
        Assert.Equal(2, home.Spotlight?.Id);
        Assert.Equal([NewsFor(1)], home.News);
        Assert.False(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_NoGameHasArtwork_IsNotDegraded()
    {
        // Plenty of IGDB entries have no artwork, so a missing spotlight is an ordinary answer: the
        // hero falls back to its gradient, and nothing upstream failed.
        var service = NewService(IgdbTrending(Game(1), Game(2)), SteamReturning(NewsFor(1)));

        var home = await service.GetHomeAsync();

        Assert.Null(home.Spotlight);
        Assert.False(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_DegradedAnswer_IsKeptForLessTimeThanAHealthyOne()
    {
        // The same judgement picks both, so a failure the flag owns up to is never the one this
        // process goes on serving for the full window. Every degraded path, not only the exception.
        var igdbDown = Substitute.For<IIgdbService>();
        igdbDown.GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down"));

        var healthy = await LifetimeOfAsync(IgdbTrending(Game(1)), SteamReturning(NewsFor(1)));
        var outage = await LifetimeOfAsync(igdbDown, SteamReturning());
        var noTrending = await LifetimeOfAsync(IgdbTrending(), SteamReturning());
        var noNews = await LifetimeOfAsync(IgdbTrending(Game(1)), SteamReturning());

        Assert.NotNull(healthy);
        Assert.All([outage, noTrending, noNews], degraded =>
        {
            Assert.NotNull(degraded);
            Assert.True(degraded < healthy, $"A degraded answer was kept for {degraded}, a healthy one for {healthy}.");
        });
    }

    [Fact]
    public async Task GetHomeAsync_DegradedAnswerServedFromCache_StillSaysSo()
    {
        // For the minute the failure is kept, every response built from it has to carry the flag,
        // or the first visitor's page is uncached and the second's is pinned at the edge.
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down"));
        var service = NewService(igdb, SteamReturning());

        await service.GetHomeAsync();
        var second = await service.GetHomeAsync();

        Assert.True(second.Degraded);
        await igdb.Received(1).GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetHomeAsync_CallerCancels_ThrowsAndKeepsNothing()
    {
        // A reader who left is not an upstream failure. Swallowed as one, a single abandoned request
        // would leave an empty front page in the cache for everybody who came after it.
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new OperationCanceledException());
        var cache = Substitute.For<IMemoryCache>();
        var service = NewService(igdb, SteamReturning(), cache);

        await Assert.ThrowsAsync<OperationCanceledException>(() => service.GetHomeAsync());

        cache.DidNotReceiveWithAnyArgs().CreateEntry(default!);
    }
}
