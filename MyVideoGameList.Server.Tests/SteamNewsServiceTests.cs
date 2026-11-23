using System.Net;
using System.Text.RegularExpressions;
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

    private sealed class StubHandler(Func<HttpResponseMessage> respond, List<Uri>? asked = null)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (asked is not null)
                lock (asked) asked.Add(request.RequestUri!);

            return Task.FromResult(respond());
        }
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

    /// <summary>
    /// A service whose Steam answers with <paramref name="steam"/>, or a 404 by default, and writes
    /// every URL it is asked for into <paramref name="asked"/>.
    /// </summary>
    private static SteamNewsService NewService(
        IIgdbService igdb, Func<HttpResponseMessage>? steam = null, List<Uri>? asked = null)
    {
        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient("Steam").Returns(_ => new HttpClient(
            new StubHandler(steam ?? (() => new HttpResponseMessage(HttpStatusCode.NotFound)), asked)));

        return new SteamNewsService(
            factory, igdb, new MemoryCache(new MemoryCacheOptions()), TimeProvider.System,
            NullLogger<SteamNewsService>.Instance);
    }

    /// <summary>How many items the one feed asked for was asked for.</summary>
    private static int CountAskedFor(List<Uri> asked) =>
        int.Parse(System.Web.HttpUtility.ParseQueryString(Assert.Single(asked).Query)["count"]!);

    [Theory]
    [InlineData(20, 3, 9)] // /news: twenty items, three a game
    [InlineData(8, 2, 6)] // the home rail: eight items, two a game
    public async Task GetLatestNewsAsync_WithAPerGameCap_AsksEachFeedForThreeTimesTheCap(
        int count, int maxPerGame, int expected)
    {
        // A game contributes at most its cap however long its feed is, so asking for three times
        // the whole page — sixty items a game for /news — fetched twenty times what it could keep.
        var asked = new List<Uri>();

        await NewService(IgdbKnowingHades(), asked: asked).GetLatestNewsAsync([Hades.Id], count, maxPerGame);

        Assert.Equal(expected, CountAskedFor(asked));
    }

    [Fact]
    public async Task GetNewsForGameAsync_WithNoCap_AsksForThreeTimesTheCount()
    {
        // One game's panel has no cap, because every item on it is that game's.
        var asked = new List<Uri>();

        await NewService(IgdbKnowingHades(), asked: asked).GetNewsForGameAsync(Hades.Id, count: 5);

        Assert.Equal(15, CountAskedFor(asked));
    }

    [Fact]
    public async Task GetLatestNewsAsync_AsksSteamForTheGamesOwnAnnouncementsOnly()
    {
        // Unfiltered, Steam mixes in the press it collects, and for a single-player game that is most of
        // its feed (ADR 0072). Every reader — the home rail, /news and a game's panel — asks through here.
        var asked = new List<Uri>();

        await NewService(IgdbKnowingHades(), asked: asked).GetLatestNewsAsync([Hades.Id]);

        var query = System.Web.HttpUtility.ParseQueryString(Assert.Single(asked).Query);
        Assert.Equal("steam_community_announcements", query["feeds"]);
    }

    [Fact]
    public async Task GetLatestNewsAsync_AnyFeed_AsksSteamForTheWholeBody()
    {
        // Asked for any other length, Steam sends a blurb with each tag deleted and nothing in its place,
        // and the words of two blocks run together for good. The excerpt is made here, from the body.
        var asked = new List<Uri>();

        await NewService(IgdbKnowingHades(), asked: asked).GetLatestNewsAsync([Hades.Id]);

        var query = System.Web.HttpUtility.ParseQueryString(Assert.Single(asked).Query);
        Assert.Equal("0", query["maxlength"]);
    }

    [Fact]
    public async Task GetLatestNewsAsync_SteamSendsABody_ReturnsItsExcerpt()
    {
        // Apex Legends, "Apex Legends: Latest Update 11/16/2026" (gid 1849827110426441), as Steam sent
        // it in November 2026, under Hades' AppID.
        var feed = new SteamNewsResponse(new SteamAppNews(HadesAppId,
        [
            new SteamNewsItem(
                "1849827110426441",
                "Apex Legends: Latest Update 11/16/2026",
                "https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1849827110426441",
                "RSPN_Bean",
                "[p][img src=\"{STEAM_CLAN_IMAGE}/38098458/c52c1d115036fc56ac832bf9f3764e3d52e89aa3.jpg\"][/img][/p]"
                + "[p]FIXED:[/p][p]Resolved an issue causing Alter, Seer and Wattson Upgrades being misplaced in "
                + "their upgrade trees.[/p]",
                "Community Announcements",
                "steam_community_announcements",
                1795046233)
        ]));

        var news = await NewService(
                IgdbKnowingHades(),
                steam: () => new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = System.Net.Http.Json.JsonContent.Create(feed)
                })
            .GetLatestNewsAsync([Hades.Id]);

        Assert.Equal(
            "FIXED: Resolved an issue causing Alter, Seer and Wattson Upgrades being misplaced in their upgrade trees.",
            Assert.Single(news).Excerpt);
    }

    [Fact]
    public async Task GetLatestNewsAsync_WithACapAboveTheCount_AsksForNoMoreThanTheCountNeeds()
    {
        var asked = new List<Uri>();

        await NewService(IgdbKnowingHades(), asked: asked).GetLatestNewsAsync([Hades.Id], count: 4, maxPerGame: 10);

        Assert.Equal(12, CountAskedFor(asked));
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

    // From here on, every sample is cut from what Steam answered, in November 2026, for the item named.
    // First the bodies the service now asks for. The first four are the items whose words ran together
    // in Steam's blurb.

    [Theory]
    // War Thunder, "Update 2.61.0.33" (gid 1849827110433047): the blurb read "AircraftHornet …
    // (Report).Nuclear EscalationFrom".
    [InlineData(
        "[p][img src=\"{STEAM_CLAN_IMAGE}/4649813/a3867a2c10e6a28659b9964c123c5d4b07f5e333.jpg\"][/img][/p][h2][b]"
        + "Aircraft[/b][/h2][list][*][p][b]Hornet (all variants)[/b] — a bug that caused the thrust of the engine to "
        + "decrease while WEP was activated has been fixed. ([b][url=\"https://community.gaijin.net/issues/p/"
        + "warthunder/i/z9PtlWcji21J\"]Report[/url][/b]).[/p][/*][/list][h2][b]Nuclear Escalation[/b][/h2]",
        "Aircraft Hornet (all variants) — a bug that caused the thrust of the engine to decrease while WEP was "
        + "activated has been fixed. (Report). Nuclear Escalation")]
    // Apex Legends, "An Update from the Anti-Cheat Team - 11/19/2026" (1849827110430249): "Anti-Cheat UpdateWe".
    [InlineData(
        "[p][img src=\"{STEAM_CLAN_IMAGE}/38098458/0d7c5d1311e5ddb8524c3c2d938c02b919efe29e.png\"][/img][/p][p][b]"
        + "Anti-Cheat Update[/b][/p][p]We want to acknowledge two issues that recently impacted some players.[/p]",
        "Anti-Cheat Update We want to acknowledge two issues that recently impacted some players.")]
    // Apex Legends, "Apex Legends: Latest Update 11/16/2026" (1849827110426441), whole: "FIXED:Resolved".
    [InlineData(
        "[p][img src=\"{STEAM_CLAN_IMAGE}/38098458/c52c1d115036fc56ac832bf9f3764e3d52e89aa3.jpg\"][/img][/p][p]FIXED:"
        + "[/p][p]Resolved an issue causing Alter, Seer and Wattson Upgrades being misplaced in their upgrade trees.[/p]",
        "FIXED: Resolved an issue causing Alter, Seer and Wattson Upgrades being misplaced in their upgrade trees.")]
    // Counter-Strike 2, "Counter-Strike 2 Update" (1849827110426557): "\CobblestoneFixed … long AFixed". The
    // heading is a bracket the post escaped, which is text.
    [InlineData(
        "[p]\\[ MAPS ][/p][p]Cobblestone[/p][list][*][p]Fixed some walkable ledges in long A[/p][/*][*][p]Fixed map "
        + "issue that was loading an empty skybox[/p][/*]",
        "[ MAPS ] Cobblestone Fixed some walkable ledges in long A Fixed map issue that was loading an empty skybox")]
    public void ToExcerpt_BlocksInABody_BecomeWordBoundaries(string contents, string expected)
        => Assert.Equal(expected, SteamNewsService.ToExcerpt(contents));

    [Fact]
    public void ToExcerpt_WordMarkedInsideALine_KeepsItsNeighbours()
    {
        // AppID 252490, "LIVESTOCK" (1845383656383226): a name marked as code inside a sentence.
        var result = SteamNewsService.ToExcerpt(
            "Server admins can change this behaviour via convars [c]vehicle.padrepairsrequired[/c] (if false");

        Assert.Equal("Server admins can change this behaviour via convars vehicle.padrepairsrequired (if false", result);
    }

    [Fact]
    public void ToExcerpt_ImageWithALongStyle_IsDroppedWhole()
    {
        // AppID 252490, "PRINTED AND POLISHED" (1848664643342609): an [img] whose attributes run to over 400
        // characters, past the bound a tag had before.
        var result = SteamNewsService.ToExcerpt(
            "Puzzle rooms and harder content will still be the fastest way to progress.[/p][p][img src=\"https://files"
            + ".facepunch.com/rin/2026/November/02_15-14-HonestOcelot.jpg\" style=\"box-sizing: inherit; cursor: pointer; "
            + "box-shadow: rgba(0, 0, 0, 0.3) 0px 5px 15px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, "
            + "0.2); transition: 0.2s; transform: scale(1); max-width: 100%; display: block; margin: 16px auto;\"][/img]"
            + "[/p][p]Workbench upgrades which affected scrap used on the tech tree have also been reworked.");

        Assert.Equal(
            "Puzzle rooms and harder content will still be the fastest way to progress. Workbench upgrades which "
            + "affected scrap used on the tech tree have also been reworked.",
            result);
    }

    [Fact]
    public void ToExcerpt_Video_IsDroppedWhole()
    {
        // Counter-Strike 2, "The Cobbled Road to Singapore" (1849827110421973), its opening.
        var result = SteamNewsService.ToExcerpt(
            "[video webm=\"https://clan.fastly.steamstatic.com/images/3381077/cbaf2e646b6b20b7c1c1c27d30e76732fbe60b26"
            + ".webm\" mp4=\"https://clan.fastly.steamstatic.com/images/3381077/dec767ae6d99eb5782d0975a4627a51ca7f7931b"
            + ".mp4\" poster=\"https://clan.fastly.steamstatic.com/images/3381077/8e96d2f497ad35d8e7919ee24cfc3c97ebde0dff"
            + ".png\" autoplay=\"true\" controls=\"false\"][/video]\n\nToday's update features the return of a legendary "
            + "map. Welcome back, Cobblestone!");

        Assert.Equal("Today's update features the return of a legendary map. Welcome back, Cobblestone!", result);
    }

    [Fact]
    public void ToExcerpt_EscapedBracket_IsKeptWithoutItsBackslash()
    {
        // AppID 1938090, "Modern Warfare 4 Progression and Prestige" (1846651706691566).
        Assert.Equal("Those are [CLASSIFIED].", SteamNewsService.ToExcerpt("Those are \\[CLASSIFIED].[/p]"));
    }

    [Theory]
    // Bloons TD 6, "Update 56.0!" (1840310314340464): a label the post wrote in plain brackets.
    [InlineData(
        "[list][*][Frontier] Full Strength Posse - Have a full Posse of 6[/*][*][Frontier] Gon' Fishin' - Catch 30 "
        + "Fish[/*]",
        "[Frontier] Full Strength Posse - Have a full Posse of 6 [Frontier] Gon' Fishin' - Catch 30 Fish")]
    // Bloons TD 6, "Bloons TD 6 - Update 53.0!" (1824459501605428): one that begins like the tag [p].
    [InlineData(
        "[list][*][PC] Resolved an issue which could prevent the FPS cap from applying in all case",
        "[PC] Resolved an issue which could prevent the FPS cap from applying in all case")]
    public void ToExcerpt_BracketedWordThatIsNoTag_IsKept(string contents, string expected)
        => Assert.Equal(expected, SteamNewsService.ToExcerpt(contents));

    [Fact]
    public void ToExcerpt_TagsInCapitals_AreTagsToo()
    {
        // No post read wrote one, but the expression before this one took tags in either case.
        Assert.Equal("Patch 1.2 Fixed a crash.", SteamNewsService.ToExcerpt("[H2]Patch 1.2[/H2][B]Fixed[/B] a crash."));
    }

    [Fact]
    public void ToExcerpt_AttributeNameWithAHyphenOrADigit_IsStillATag()
    {
        var result = SteamNewsService.ToExcerpt("[p data-align=\"center\"]Centred text[/p][td col2=\"1\"]Next[/td]");

        Assert.Equal("Centred text Next", result);
    }

    [Fact]
    public void ToExcerpt_TextOnlyPastTheScanCap_IsNotRead()
    {
        // Nothing past MaxBodyScanned is read, so a body whose only text lies beyond it has no excerpt.
        var result = SteamNewsService.ToExcerpt(
            "[p]" + new string(' ', SteamNewsService.MaxBodyScanned) + "Text past the cap.");

        Assert.Null(result);
    }

    // Then the blurbs Steam answered before the service asked for the body: no tags left in them, but the
    // address an [img] held. The rule that removes it stays, for an address outside any block.

    [Theory]
    // Team Fortress 2, "Jump Fortress Jump4Charity" (gid 1849827110436900), as the home page led with it.
    [InlineData(
        "{STEAM_CLAN_LOC_IMAGE}/554111/818ccba597a4ec4630b160a280b4ea5137172268.jpg For the past few years, "
        + "the Jump Fortress crew have hosted rocket and sticky jumping tournaments, and they're proud to "
        + "announce their very own charity event in support of Doctors Without Borders! Jump4Charity will "
        + "take place over two days, November 28th (",
        "For the past few years, the Jump Fortress crew have hosted rocket and sticky jumping tournaments, "
        + "and they're proud to announce their very own charity event in support of Doctors…")]
    // PUBG: Battlegrounds, "PUBG: BATTLEGROUNDS Weekly Bans Notice (11/9~11/15)" (1849827110423012), whole.
    [InlineData(
        "{STEAM_CLAN_IMAGE}/27971017/6665b8db8893f3f61b8adffd82c7fa3705dd09be.png Read the full announcement here!",
        "Read the full announcement here!")]
    // War Thunder, "Screenshot Competition – Rocket Science!" (1849827110434745).
    [InlineData(
        "{STEAM_CLAN_IMAGE}/4649813/d66fbf64694823ff8108572f51a5f97fb097c0db.png Welcome to the 251st War "
        + "Thunder Steam Screenshot Competition!",
        "Welcome to the 251st War Thunder Steam Screenshot Competition!")]
    public void ToExcerpt_BlurbOpeningOnAPlaceholder_DropsIt(string contents, string expected)
        => Assert.Equal(expected, SteamNewsService.ToExcerpt(contents));

    [Fact]
    public void ToExcerpt_PlaceholderCutShort_IsDropped()
    {
        // R.E.P.O., "Did someone say "R.E.P.O. MERCH"???" (1825727806710964): the blurb ends at its
        // length, inside the address, and Steam marks the cut.
        var result = SteamNewsService.ToExcerpt(
            "Merch Video! Pin Set! Robe Vinyl Figurine! "
            + "{STEAM_CLAN_IMAGE}/45481982/b003d4fcb83a453eb29ec11c818d8967ade37b63.pn...");

        Assert.Equal("Merch Video! Pin Set! Robe Vinyl Figurine!", result);
    }

    [Fact]
    public void ToExcerpt_ImageAddressBesideLinks_DropsOnlyTheImage()
    {
        // Stardew Valley, "Stardew Valley x Fangamer Merch Holiday Sale" (1783238125358744): an [img]
        // around an address on Steam's image host, after two links that are part of the news.
        var result = SteamNewsService.ToExcerpt(
            "US: https://fanga.me/r/stardew-valley-holidays-2024-us EU: https://fanga.me/r/stardew-valley-holidays-2024-eu "
            + "https://clan.fastly.steamstatic.com/images/11170746/b330e52f09019fa1242b6bb9b97b810e523ddca9.png ");

        Assert.Equal(
            "US: https://fanga.me/r/stardew-valley-holidays-2024-us EU: https://fanga.me/r/stardew-valley-holidays-2024-eu",
            result);
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

public class CondenseTests
{
    private static readonly SteamNewsItem Item = new(
        "1849827110430249",
        "An Update from the Anti-Cheat Team - 11/19/2026",
        "https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1849827110430249",
        "author",
        "[p][b]Anti-Cheat Update[/b][/p][p]We want to acknowledge two issues that recently impacted some players.[/p]",
        "Community Announcements",
        "steam_community_announcements",
        1_700_000_000);

    [Fact]
    public void Condense_ABody_KeepsItsExcerptInItsPlace()
    {
        var kept = SteamNewsService.Condense(Item, SteamNewsService.ToExcerpt, NullLogger.Instance, 1172470);

        Assert.Equal(
            new SteamNewsService.CachedItem(
                Item.Gid, Item.Title, Item.Url, Item.FeedLabel, Item.Date,
                "Anti-Cheat Update We want to acknowledge two issues that recently impacted some players."),
            kept);
    }

    [Fact]
    public void Condense_ExcerptTimesOut_KeepsTheItemWithoutOne()
    {
        // One body the expressions cannot finish in time costs its own excerpt, not the feed it came in.
        var kept = SteamNewsService.Condense(
            Item,
            _ => throw new RegexMatchTimeoutException("[p]", @"\[", TimeSpan.FromMilliseconds(200)),
            NullLogger.Instance,
            1172470);

        Assert.Null(kept.Excerpt);
        Assert.Equal(Item.Title, kept.Title);
        Assert.Equal(Item.Url, kept.Url);
    }
}

public class MapToDtoTests
{
    private static readonly GameDto Game = new(
        1020, "Grand Theft Auto V", null, null, "https://img/cover.jpg", null, null, null,
        null, null, null, null, null,
        Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    private static SteamNewsService.CachedItem Item(
        string? gid = "g1",
        string? title = "Update released",
        string? url = "https://store.steampowered.com/news/1",
        long date = 1_700_000_000) =>
        new(gid, title, url, "Community Announcements", date, "The excerpt.");

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
        Assert.Equal("The excerpt.", dto.Excerpt);
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
        var item = new SteamNewsService.CachedItem("g1", "T", "https://u", null, 1_700_000_000, null);

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
