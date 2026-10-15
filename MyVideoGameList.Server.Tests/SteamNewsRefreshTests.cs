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
/// The decisions are made on the injected clock, so these tests move it; <see cref="IMemoryCache"/>
/// keeps its own, and its entries simply outlive each test.
/// </remarks>
public class SteamNewsRefreshTests
{
    private static readonly DateTimeOffset Midday = new(2026, 10, 15, 12, 0, 0, TimeSpan.Zero);

    private sealed class ManualClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    /// <summary>
    /// A Steam that answers every AppID with one item headed <see cref="Headline"/>, or fails while
    /// <see cref="Down"/>, and counts what it is asked.
    /// </summary>
    private sealed class FakeSteam : HttpMessageHandler
    {
        private int _asked;

        public int Asked => _asked;
        public string Headline { get; set; } = "First";
        public bool Down { get; set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _asked);

            if (Down) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));

            var appId = int.Parse(HttpUtility.ParseQueryString(request.RequestUri!.Query)["appid"]!);
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

    /// <summary>An IGDB in which game <c>n</c> is on Steam as AppID <c>1000 + n</c>.</summary>
    private static IIgdbService Igdb()
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetSteamAppIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult<IReadOnlyDictionary<int, int>>(
                call.Arg<IEnumerable<int>>().ToDictionary(id => id, id => 1000 + id)));
        igdb.GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult(call.Arg<IEnumerable<int>>().Select(Game).ToList().AsEnumerable()));
        return igdb;
    }

    private static SteamNewsService NewService(FakeSteam steam, ManualClock clock)
    {
        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient("Steam").Returns(_ => new HttpClient(steam, disposeHandler: false));

        return new SteamNewsService(
            factory, Igdb(), new MemoryCache(new MemoryCacheOptions()), clock,
            NullLogger<SteamNewsService>.Instance);
    }

    /// <summary>One game's panel, read as a page reads it.</summary>
    private static async Task<string> HeadlineOf(SteamNewsService service, int gameId) =>
        Assert.Single(await service.GetNewsForGameAsync(gameId)).Title;

    /// <summary>The moment, after a feed fetched at midday, at which it falls due.</summary>
    private static readonly TimeSpan DueAt = SteamNewsService.FeedCacheLifetime - SteamNewsService.RefreshLead;

    [Fact]
    public async Task RefreshFeedsAsync_AFeedReadSinceItWasFetched_IsFetchedAgainBeforeItExpires()
    {
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam();
        var service = NewService(steam, clock);

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
    public async Task RefreshFeedsAsync_AFeedNobodyReadAgain_IsLeftToExpire()
    {
        // Kept warm for nobody, every game page a crawler visits once would cost a Steam request
        // every half hour for ever.
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam();
        var service = NewService(steam, clock);

        await HeadlineOf(service, 1);
        clock.Advance(DueAt);
        await service.RefreshFeedsAsync();
        clock.Advance(TimeSpan.FromMinutes(1));
        await service.RefreshFeedsAsync();

        Assert.Equal(1, steam.Asked);
    }

    [Fact]
    public async Task RefreshFeedsAsync_AFeedNotYetDue_IsLeftAlone()
    {
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam();
        var service = NewService(steam, clock);

        await HeadlineOf(service, 1);
        clock.Advance(TimeSpan.FromMinutes(10));
        await HeadlineOf(service, 1);
        clock.Advance(DueAt - TimeSpan.FromMinutes(11));
        await service.RefreshFeedsAsync();

        Assert.Equal(1, steam.Asked);
    }

    [Fact]
    public async Task RefreshFeedsAsync_WhenSteamFails_KeepsTheCopyItHad()
    {
        // A reader whose own fetch fails caches an empty feed, so as not to ask a failing Steam on
        // every render. The refresh must not: it would blank a good feed to spare nobody anything.
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam();
        var service = NewService(steam, clock);

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
        var service = NewService(steam, clock);

        await HeadlineOf(service, 1);
        clock.Advance(TimeSpan.FromMinutes(10));
        await HeadlineOf(service, 1);

        steam.Down = true;
        clock.Advance(DueAt - TimeSpan.FromMinutes(10));
        await service.RefreshFeedsAsync();

        steam.Down = false;
        steam.Headline = "Second";
        clock.Advance(TimeSpan.FromMinutes(1));
        await service.RefreshFeedsAsync();

        Assert.Equal(3, steam.Asked);
        Assert.Equal("Second", await HeadlineOf(service, 1));
    }

    [Fact]
    public async Task RefreshFeedsAsync_AsksForNoMoreThanOneAggregatesFanOutAtOnce()
    {
        // Never more at once than a cold home page already asks for. The rest expire and are
        // fetched by their readers, which is no worse than before.
        var clock = new ManualClock(Midday);
        var steam = new FakeSteam();
        var service = NewService(steam, clock);
        var games = Enumerable.Range(1, SteamNewsService.MaxFeedsPerRefresh + 3).ToList();

        foreach (var game in games) await HeadlineOf(service, game);
        clock.Advance(TimeSpan.FromMinutes(10));
        foreach (var game in games) await HeadlineOf(service, game);

        clock.Advance(DueAt - TimeSpan.FromMinutes(10));
        await service.RefreshFeedsAsync();

        Assert.Equal(games.Count + SteamNewsService.MaxFeedsPerRefresh, steam.Asked);
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
