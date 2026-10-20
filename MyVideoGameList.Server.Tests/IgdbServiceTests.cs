using System.Net;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models.Igdb;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

public class BuildQueryTests
{
    [Fact]
    public void WithoutSearch_SortsByAggregatedRating()
    {
        var query = IgdbService.BuildQuery(offset: 40, limit: 20, search: null);

        Assert.Contains("sort aggregated_rating desc;", query);
        Assert.DoesNotContain("search ", query);
        Assert.Contains("limit 20;", query);
        Assert.Contains("offset 40;", query);
    }

    [Fact]
    public void WithoutSearch_RequiresEnoughCriticsForTheSortToMeanAnything()
    {
        var query = IgdbService.BuildQuery(offset: 0, limit: 20, search: null);

        Assert.Contains("where aggregated_rating_count >= 8;", query);
    }

    [Fact]
    public void WithSearch_DoesNotFilterOnCriticCount()
    {
        // A search must reach the whole catalogue, including thinly reviewed games. The count is
        // still requested as a field — it is the `where` clause that must be absent.
        var query = IgdbService.BuildQuery(0, 20, "undertale");

        Assert.DoesNotContain("where aggregated_rating_count", query);
    }

    [Fact]
    public void WithSearch_UsesSearchAndDropsTheSort()
    {
        var query = IgdbService.BuildQuery(0, 20, "elden ring");

        Assert.Contains("search \"elden ring\";", query);
        Assert.DoesNotContain("sort aggregated_rating", query);
    }

    [Fact]
    public void WithWhitespaceSearch_FallsBackToSort()
    {
        var query = IgdbService.BuildQuery(0, 20, "   ");

        Assert.Contains("sort aggregated_rating desc;", query);
        Assert.Contains("where aggregated_rating_count >= 8;", query);
        Assert.DoesNotContain("search ", query);
    }

    [Theory]
    [InlineData("hal\"o", "search \"hal\\\"o\";")]
    [InlineData("back\\slash", "search \"back\\\\slash\";")]
    public void EscapesApicalypseInjectionCharacters(string search, string expected)
        => Assert.Contains(expected, IgdbService.BuildQuery(0, 20, search));

    // ── Orders and filters (ADR 0032) ─────────────────────────────────────────────────

    private static readonly DateTimeOffset Now = new(2026, 9, 15, 12, 0, 0, TimeSpan.Zero);

    private static string Browse(GameBrowseQuery browse, string? search = null) =>
        IgdbService.BuildQuery(0, 20, search, browse, Now);

    /// <summary>The query's one <c>where</c> clause, split into its conditions.</summary>
    private static string[] Conditions(string query)
    {
        var line = query.Split('\n').Select(l => l.Trim()).SingleOrDefault(l => l.StartsWith("where "));
        return line is null ? [] : line["where ".Length..].TrimEnd(';').Split(" & ");
    }

    [Fact]
    public void Popular_RanksByRatingsHeld_WithTheListedFloorAndNoCritic()
    {
        // No critic required: a game players rated heavily and no outlet reviewed belongs near the top.
        var query = Browse(new GameBrowseQuery(GameSortKeys.Popular));

        Assert.Contains("sort total_rating_count desc;", query);
        Assert.Equal(["total_rating_count >= 10"], Conditions(query));
    }

    [Fact]
    public void Newest_IsReleasedGamesSomebodyNoticed_NewestFirst()
    {
        var query = Browse(new GameBrowseQuery(GameSortKeys.Newest));

        Assert.Contains("sort first_release_date desc;", query);
        Assert.Equal(
            [$"first_release_date <= {Now.ToUnixTimeSeconds()}", "total_rating_count >= 10", "aggregated_rating_count >= 1"],
            Conditions(query));
    }

    [Fact]
    public void Name_TakesBothFloors_AToZ()
    {
        var query = Browse(new GameBrowseQuery(GameSortKeys.Name));

        Assert.Contains("sort name asc;", query);
        Assert.Equal(["total_rating_count >= 10", "aggregated_rating_count >= 1"], Conditions(query));
    }

    [Fact]
    public void Rating_IsStillTheDefault_WithItsCriticFloor()
    {
        var query = Browse(GameBrowseQuery.Default);

        Assert.Contains("sort aggregated_rating desc;", query);
        Assert.Equal(["aggregated_rating_count >= 8"], Conditions(query));
    }

    [Fact]
    public void Filters_NarrowTheOrderWithoutReplacingItsFloor()
    {
        var query = Browse(new GameBrowseQuery(GameSortKeys.Popular, PlatformId: 130, GenreId: 12));

        Assert.Equal(["platforms = (130)", "genres = (12)", "total_rating_count >= 10"], Conditions(query));
    }

    [Fact]
    public void Year_IsTheWholeCalendarYearInUtc()
    {
        var query = Browse(new GameBrowseQuery(Year: 2024));

        // 2024-01-01T00:00:00Z and 2025-01-01T00:00:00Z, the second exclusive.
        Assert.Contains("first_release_date >= 1704067200", Conditions(query));
        Assert.Contains("first_release_date < 1735689600", Conditions(query));
    }

    [Fact]
    public void MinScore_BringsTheCriticFloorWithIt_Once()
    {
        // Without the count, "80 and above" is every game a single critic loved. The rating order asks
        // for the same floor, and the clause is not repeated.
        var query = Browse(new GameBrowseQuery(MinScore: 80));

        Assert.Equal(["aggregated_rating >= 80", "aggregated_rating_count >= 8"], Conditions(query));
    }

    [Fact]
    public void MinScore_UnderAnotherOrder_StillBringsTheCriticFloor()
    {
        var query = Browse(new GameBrowseQuery(GameSortKeys.Newest, MinScore: 90));

        Assert.Contains("aggregated_rating >= 90", Conditions(query));
        Assert.Contains("aggregated_rating_count >= 8", Conditions(query));
    }

    [Fact]
    public void Search_KeepsTheFiltersButDropsTheOrderAndItsFloor()
    {
        // IGDB answers a search that carries a sort with a 406, and a search must reach thinly rated
        // games too — so the order's floor goes with the order.
        var query = Browse(new GameBrowseQuery(GameSortKeys.Popular, PlatformId: 130), search: "zelda");

        Assert.Contains("search \"zelda\";", query);
        Assert.DoesNotContain("sort ", query);
        Assert.Equal(["platforms = (130)"], Conditions(query));
    }

    [Fact]
    public void Search_WithNoFilters_HasNoWhereClause()
    {
        Assert.Empty(Conditions(Browse(new GameBrowseQuery(GameSortKeys.Name), search: "hades")));
    }
}

public class MapEsrbRatingTests
{
    private const int Esrb = 1;

    private static IgdbAgeRating Rating(int? organization, int? ratingCategory) =>
        new(1, organization, ratingCategory);

    [Theory]
    [InlineData(1, "RP")]
    [InlineData(2, "EC")]
    [InlineData(3, "E")]
    [InlineData(4, "E10+")]
    [InlineData(5, "T")]
    [InlineData(6, "M")]
    [InlineData(7, "AO")]
    public void WithAnEsrbRating_MapsItsCategoryToTheShortCode(int ratingCategory, string expected)
        => Assert.Equal(expected, IgdbService.MapEsrbRating([Rating(Esrb, ratingCategory)]));

    [Fact]
    public void AmongEveryBoardsRatings_ReadsTheEsrbRow()
    {
        // The Witcher 3's rows in the order live IGDB returned them, ESRB last. The organization and
        // ESRB category ids share a range, so reading the wrong field of the right row still yields
        // a plausible code — "RP" — rather than failing.
        var result = IgdbService.MapEsrbRating([
            Rating(7, 38), Rating(2, 12), Rating(3, 17), Rating(6, 32),
            Rating(4, 22), Rating(5, 26), Rating(Esrb, 6)
        ]);

        Assert.Equal("M", result);
    }

    [Fact]
    public void WithOnlyOtherBoards_ReturnsNull()
        => Assert.Null(IgdbService.MapEsrbRating([Rating(organization: 2, ratingCategory: 12)]));

    [Theory]
    [InlineData(0)]
    [InlineData(8)]
    [InlineData(null)]
    public void WithAnUnknownCategory_ReturnsNull(int? ratingCategory)
        => Assert.Null(IgdbService.MapEsrbRating([Rating(Esrb, ratingCategory)]));

    [Fact]
    public void WithNoAgeRatings_ReturnsNull()
    {
        Assert.Null(IgdbService.MapEsrbRating(null));
        Assert.Null(IgdbService.MapEsrbRating([]));
    }
}

/// <summary>
/// IGDB behind a stub: the token request answered, the games endpoint answered with a payload of IGDB's
/// own JSON, and every other endpoint with no rows.
/// </summary>
internal sealed class StubIgdb(string gamesPayload) : HttpMessageHandler
{
    private const string TokenPayload =
        """{ "access_token": "token", "expires_in": 3600, "token_type": "bearer" }""";

    /// <summary>The last Apicalypse query the service sent to the games endpoint.</summary>
    public string? Query { get; private set; }

    /// <summary>A service that asks this stub, with a cache of its own.</summary>
    public IgdbService NewService()
    {
        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient("Igdb").Returns(_ => new HttpClient(this, disposeHandler: false));

        var configuration = Substitute.For<IConfiguration>();
        configuration["Igdb:ClientId"].Returns("client-id");
        configuration["Igdb:ClientSecret"].Returns("client-secret");

        return new IgdbService(
            factory, configuration, new MemoryCache(new MemoryCacheOptions()),
            NullLogger<IgdbService>.Instance);
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.RequestUri?.Host == "id.twitch.tv") return Json(TokenPayload);

        var query = await request.Content!.ReadAsStringAsync(cancellationToken);
        if (request.RequestUri?.AbsolutePath != "/v4/games") return Json("[]");

        Query = query;
        return Json(gamesPayload);
    }

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
}

/// <summary>
/// The listing against a stubbed IGDB, over the two joints a mapping test cannot see: the fields the
/// query actually asks for, and the binding from IGDB's own JSON onto the model. The ESRB bug lived
/// in exactly that gap — correct C# over fields the query no longer asked for — and every test that
/// built an <see cref="IgdbAgeRating"/> by hand passed throughout.
/// </summary>
public class GetGamesAsyncTests
{
    /// <summary>
    /// The Witcher 3's age ratings and websites as live IGDB returned them, under the fields it returns
    /// today. Organization 1 is the ESRB and its rating category 6 is "M"; website type 1 is "Official
    /// Website", listed after its Facebook page (4), Wikipedia (3) and Steam (13).
    /// </summary>
    private const string GamesPayload = """
        [
          {
            "id": 1942,
            "name": "The Witcher 3: Wild Hunt",
            "age_ratings": [
              { "id": 222156, "organization": 7, "rating_category": 38 },
              { "id": 32441, "organization": 2, "rating_category": 12 },
              { "id": 67455, "organization": 3, "rating_category": 17 },
              { "id": 78139, "organization": 6, "rating_category": 32 },
              { "id": 46963, "organization": 4, "rating_category": 22 },
              { "id": 78138, "organization": 5, "rating_category": 26 },
              { "id": 187952, "organization": 1, "rating_category": 6 }
            ],
            "websites": [
              { "id": 19103, "url": "https://www.facebook.com/CDPROJEKTRED", "type": 4 },
              { "id": 19102, "url": "https://en.wikipedia.org/wiki/The_Witcher_3:_Wild_Hunt", "type": 3 },
              { "id": 19107, "url": "https://store.steampowered.com/app/292030", "type": 13 },
              { "id": 66471, "url": "http://www.thewitcher.com", "type": 1 }
            ]
          }
        ]
        """;

    /// <summary>Lethal Company's websites as live IGDB returned them: it has no official site.</summary>
    private const string NoOfficialSitePayload = """
        [
          {
            "id": 212089,
            "name": "Lethal Company",
            "websites": [
              { "id": 499540, "url": "https://www.twitch.tv/directory/game/Lethal%20Company", "type": 6 },
              { "id": 301537, "url": "https://store.steampowered.com/app/1966720", "type": 13 },
              { "id": 599533, "url": "https://en.wikipedia.org/wiki/Lethal_Company", "type": 3 }
            ]
          }
        ]
        """;

    [Fact]
    public async Task WithAnyQuery_AsksForTheAgeRatingFieldsTheMappingReads()
    {
        // The removed `age_ratings.category,age_ratings.rating` answered 200 with rows holding only an
        // id, so the badge vanished with nothing logged. The same constant feeds the detail query.
        var igdb = new StubIgdb(GamesPayload);

        await igdb.NewService().GetGamesAsync();

        Assert.Contains("age_ratings.organization,age_ratings.rating_category", igdb.Query);
    }

    [Fact]
    public async Task WithIgdbsOwnJson_BindsTheAgeRatingsThroughToTheEsrbCode()
    {
        // The half no mapping test reaches: snake_case onto Organization and RatingCategory. Misname
        // either and EsrbRating is null again while every MapEsrbRating test still passes.
        var games = await new StubIgdb(GamesPayload).NewService().GetGamesAsync();

        Assert.Equal("M", Assert.Single(games.Items).EsrbRating);
    }

    [Fact]
    public async Task WithAnyQuery_AsksForTheWebsiteTypeNotTheRemovedCategory()
    {
        // `websites.category` went the way of the age ratings' fields: asked for, it is simply left out,
        // and every game's official site became whichever link IGDB happened to list first.
        var igdb = new StubIgdb(GamesPayload);

        await igdb.NewService().GetGamesAsync();

        Assert.Contains("websites.url,websites.type", igdb.Query);
        Assert.DoesNotContain("websites.category", igdb.Query);
    }

    [Fact]
    public async Task WithAnyQuery_LeavesTheExternalGamesToTheDetailQuery()
    {
        // ADR 0017. A game's external_games carry a row per regional retail listing — Elden Ring has 49
        // from Amazon — and only the game page's store links read any of them.
        var igdb = new StubIgdb(GamesPayload);

        await igdb.NewService().GetGamesAsync();

        // DoesNotContain passes on a null, which a listing that stopped asking the games endpoint would be.
        Assert.NotNull(igdb.Query);
        Assert.DoesNotContain("external_games", igdb.Query);
    }

    [Fact]
    public async Task WithIgdbsOwnJson_TakesTheOfficialWebsiteOverTheLinksListedBeforeIt()
    {
        var games = await new StubIgdb(GamesPayload).NewService().GetGamesAsync();

        Assert.Equal("http://www.thewitcher.com/", Assert.Single(games.Items).Website);
    }

    [Fact]
    public async Task WithNoOfficialWebsite_HasNoWebsiteRatherThanAnotherLink()
    {
        // The page calls this link "Official Site". A Wikipedia article or a store page under that name
        // is a wrong answer, where no link is an honest one.
        var games = await new StubIgdb(NoOfficialSitePayload).NewService().GetGamesAsync();

        Assert.Null(Assert.Single(games.Items).Website);
    }

    [Fact]
    public async Task WithSeveralOfficialWebsites_TakesTheOldestThatIsAWebAddress()
    {
        // Made up: IGDB's rows carry one official site each for the games looked at. In id order, so the
        // answer does not follow IGDB's listing order, and past one that is no address at all.
        const string payload = """
            [
              {
                "id": 1942,
                "name": "The Witcher 3: Wild Hunt",
                "websites": [
                  { "id": 3, "url": "https://www.thewitcher.com/en/witcher3", "type": 1 },
                  { "id": 2, "url": "https://thewitcher.com", "type": 1 },
                  { "id": 1, "url": "www.thewitcher.com", "type": 1 }
                ]
              }
            ]
            """;

        var games = await new StubIgdb(payload).NewService().GetGamesAsync();

        Assert.Equal("https://thewitcher.com/", Assert.Single(games.Items).Website);
    }

    [Fact]
    public async Task WithIgdbsOwnJson_CarriesNoDetails()
    {
        var games = await new StubIgdb(GamesPayload).NewService().GetGamesAsync();

        Assert.Null(Assert.Single(games.Items).Details);
    }
}

/// <summary>
/// The game page's query against a stubbed IGDB, over the same two joints as the listing's: the
/// fields asked for, and IGDB's own JSON bound through to the store links.
/// </summary>
public class GetGameByIdAsyncTests
{
    /// <summary>
    /// The Witcher 3's websites and external games as live IGDB returned them on 2026-10-17, under the
    /// fields the detail query asks for. Every store it is sold on has a website row, which wins, so this
    /// binds the websites; <see cref="MonumentValleyPayload"/> binds the synced rows. Source 20 is Amazon,
    /// 14 Twitch, 3 GiantBomb, 10 YouTube.
    /// </summary>
    private const string WitcherPayload = """
        [
          {
            "id": 1942,
            "name": "The Witcher 3: Wild Hunt",
            "websites": [
              { "id": 19103, "url": "https://www.facebook.com/CDPROJEKTRED", "type": 4 },
              { "id": 141346, "url": "https://www.epicgames.com/store/en-US/product/the-witcher-3-wild-hunt/home", "type": 16 },
              { "id": 793706, "url": "https://www.xbox.com/en-us/games/store/the-witcher-3-wild-hunt/BR765873CQJD", "type": 22 },
              { "id": 793707, "url": "https://store.playstation.com/en-us/concept/204794", "type": 23 },
              { "id": 793708, "url": "https://www.nintendo.com/games/detail/the-witcher-3-wild-hunt-switch/", "type": 24 },
              { "id": 19102, "url": "https://en.wikipedia.org/wiki/The_Witcher_3:_Wild_Hunt", "type": 3 },
              { "id": 19107, "url": "https://store.steampowered.com/app/292030", "type": 13 },
              { "id": 66471, "url": "http://www.thewitcher.com", "type": 1 },
              { "id": 119948, "url": "https://www.gog.com/game/the_witcher_3_wild_hunt", "type": 17 },
              { "id": 19101, "url": "http://witcher.wikia.com/wiki/The_Witcher_3:_Wild_Hunt", "type": 2 },
              { "id": 19104, "url": "https://twitter.com/witchergame", "type": 5 },
              { "id": 78076, "url": "https://www.reddit.com/r/witcher", "type": 14 },
              { "id": 19105, "url": "https://www.instagram.com/cdpred", "type": 8 },
              { "id": 19106, "url": "https://www.youtube.com/user/WitcherGame", "type": 9 },
              { "id": 512145, "url": "https://www.twitch.tv/directory/game/The%20Witcher%203:%20Wild%20Hunt", "type": 6 },
              { "id": 670803, "url": "https://discord.gg/thewitcher", "type": 18 }
            ],
            "external_games": [
              { "id": 2176359, "url": "https://store.playstation.com/en-us/concept/204794", "external_game_source": 36 },
              { "id": 211029, "url": "https://www.xbox.com/en-us/games/store/the-witcher-3-wild-hunt/BR765873CQJD", "external_game_source": 11 },
              { "id": 246257, "url": "https://www.twitch.tv/directory/game/The Witcher 3: Wild Hunt", "external_game_source": 14 },
              { "id": 1937739, "external_game_source": 20 },
              { "id": 1931970, "external_game_source": 20 },
              { "id": 11306, "url": "https://store.steampowered.com/app/292030", "external_game_source": 1 },
              { "id": 78478, "url": "https://www.gog.com/en/game/the_witcher_3_wild_hunt", "external_game_source": 5 },
              { "id": 2067884, "url": "https://www.gog.com/en/game/the_witcher_3_wild_hunt", "external_game_source": 5 },
              { "id": 119254, "url": "https://www.giantbomb.com/games/3030-41484/", "external_game_source": 3 },
              { "id": 189745, "url": "https://gaming.youtube.com/game/UCprFOIVpCqQLUMsWBNwt0PQ", "external_game_source": 10 },
              { "id": 1928370, "url": "https://amazon.com/dp/B07SH3D6HT", "external_game_source": 20 }
            ]
          }
        ]
        """;

    /// <summary>
    /// Monument Valley's websites and external games as live IGDB returned them on 2026-10-17, under the
    /// fields the detail query asks for. Its Steam page is a website row, but the PlayStation Store and
    /// the Microsoft Store are only in its synced rows. Source 15 is Android and 13 Apple.
    /// </summary>
    private const string MonumentValleyPayload = """
        [
          {
            "id": 8900,
            "name": "Monument Valley",
            "websites": [
              { "id": 868148, "url": "https://monumentvalley.fandom.com/wiki/Monument_Valley_Wiki", "type": 2 },
              { "id": 868149, "url": "https://x.com/ustwogames", "type": 5 },
              { "id": 868150, "url": "https://www.youtube.com/@ustwogames", "type": 9 },
              { "id": 868151, "url": "https://en.wikipedia.org/wiki/Monument_Valley_(video_game)", "type": 3 },
              { "id": 868152, "url": "https://www.reddit.com/r/MonumentValley", "type": 14 },
              { "id": 868153, "url": "https://bsky.app/profile/ustwogames.co.uk", "type": 19 },
              { "id": 336403, "url": "https://www.twitch.tv/directory/game/Monument%20Valley", "type": 6 },
              { "id": 1120066, "url": "https://play.google.com/store/apps/details?id=com.ustwo.monumentvalley", "type": 12 },
              { "id": 1120067, "url": "https://apps.apple.com/us/app/monument-valley/id728293409", "type": 10 },
              { "id": 1120068, "url": "https://www.facebook.com/monumentvalleygame", "type": 4 },
              { "id": 1120065, "url": "https://store.steampowered.com/app/1927720", "type": 13 },
              { "id": 1120069, "url": "https://www.instagram.com/ustwogames", "type": 8 },
              { "id": 1120070, "url": "https://discord.gg/p6jM2AHahc", "type": 18 },
              { "id": 1063380, "url": "https://www.monumentvalleygame.com/mv1", "type": 1 }
            ],
            "external_games": [
              { "id": 352303, "url": "https://play.google.com/store/apps/details?id=com.ustwo.monumentvalley", "external_game_source": 15 },
              { "id": 188977, "url": "https://gaming.youtube.com/game/UC8rvuMtGNc9e9gqTzSihE5w", "external_game_source": 10 },
              { "id": 115158, "url": "https://www.giantbomb.com/games/3030-45914/", "external_game_source": 3 },
              { "id": 249262, "url": "https://www.twitch.tv/directory/game/Monument Valley", "external_game_source": 14 },
              { "id": 224878, "url": "https://itunes.apple.com/us/app/monument-valley/id728293409?mt=8&uo=4", "external_game_source": 13 },
              { "id": 3001204, "url": "https://www.xbox.com/en-us/games/store/monument-valley/9NT17X2MR55H", "external_game_source": 11 },
              { "id": 2995315, "url": "https://store.playstation.com/en-us/concept/10013172", "external_game_source": 36 }
            ]
          }
        ]
        """;

    [Fact]
    public async Task WithAnyId_AsksForTheFieldsTheStoreLinksRead()
    {
        var igdb = new StubIgdb(WitcherPayload);

        await igdb.NewService().GetGameByIdAsync(1942);

        Assert.Contains("websites.url,websites.type", igdb.Query);
        Assert.Contains("external_games.url,external_games.external_game_source", igdb.Query);
    }

    [Fact]
    public async Task WithIgdbsOwnJson_BindsTheWebsitesThroughToOneLinkPerStore()
    {
        // The half no mapping test reaches: `type` onto the model. Misname it and the row is empty on
        // every game page while every StoreLinks test still passes.
        var game = await new StubIgdb(WitcherPayload).NewService().GetGameByIdAsync(1942);

        Assert.NotNull(game);
        Assert.NotNull(game.Details);
        Assert.Equal(
            [
                new StoreLinkDto("Steam", "https://store.steampowered.com/app/292030"),
                new StoreLinkDto("GOG", "https://www.gog.com/game/the_witcher_3_wild_hunt"),
                new StoreLinkDto("Epic Games Store", "https://www.epicgames.com/store/en-US/product/the-witcher-3-wild-hunt/home"),
                new StoreLinkDto("PlayStation Store", "https://store.playstation.com/en-us/concept/204794"),
                new StoreLinkDto("Microsoft Store", "https://www.xbox.com/en-us/games/store/the-witcher-3-wild-hunt/BR765873CQJD"),
                new StoreLinkDto("Nintendo eShop", "https://www.nintendo.com/games/detail/the-witcher-3-wild-hunt-switch/"),
            ],
            game.Details.Stores);
    }

    [Fact]
    public async Task WithIgdbsOwnJson_BindsTheSyncedRowsThroughToTheStoresOnlyTheyName()
    {
        // The other half: `external_games`, its `url` and its `external_game_source` onto the model.
        // Misname any of them and these two stores vanish from every page that has no website row for
        // them, while every StoreLinks test still passes.
        var game = await new StubIgdb(MonumentValleyPayload).NewService().GetGameByIdAsync(8900);

        Assert.NotNull(game);
        Assert.NotNull(game.Details);
        Assert.Equal(
            [
                new StoreLinkDto("Steam", "https://store.steampowered.com/app/1927720"),
                new StoreLinkDto("PlayStation Store", "https://store.playstation.com/en-us/concept/10013172"),
                new StoreLinkDto("Microsoft Store", "https://www.xbox.com/en-us/games/store/monument-valley/9NT17X2MR55H"),
            ],
            game.Details.Stores);
    }

    [Fact]
    public async Task WithIgdbsOwnJson_TakesTheOfficialWebsiteHereToo()
    {
        var game = await new StubIgdb(WitcherPayload).NewService().GetGameByIdAsync(1942);

        Assert.Equal("http://www.thewitcher.com/", game?.Website);
    }
}

public class MapTimeToBeatTests
{
    private static IgdbGameTimeToBeat Row(int? hastily, int? normally, int? completely, int? count) =>
        new(1, 100, hastily, normally, completely, count);

    [Fact]
    public void WithSubmissions_KeepsTheRawSeconds()
    {
        var result = IgdbService.MapTimeToBeat(Row(37 * 3600, 92 * 3600, 246 * 3600, 20));

        Assert.NotNull(result);
        Assert.Equal(37 * 3600, result.Hastily);
        Assert.Equal(92 * 3600, result.Normally);
        Assert.Equal(246 * 3600, result.Completely);
        Assert.Equal(20, result.Count);
    }

    [Fact]
    public void WithNoRow_ReturnsNull()
        => Assert.Null(IgdbService.MapTimeToBeat(null));

    [Theory]
    [InlineData(0)]
    [InlineData(null)]
    public void WithoutSubmissions_ReturnsNullBecauseAZeroCountAverageIsNotAnAverage(int? count)
        => Assert.Null(IgdbService.MapTimeToBeat(Row(3600, 7200, 10800, count)));

    [Fact]
    public void WithACountButNoTimes_ReturnsNull()
        => Assert.Null(IgdbService.MapTimeToBeat(Row(null, null, null, 5)));
}

public class FoldMultiplayerModesTests
{
    private static IgdbMultiplayerMode Mode(
        bool campaignCoop = false,
        bool dropIn = false,
        bool lanCoop = false,
        bool offlineCoop = false,
        bool onlineCoop = false,
        bool splitScreen = false,
        bool splitScreenOnline = false,
        int? offlineCoopMax = null,
        int? offlineMax = null,
        int? onlineCoopMax = null,
        int? onlineMax = null) =>
        new(1, campaignCoop, dropIn, lanCoop, offlineCoop, onlineCoop, splitScreen,
            splitScreenOnline, offlineCoopMax, offlineMax, onlineCoopMax, onlineMax);

    [Fact]
    public void WithNoRows_ReturnsNull()
    {
        Assert.Null(IgdbService.FoldMultiplayerModes(null));
        Assert.Null(IgdbService.FoldMultiplayerModes([]));
    }

    [Fact]
    public void AcrossPlatforms_ACapabilityCountsIfAnyPlatformOffersIt()
    {
        var result = IgdbService.FoldMultiplayerModes([
            Mode(onlineCoop: true),
            Mode(splitScreen: true)
        ]);

        Assert.NotNull(result);
        Assert.True(result.OnlineCoop);
        Assert.True(result.SplitScreen);
        Assert.False(result.LanCoop);
    }

    [Fact]
    public void AcrossPlatforms_TakesTheMostGenerousCeiling()
    {
        var result = IgdbService.FoldMultiplayerModes([
            Mode(onlineMax: 4),
            Mode(onlineMax: 16)
        ]);

        Assert.Equal(16, result!.OnlineMax);
    }

    [Fact]
    public void OnlineSplitScreenAlsoCountsAsSplitScreen()
        => Assert.True(IgdbService.FoldMultiplayerModes([Mode(splitScreenOnline: true)])!.SplitScreen);

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(null)]
    public void ACeilingOfOneOrLessIsTreatedAsUnknown(int? max)
    {
        // IGDB uses 0 and 1 for "not applicable" as often as for a real limit, and reporting
        // "up to 1 player" as a multiplayer ceiling is worse than saying nothing.
        var result = IgdbService.FoldMultiplayerModes([Mode(onlineMax: max)]);

        Assert.Null(result!.OnlineMax);
    }
}

public class MapLanguagesTests
{
    private static IgdbLanguageSupport Row(int id, string language, string supportType) =>
        new(id, new IgdbNamedEntity(id, language), new IgdbNamedEntity(id, supportType));

    [Fact]
    public void GroupsTheOneRowPerCombinationTableByLanguage()
    {
        var result = IgdbService.MapLanguages([
            Row(1, "French", "Interface"),
            Row(2, "French", "Subtitles"),
            Row(3, "Korean", "Interface")
        ]);

        Assert.Equal(2, result.Count);
        Assert.Equal("French", result[0].Language);
        Assert.Equal(["Interface", "Subtitles"], result[0].SupportTypes);
        Assert.Equal("Korean", result[1].Language);
    }

    [Fact]
    public void DropsRowsWithNoLanguageName()
    {
        var result = IgdbService.MapLanguages([
            new(1, null, new IgdbNamedEntity(1, "Audio")),
            Row(2, "German", "Audio")
        ]);

        Assert.Single(result);
        Assert.Equal("German", result[0].Language);
    }

    [Fact]
    public void WithNoRows_ReturnsEmpty()
    {
        Assert.Empty(IgdbService.MapLanguages(null));
        Assert.Empty(IgdbService.MapLanguages([]));
    }
}

public class MapToDetailsDtoTests
{
    private static IgdbGame Game(
        List<IgdbScreenshot>? screenshots = null,
        List<IgdbRelatedGame>? similar = null,
        IgdbRelatedGame? parent = null,
        List<IgdbNamedEntity>? themes = null) =>
        new(119133, "Elden Ring", null, null, null, null, screenshots, null, null,
            null, null, null, null, null, null, null, null, null,
            themes, null, null, null, null, null, null, null, similar, null, null, parent);

    [Fact]
    public void BuildsScreenshotUrlsFromImageIds()
    {
        var result = IgdbService.MapToDetailsDto(Game(screenshots: [new(1, "scagdo")]), null);

        Assert.Equal(
            ["https://images.igdb.com/igdb/image/upload/t_screenshot_big/scagdo.jpg"],
            result.Screenshots);
    }

    [Fact]
    public void CarriesRelatedGamesWithTheirCovers()
    {
        var result = IgdbService.MapToDetailsDto(
            Game(similar: [new(2155, "Dark Souls", new IgdbCover(1, "co1x78"))]), null);

        var similar = Assert.Single(result.SimilarGames);
        Assert.Equal(2155, similar.Id);
        Assert.Equal("Dark Souls", similar.Name);
        Assert.Equal("https://images.igdb.com/igdb/image/upload/t_cover_big/co1x78.jpg", similar.CoverImageUrl);
    }

    [Fact]
    public void DropsRelatedGamesWithNoName()
    {
        // An unnamed related game renders as a blank card and links nowhere useful.
        var result = IgdbService.MapToDetailsDto(Game(similar: [new(1, null, null)]), null);

        Assert.Empty(result.SimilarGames);
    }

    [Fact]
    public void WithNothingFromIgdb_ReturnsEmptyCollectionsRatherThanNulls()
    {
        var result = IgdbService.MapToDetailsDto(Game(), null);

        Assert.Empty(result.Screenshots);
        Assert.Empty(result.SimilarGames);
        Assert.Empty(result.Dlcs);
        Assert.Empty(result.Themes);
        Assert.Empty(result.Languages);
        Assert.Empty(result.Stores);
        Assert.Null(result.ParentGame);
        Assert.Null(result.TimeToBeat);
        Assert.Null(result.MultiplayerModes);
    }

    [Fact]
    public void FlattensNamedEntitiesToTheirNames()
    {
        var result = IgdbService.MapToDetailsDto(
            Game(themes: [new(1, "Fantasy"), new(2, null), new(3, "Open world")]), null);

        Assert.Equal(["Fantasy", "Open world"], result.Themes);
    }
}

public class GetGamesByIdsUncachedAsyncTests
{
    private const string TokenPayload =
        """{ "access_token": "token", "expires_in": 3600, "token_type": "bearer" }""";

    private const string GamesPayload = """[ { "id": 1942, "name": "The Witcher 3: Wild Hunt" } ]""";

    /// <summary>Answers the token request, then every query with one game, counting the queries.</summary>
    private sealed class CountingHandler : HttpMessageHandler
    {
        private int _queries;

        public int Queries => _queries;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri?.Host == "id.twitch.tv") return Task.FromResult(Json(TokenPayload));

            Interlocked.Increment(ref _queries);
            return Task.FromResult(Json(GamesPayload));
        }

        private static HttpResponseMessage Json(string body) =>
            new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    }

    private static (IgdbService Service, CountingHandler Igdb) NewService()
    {
        var handler = new CountingHandler();

        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient("Igdb").Returns(_ => new HttpClient(handler, disposeHandler: false));

        var configuration = Substitute.For<IConfiguration>();
        configuration["Igdb:ClientId"].Returns("client-id");
        configuration["Igdb:ClientSecret"].Returns("client-secret");

        var service = new IgdbService(
            factory, configuration, new MemoryCache(new MemoryCacheOptions()),
            NullLogger<IgdbService>.Instance);

        return (service, handler);
    }

    [Fact]
    public async Task GetGamesByIdsUncachedAsync_AskedTwiceForTheSameIds_AsksIgdbTwice()
    {
        // The background refresh is there for a fresh answer, and its id sets never repeat. Through
        // the remembered lookup every batch would sit in memory for half an hour (ADR 0052).
        var (service, igdb) = NewService();

        await service.GetGamesByIdsUncachedAsync([1942]);
        var games = await service.GetGamesByIdsUncachedAsync([1942]);

        Assert.Equal(2, igdb.Queries);
        Assert.Equal("The Witcher 3: Wild Hunt", Assert.Single(games).Title);
    }

    [Fact]
    public async Task GetGamesByIdsAsync_AskedTwiceForTheSameIds_AsksIgdbOnce()
    {
        // The contrast that gives the test above its meaning: the ordinary lookup remembers.
        var (service, igdb) = NewService();

        await service.GetGamesByIdsAsync([1942]);
        await service.GetGamesByIdsAsync([1942]);

        Assert.Equal(1, igdb.Queries);
    }
}
