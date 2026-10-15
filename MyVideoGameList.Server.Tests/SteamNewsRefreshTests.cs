using System.Net;
using System.Text;
using System.Text.Json;
using System.Web;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models.Steam;
using MyVideoGameList.Server.Services;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Keeping the Steam feeds people read fetched ahead of their expiry, and only those.
/// </summary>
/// <remarks>
/// The decisions are made on the injected clock, so these tests move it. <see cref="IMemoryCache"/>
/// keeps time of its own, so its entries outlive each test; where a test needs one gone, it compacts
/// the cache, which is what an expiry looks like to the refresh.
/// </remarks>
public class SteamNewsRefreshTests
{
    private static readonly DateTimeOffset Midday = new(2026, 10, 15, 12, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// A clock moved by hand, which can also move on by <paramref name="tick"/> every time it is
    /// read, so that two reads in a row are never the same instant.
    /// </summary>
    private sealed class ManualClock(DateTimeOffset now, TimeSpan tick = default) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public override DateTimeOffset GetUtcNow()
        {
            var read = _now;
            _now += tick;
            return read;
        }

        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    /// <summary>
    /// A Steam that answers every AppID with one item headed <see cref="Headline"/> — or with a 404
    /// for those in <see cref="NoFeed"/>, or a 503 while <see cref="Down"/> — and counts what it is
    /// asked.
    /// </summary>
    private sealed class FakeSteam : HttpMessageHandler
    {
        private int _asked;

        public int Asked => _asked;
        public string Headline { get; set; } = "First";
        public bool Down { get; set; }
        public HashSet<int> NoFeed { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _asked);

            if (Down) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));

            var appId = int.Parse(HttpUtility.ParseQueryString(request.RequestUri!.Query)["appid"]!);
            if (NoFeed.Contains(appId)) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));

            var feed = new SteamNewsResponse(new SteamAppNews(appId,
            [
                new SteamNewsItem(
                    $"{appId}-{Headline}", Headline, "https://store.steampowered.com/news/1",
                    null, null, null, null, 1_700_000_000)
            ]));

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(JsonSerializer.Serialize(feed), Encoding.UTF8, "application/json")
            });
        }
    }

    private static GameDto Game(int id) =>
        new(id, $"Game {id}", null, null, null, null, null, null, null, null, null, null, null,
            Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    /// <summary>The AppID game <paramref name="id"/> has on Steam in these tests.</summary>
    private static int AppIdOf(int id) => 1000 + id;

    /// <summary>An IGDB in which every game is on Steam, under <see cref="AppIdOf"/>.</summary>
    private static IIgdbService Igdb()
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetSteamAppIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult<IReadOnlyDictionary<int, int>>(
                call.Arg<IEnumerable<int>>().ToDictionary(id => id, AppIdOf)));
        igdb.GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult(call.Arg<IEnumerable<int>>().Select(Game).ToList().AsEnumerable()));
        return igdb;
    }

    private static (SteamNewsService Service, MemoryCache Cache) NewService(FakeSteam steam, ManualClock clock)
    {
        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient("Steam").Returns(_ => new HttpClient(steam, disposeHandler: false));

        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new SteamNewsService(factory, Igdb(), cache, clock, NullLogger<SteamNewsService>.Instance);

        return (service, cache);
    }

    /// <summary>One game's panel, read as a page reads it.</summary>
    private static async Task<string> HeadlineOf(SteamNewsService service, int gameId) =>
        Assert.Single(await service.GetNewsForGameAsync(gameId)).Title;

    /// <summary>How long after its fetch a feed with items falls due.</summary>
    private static readonly TimeSpan DueAt = SteamNewsService.FeedCacheLifetime - SteamNewsService.RefreshLead;

    private static readonly TimeSpan Minute = TimeSpan.FromMinutes(1);

    [Fact]
    public async Task RefreshFeedsAsync_AFeedReadSinceItWasFetched_IsFetchedAgainBeforeItExpires()
    {
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam();
        var (service, _) = NewService(steam, clock);

        Assert.Equal("First", await HeadlineOf(service, 1)); // fetched
        clock.Advance(TimeSpan.FromMinutes(10));
        await HeadlineOf(service, 1); // read again, from the cache

        steam.Headline = "Second";
        clock.Advance(DueAt - TimeSpan.FromMinutes(10));
        await service.RefreshFeedsAsync();

        // Refreshed ahead of the expiry, and the next reader is served the new copy without asking.
        Assert.Equal(2, steam.Asked);
        Assert.Equal("Second", await HeadlineOf(service, 1));
        Assert.Equal(2, steam.Asked);
    }

    [Fact]
    public async Task RefreshFeedsAsync_AFeedNobodyReadAgain_IsLeftToExpireAndForgotten()
    {
        // Kept warm for nobody, every game page a crawler visits once would cost a Steam request
        // every half hour for ever. The clock moves on every reading, so the request that fetched
        // the feed and the fetch itself are different instants — which is what pins the read being
        // marked before the fetch, so that a miss never counts as a read of the copy it fetched.
        var clock = new ManualClock(Midday, tick: TimeSpan.FromMilliseconds(1));
        var steam = new FakeSteam();
        var (service, _) = NewService(steam, clock);

        await HeadlineOf(service, 1);
        clock.Advance(DueAt);
        await service.RefreshFeedsAsync();
        clock.Advance(Minute);
        await service.RefreshFeedsAsync();

        Assert.Equal(1, steam.Asked);
        Assert.Equal(0, service.WatchedFeeds);
    }

    [Fact]
    public async Task RefreshFeedsAsync_AFeedNotYetDue_IsLeftAlone()
    {
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam();
        var (service, _) = NewService(steam, clock);

        await HeadlineOf(service, 1);
        clock.Advance(TimeSpan.FromMinutes(10));
        await HeadlineOf(service, 1);
        clock.Advance(DueAt - TimeSpan.FromMinutes(11));
        await service.RefreshFeedsAsync();

        Assert.Equal(1, steam.Asked);
    }

    [Fact]
    public async Task RefreshFeedsAsync_AFeedAlreadyExpired_IsLeftToItsNextReaderAndForgotten()
    {
        // Gone from the cache is the reader's to fetch, as before this existed — and gone from the
        // refresh's own record too, or that record would grow by every feed the process has served.
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam();
        var (service, cache) = NewService(steam, clock);

        await HeadlineOf(service, 1);
        clock.Advance(TimeSpan.FromMinutes(10));
        await HeadlineOf(service, 1);

        cache.Compact(1.0);
        await service.RefreshFeedsAsync();

        Assert.Equal(1, steam.Asked);
        Assert.Equal(0, service.WatchedFeeds);
    }

    [Fact]
    public async Task RefreshFeedsAsync_AnEmptyFeed_IsFetchedAgainBeforeItsShorterLifeEnds()
    {
        // A game Steam has no news for is an answer like any other, kept for ten minutes rather than
        // thirty, and kept warm on its own clock.
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam();
        steam.NoFeed.Add(AppIdOf(1));
        var (service, _) = NewService(steam, clock);

        Assert.Empty(await service.GetNewsForGameAsync(1));
        clock.Advance(TimeSpan.FromMinutes(2));
        await service.GetNewsForGameAsync(1);

        clock.Advance(SteamNewsService.EmptyFeedCacheLifetime - SteamNewsService.RefreshLead - TimeSpan.FromMinutes(2));
        await service.RefreshFeedsAsync();

        Assert.Equal(2, steam.Asked);
    }

    [Fact]
    public async Task RefreshFeedsAsync_TheStandInForAFetchThatFailed_IsNotRefreshed()
    {
        // A reader whose fetch fails caches an empty stand-in so that a failing Steam is not asked
        // again for ten minutes. Refreshing it ahead of its expiry would ask three times in its last
        // three, for every feed anybody reads, all through an outage.
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam { Down = true };
        var (service, _) = NewService(steam, clock);

        Assert.Empty(await service.GetNewsForGameAsync(1));
        steam.Down = false;
        clock.Advance(TimeSpan.FromMinutes(2));
        Assert.Empty(await service.GetNewsForGameAsync(1)); // the stand-in, read again

        clock.Advance(SteamNewsService.EmptyFeedCacheLifetime - SteamNewsService.RefreshLead - TimeSpan.FromMinutes(2));
        await service.RefreshFeedsAsync();

        Assert.Equal(1, steam.Asked);
        Assert.Equal(0, service.WatchedFeeds);
    }

    [Fact]
    public async Task RefreshFeedsAsync_WhenSteamFails_KeepsTheCopyItHad()
    {
        // A reader whose own fetch fails caches an empty feed, so as not to ask a failing Steam on
        // every render. The refresh must not: it would blank a good feed to spare nobody anything.
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam();
        var (service, _) = NewService(steam, clock);

        await HeadlineOf(service, 1);
        clock.Advance(TimeSpan.FromMinutes(10));
        await HeadlineOf(service, 1);

        steam.Down = true;
        clock.Advance(DueAt - TimeSpan.FromMinutes(10));
        await service.RefreshFeedsAsync();

        Assert.Equal(2, steam.Asked);
        Assert.Equal("First", await HeadlineOf(service, 1));
        Assert.Equal(2, steam.Asked);
    }

    [Fact]
    public async Task RefreshFeedsAsync_WhenSteamFails_TriesAgainOnTheNextTick()
    {
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam();
        var (service, _) = NewService(steam, clock);

        await HeadlineOf(service, 1);
        clock.Advance(TimeSpan.FromMinutes(10));
        await HeadlineOf(service, 1);

        steam.Down = true;
        clock.Advance(DueAt - TimeSpan.FromMinutes(10));
        await service.RefreshFeedsAsync();

        steam.Down = false;
        steam.Headline = "Second";
        clock.Advance(Minute);
        await service.RefreshFeedsAsync();

        Assert.Equal(3, steam.Asked);
        Assert.Equal("Second", await HeadlineOf(service, 1));
    }

    [Fact]
    public async Task RefreshFeedsAsync_TakesNoMoreThanOneAggregatesFanOut_SoonestToExpireFirst()
    {
        // Never more at once than a cold home page already asks for. What is left over stays due and
        // is taken on the next tick — and the dozen taken first are the dozen closest to expiring.
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam();
        var (service, _) = NewService(steam, clock);
        var early = Enumerable.Range(1, SteamNewsService.MaxFeedsPerRefresh).ToList();
        var late = Enumerable.Range(SteamNewsService.MaxFeedsPerRefresh + 1, 3).ToList();

        foreach (var game in early) await HeadlineOf(service, game);
        clock.Advance(Minute);
        foreach (var game in late) await HeadlineOf(service, game);
        clock.Advance(TimeSpan.FromMinutes(9));
        foreach (var game in early.Concat(late)) await HeadlineOf(service, game);

        // Every one of the fifteen is due now: the early dozen two minutes from expiring, the late
        // three three minutes from it.
        steam.Headline = "Second";
        clock.Advance(DueAt + Minute - TimeSpan.FromMinutes(10));
        await service.RefreshFeedsAsync();

        Assert.Equal(early.Count + late.Count + SteamNewsService.MaxFeedsPerRefresh, steam.Asked);
        foreach (var game in early) Assert.Equal("Second", await HeadlineOf(service, game));
        foreach (var game in late) Assert.Equal("First", await HeadlineOf(service, game));

        clock.Advance(Minute);
        await service.RefreshFeedsAsync();

        foreach (var game in late) Assert.Equal("Second", await HeadlineOf(service, game));
    }

    // ── The timer ─────────────────────────────────────────────────────────────────────

    private sealed class ListLogger : ILogger<SteamNewsRefreshService>
    {
        public List<LogLevel> Levels { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => Levels.Add(logLevel);
    }

    [Fact]
    public async Task RunOnceAsync_WhenTheRefreshThrows_LogsItAndCarriesOn()
    {
        // Nothing in the refresh should throw for Steam, so this would be a bug; it is still not
        // worth the host (ADR 0038).
        var steamNews = Substitute.For<ISteamNewsService>();
        steamNews.RefreshFeedsAsync(Arg.Any<CancellationToken>()).ThrowsAsync(new InvalidOperationException("A bug."));
        var logger = new ListLogger();

        await new SteamNewsRefreshService(steamNews, TimeProvider.System, logger).RunOnceAsync(CancellationToken.None);

        Assert.Equal([LogLevel.Error], logger.Levels);
    }

    [Fact]
    public async Task RunOnceAsync_ACancellationThatIsNotTheHostStopping_IsAFailedTick()
    {
        var steamNews = Substitute.For<ISteamNewsService>();
        steamNews.RefreshFeedsAsync(Arg.Any<CancellationToken>()).ThrowsAsync(new TaskCanceledException("Timed out."));
        var logger = new ListLogger();

        await new SteamNewsRefreshService(steamNews, TimeProvider.System, logger).RunOnceAsync(CancellationToken.None);

        Assert.Equal([LogLevel.Error], logger.Levels);
    }

    [Fact]
    public async Task RunOnceAsync_WhenTheHostIsStopping_LetsTheCancellationThrough()
    {
        using var stopping = new CancellationTokenSource();
        await stopping.CancelAsync();
        var steamNews = Substitute.For<ISteamNewsService>();
        steamNews.RefreshFeedsAsync(Arg.Any<CancellationToken>())
            .ThrowsAsync(new OperationCanceledException(stopping.Token));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => new SteamNewsRefreshService(steamNews, TimeProvider.System, new ListLogger())
                .RunOnceAsync(stopping.Token));
    }

    [Fact]
    public void AddScheduledWork_RegistersTheSteamNewsRefresh()
    {
        Assert.Contains(
            new ServiceCollection().AddScheduledWork(),
            service => service.ServiceType == typeof(IHostedService)
                && service.ImplementationType == typeof(SteamNewsRefreshService));
    }
}
