using System.Net;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models.Steam;
using MyVideoGameList.Server.Services;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The aggregate's promise that an upstream failure costs the news and nothing else.
/// <see cref="ISteamNewsService"/> says every method degrades to an empty list; the home page, the
/// game page's panel and <c>/news</c> all call it without a try/catch on that strength.
/// </summary>
public class GetLatestNewsAsyncTests
{
    private const int HadesAppId = 1145360;

    private static readonly GameDto Hades = new(
        1, "Hades", null, null, null, null, null, null, null, null, null, null, null,
        Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    /// <summary>
    /// What an <see cref="HttpClient"/> throws when its <c>Timeout</c> passes: a cancellation, but not
    /// one the caller asked for.
    /// </summary>
    private static TaskCanceledException Timeout() =>
        new("The request was canceled due to the configured HttpClient.Timeout.", new TimeoutException());

    private sealed class StubHandler(Func<HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(respond());
    }

    /// <summary>An IGDB that knows Hades and its Steam AppID.</summary>
    private static IIgdbService IgdbKnowingHades()
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetSteamAppIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(new Dictionary<int, int> { [Hades.Id] = HadesAppId });
        igdb.GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns([Hades]);
        return igdb;
    }

    /// <summary>A service whose Steam answers with <paramref name="steam"/>, or a 404 by default.</summary>
    private static SteamNewsService NewService(IIgdbService igdb, Func<HttpResponseMessage>? steam = null)
    {
        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient("Steam").Returns(_ => new HttpClient(
            new StubHandler(steam ?? (() => new HttpResponseMessage(HttpStatusCode.NotFound)))));

        return new SteamNewsService(
            factory, igdb, new MemoryCache(new MemoryCacheOptions()), NullLogger<SteamNewsService>.Instance);
    }

    [Fact]
    public async Task GetLatestNewsAsync_GameLookupFails_ReturnsEmptyRatherThanThrowing()
    {
        // The AppID map is cached for a day and the game lookup for half an hour, so IGDB can fail
        // on the second call after the first was answered from cache.
        var igdb = IgdbKnowingHades();
        igdb.GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down."));

        var news = await NewService(igdb).GetLatestNewsAsync([Hades.Id]);

        Assert.Empty(news);
    }

    [Fact]
    public async Task GetLatestNewsAsync_IgdbTimesOut_ReturnsEmptyRatherThanThrowing()
    {
        var igdb = IgdbKnowingHades();
        igdb.GetSteamAppIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(Timeout());

        var news = await NewService(igdb).GetLatestNewsAsync([Hades.Id]);

        Assert.Empty(news);
    }

    [Fact]
    public async Task GetLatestNewsAsync_SteamTimesOut_ReturnsEmptyRatherThanThrowing()
    {
        // The Steam client's timeout is eight seconds, which a slow Steam reaches.
        var news = await NewService(IgdbKnowingHades(), steam: () => throw Timeout())
            .GetLatestNewsAsync([Hades.Id]);

        Assert.Empty(news);
    }

    [Fact]
    public async Task GetLatestNewsAsync_CallerCancels_StillThrows()
    {
        // Degrading is for upstream failures. A request the caller abandoned should stop, not return
        // an empty answer nobody is waiting for.
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        var igdb = IgdbKnowingHades();
        igdb.GetSteamAppIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new OperationCanceledException(cancelled.Token));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => NewService(igdb).GetLatestNewsAsync([Hades.Id], cancellationToken: cancelled.Token));
    }
}

public class ToExcerptTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void WithNoContent_ReturnsNull(string? contents)
        => Assert.Null(SteamNewsService.ToExcerpt(contents));

    [Fact]
    public void StripsBbCode()
    {
        var result = SteamNewsService.ToExcerpt("[h2]Patch 1.2[/h2][b]Fixed[/b] a crash.");

        Assert.Equal("Patch 1.2 Fixed a crash.", result);
    }

    [Fact]
    public void StripsHtmlTags()
    {
        var result = SteamNewsService.ToExcerpt("<p>Season <strong>4</strong> is live.</p>");

        Assert.Equal("Season 4 is live.", result);
    }

    [Fact]
    public void DecodesHtmlEntities()
    {
        var result = SteamNewsService.ToExcerpt("Fixes &amp; improvements for &quot;Hardcore&quot; mode");

        Assert.Equal("Fixes & improvements for \"Hardcore\" mode", result);
    }

    [Fact]
    public void CollapsesWhitespaceIntroducedByStripping()
    {
        // Tags become spaces, so a densely marked-up line would otherwise be full of gaps.
        var result = SteamNewsService.ToExcerpt("[b]A[/b]\n\n[i]B[/i]   [u]C[/u]");

        Assert.Equal("A B C", result);
    }

    [Fact]
    public void WhenOnlyMarkup_ReturnsNull()
        => Assert.Null(SteamNewsService.ToExcerpt("[img]http://example.com/a.png[/img]<br>"));

    [Fact]
    public void DropsMediaBlocksWholeRatherThanLeavingTheAssetUrl()
    {
        // Steam announcements routinely open with an image, and stripping only the tags would
        // leave the URL as the first thing the reader sees.
        var result = SteamNewsService.ToExcerpt(
            "[img]https://clan.cloudflare.steamstatic.com/a.png[/img]Season 4 is live.");

        Assert.Equal("Season 4 is live.", result);
    }

    [Fact]
    public void DropsEmbeddedVideoBlocks()
    {
        var result = SteamNewsService.ToExcerpt(
            "[previewyoutube=abc123;full][/previewyoutube]Watch the trailer above.");

        Assert.Equal("Watch the trailer above.", result);
    }

    [Fact]
    public void WhenLong_TruncatesOnAWordBoundaryAndAppendsEllipsis()
    {
        var result = SteamNewsService.ToExcerpt(string.Join(' ', Enumerable.Repeat("alpha", 100)));

        Assert.NotNull(result);
        Assert.EndsWith("…", result);
        Assert.DoesNotContain("alph…", result);
        Assert.True(result.Length <= 181, $"Excerpt was {result.Length} characters.");
    }

    [Fact]
    public void WhenShort_IsLeftIntact()
    {
        var result = SteamNewsService.ToExcerpt("Short and sweet.");

        Assert.Equal("Short and sweet.", result);
        Assert.DoesNotContain("…", result);
    }

    [Fact]
    public void WithNoSpaceToBreakOn_StillTruncates()
    {
        // A single unbroken token has no word boundary to cut at; the guard against a silly
        // short excerpt must not push the result past the limit either.
        var result = SteamNewsService.ToExcerpt(new string('x', 400));

        Assert.NotNull(result);
        Assert.EndsWith("…", result);
        Assert.True(result.Length <= 181, $"Excerpt was {result.Length} characters.");
    }
}

public class MapToDtoTests
{
    private static readonly GameDto Game = new(
        1020, "Grand Theft Auto V", null, null, "https://img/cover.jpg", null, null, null,
        null, null, null, null, null,
        Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    private static SteamNewsItem Item(
        string? gid = "g1",
        string? title = "Update released",
        string? url = "https://store.steampowered.com/news/1",
        long date = 1_700_000_000) =>
        new(gid, title, url, "author", "Body text", "Community Announcements", "steam", date);

    [Fact]
    public void WithAValidItem_JoinsGameMetadataOntoIt()
    {
        var dto = SteamNewsService.MapToDto(Item(), Game);

        Assert.NotNull(dto);
        Assert.Equal("g1", dto.Id);
        Assert.Equal(1020, dto.GameId);
        Assert.Equal("Grand Theft Auto V", dto.GameTitle);
        Assert.Equal("https://img/cover.jpg", dto.GameCoverUrl);
        Assert.Equal("Community Announcements", dto.Source);
        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1_700_000_000), dto.PublishedAt);
    }

    [Theory]
    [InlineData(null, "t", "u")]
    [InlineData("g", null, "u")]
    [InlineData("g", "t", null)]
    [InlineData("", "t", "u")]
    [InlineData("g", "  ", "u")]
    public void WithAMissingRequiredField_ReturnsNull(string? gid, string? title, string? url)
        => Assert.Null(SteamNewsService.MapToDto(Item(gid, title, url), Game));

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void WithAnUnusableDate_ReturnsNull(long date)
    {
        // Rendering as 1970 on a "latest news" rail reads as a bug, so drop the item instead.
        Assert.Null(SteamNewsService.MapToDto(Item(date: date), Game));
    }

    [Fact]
    public void WithNoFeedLabel_FallsBackToSteam()
    {
        var item = new SteamNewsItem("g1", "T", "https://u", null, null, null, null, 1_700_000_000);

        Assert.Equal("Steam", SteamNewsService.MapToDto(item, Game)?.Source);
    }

    [Fact]
    public void DecodesEntitiesInTheTitleRatherThanDeletingThem()
    {
        // Guards a real defect: stripping entities before decoding turned "&amp;" into nothing.
        var item = Item(title: "Fixes &amp; improvements");

        Assert.Equal("Fixes & improvements", SteamNewsService.MapToDto(item, Game)?.Title);
    }

    [Fact]
    public void StripsMarkupFromTheTitle()
    {
        var item = Item(title: "<b>Major</b> update");

        Assert.Equal("Major update", SteamNewsService.MapToDto(item, Game)?.Title);
    }

    [Fact]
    public void WhenTheTitleIsEntirelyMarkup_KeepsTheOriginalRatherThanRenderingBlank()
    {
        var item = Item(title: "<img src='x'>");

        Assert.Equal("<img src='x'>", SteamNewsService.MapToDto(item, Game)?.Title);
    }
}
