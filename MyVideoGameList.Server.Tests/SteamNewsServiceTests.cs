using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models.Steam;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

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
        null, null, null, [], [], [], []);

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
