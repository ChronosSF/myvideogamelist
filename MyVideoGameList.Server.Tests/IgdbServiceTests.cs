using System.ComponentModel.DataAnnotations;
using System.Net;
using System.Reflection;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.Controllers;
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

    [Fact]
    public void Esrb_AsksForAnEsrbRowOfThatRating_BesideTheOrdersFloor()
    {
        var query = Browse(new GameBrowseQuery(Esrb: EsrbRatingKeys.M));

        Assert.Equal(
            ["age_ratings.organization = 1", "age_ratings.rating_category = (6)", "aggregated_rating_count >= 8"],
            Conditions(query));
    }

    [Theory]
    // The ids live IGDB's age_rating_categories listed under organization 1 on 17 October 2026.
    [InlineData(EsrbRatingKeys.EC, 2)]
    [InlineData(EsrbRatingKeys.E, 3)]
    [InlineData(EsrbRatingKeys.E10, 4)]
    [InlineData(EsrbRatingKeys.T, 5)]
    [InlineData(EsrbRatingKeys.M, 6)]
    [InlineData(EsrbRatingKeys.AO, 7)]
    public void Esrb_EachKey_AsksForTheCategoryIgdbListsForIt(string key, int category) =>
        Assert.Contains(
            $"age_ratings.rating_category = ({category})",
            Conditions(Browse(new GameBrowseQuery(Esrb: key))));

    [Fact]
    public void Esrb_NarrowsASearchAndAPlatformLikeEveryOtherFilter()
    {
        var query = Browse(new GameBrowseQuery(PlatformId: 130, Esrb: EsrbRatingKeys.T), search: "zelda");

        Assert.Equal(
            ["platforms = (130)", "age_ratings.organization = 1", "age_ratings.rating_category = (5)"],
            Conditions(query));
    }

    [Theory]
    [InlineData("rp")]
    [InlineData("M")]
    [InlineData("6")]
    [InlineData("")]
    public void Esrb_AnythingButAKey_IsRefusedRatherThanReadAsNoFilter(string esrb)
    {
        // The controller answers these with a 400. One that got past it must not become the whole
        // unfiltered catalogue under a page that says it is filtered.
        Assert.Throws<ArgumentOutOfRangeException>(() => Browse(new GameBrowseQuery(Esrb: esrb)));
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

    [Fact]
    public void WithTwoEsrbRatings_ReadsTheStricter_WhicheverComesFirst()
    {
        // Monster Train 2's ESRB rows in the order live IGDB returned them: E10+, then T. Rows do not
        // come back in id order, so "the first one" was never a rule anybody could state.
        Assert.Equal("T", IgdbService.MapEsrbRating([Rating(2, 9), Rating(Esrb, 4), Rating(Esrb, 5)]));
        Assert.Equal("T", IgdbService.MapEsrbRating([Rating(Esrb, 5), Rating(Esrb, 4)]));

        // Sonic X Shadow Generations: E10+, then E twice.
        Assert.Equal("E10+", IgdbService.MapEsrbRating([Rating(Esrb, 4), Rating(Esrb, 3), Rating(Esrb, 3)]));
    }

    [Fact]
    public void WithAPendingRatingBesideARealOne_ReadsTheRealOne()
    {
        Assert.Equal("E", IgdbService.MapEsrbRating([Rating(Esrb, 1), Rating(Esrb, 3)]));
        Assert.Equal("RP", IgdbService.MapEsrbRating([Rating(Esrb, 1)]));
    }

    [Fact]
    public void WithAnUnknownCategoryBesideAKnownOne_ReadsTheKnownOne()
        => Assert.Equal("M", IgdbService.MapEsrbRating([Rating(Esrb, 8), Rating(Esrb, 6)]));

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
/// The ESRB filter's keys where the API checks them and where the query builder reads them. A key the
/// API allows and the builder does not know is a 500; one the builder knows and the API refuses is a
/// rating nobody can choose. Neither shows until somebody picks it.
/// </summary>
public class EsrbFilterKeysTests
{
    /// <summary>What model validation holds <c>?esrb=</c> to, which is where the 400 comes from.</summary>
    private static AllowedValuesAttribute AllowedByTheApi() =>
        typeof(GamesController).GetMethod(nameof(GamesController.GetGames))!
            .GetParameters().Single(p => p.Name == "esrb")
            .GetCustomAttribute<AllowedValuesAttribute>()!;

    [Fact]
    public void TheApi_AllowsExactlyTheRatingsTheQueryBuilderFiltersBy()
    {
        var filterable = IgdbService.EsrbRatings.Select(r => r.Key).OfType<string>().Order();

        Assert.Equal(filterable, AllowedByTheApi().Values.OfType<string>().Order());
    }

    [Fact]
    public void TheApi_AllowsNoFilter()
    {
        // AllowedValues refuses null unless null is one of its values, and no filter is a null.
        Assert.True(AllowedByTheApi().IsValid(null));
    }

    [Theory]
    [InlineData("rp")]
    [InlineData("M")]
    [InlineData("E10+")]
    [InlineData("6")]
    public void TheApi_RefusesAnythingElse(string esrb) => Assert.False(AllowedByTheApi().IsValid(esrb));

    [Fact]
    public void EveryKey_StandsForOneRating()
    {
        var keys = IgdbService.EsrbRatings.Select(r => r.Key).OfType<string>().ToList();

        Assert.Equal(keys.Count, keys.Distinct().Count());
        Assert.All(keys, key => Assert.Equal(key, IgdbService.EsrbFilter(key).Key));
    }
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
    /// The Witcher 3's age ratings as live IGDB returned them, under the fields it returns today.
    /// Organization 1 is the ESRB and its rating category 6 is "M".
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
            ]
          }
        ]
        """;

    /// <summary>
    /// Two games holding an E10+ row, with their age ratings as live IGDB returned them: Celeste, whose
    /// only ESRB rating it is, and Monster Train 2, which also holds a T.
    /// </summary>
    private const string TwoE10GamesPayload = """
        [
          {
            "id": 332273,
            "name": "Monster Train 2",
            "age_ratings": [
              { "id": 203752, "organization": 2, "rating_category": 9 },
              { "id": 203751, "organization": 1, "rating_category": 4 },
              { "id": 245363, "organization": 1, "rating_category": 5 }
            ]
          },
          {
            "id": 26226,
            "name": "Celeste",
            "age_ratings": [
              { "id": 34568, "organization": 2, "rating_category": 9 },
              { "id": 129309, "organization": 5, "rating_category": 25 },
              { "id": 96521, "organization": 6, "rating_category": 28 },
              { "id": 68800, "organization": 3, "rating_category": 13 },
              { "id": 110564, "organization": 7, "rating_category": 35 },
              { "id": 189813, "organization": 1, "rating_category": 4 },
              { "id": 177613, "organization": 4, "rating_category": 20 }
            ]
          }
        ]
        """;

    private const string TokenPayload =
        """{ "access_token": "token", "expires_in": 3600, "token_type": "bearer" }""";

    /// <summary>Answers the token request, then every query with the payload it was given.</summary>
    private sealed class StubHandler(string payload) : HttpMessageHandler
    {
        /// <summary>The last Apicalypse query the service sent.</summary>
        public string? Query { get; private set; }

        /// <summary>How many queries reached IGDB, the token request aside.</summary>
        public int Queries { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri?.Host == "id.twitch.tv") return Json(TokenPayload);

            Query = await request.Content!.ReadAsStringAsync(cancellationToken);
            Queries++;
            return Json(payload);
        }

        private static HttpResponseMessage Json(string body) =>
            new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    }

    private static (IgdbService Service, StubHandler Igdb) NewService(string payload = GamesPayload)
    {
        var handler = new StubHandler(payload);

        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient("Igdb").Returns(_ => new HttpClient(handler));

        var configuration = Substitute.For<IConfiguration>();
        configuration["Igdb:ClientId"].Returns("client-id");
        configuration["Igdb:ClientSecret"].Returns("client-secret");

        var service = new IgdbService(
            factory, configuration, new MemoryCache(new MemoryCacheOptions()),
            NullLogger<IgdbService>.Instance);

        return (service, handler);
    }

    [Fact]
    public async Task WithAnyQuery_AsksForTheAgeRatingFieldsTheMappingReads()
    {
        // The removed `age_ratings.category,age_ratings.rating` answered 200 with rows holding only an
        // id, so the badge vanished with nothing logged. The same constant feeds the detail query.
        var (service, igdb) = NewService();

        await service.GetGamesAsync();

        Assert.Contains("age_ratings.organization,age_ratings.rating_category", igdb.Query);
    }

    [Fact]
    public async Task WithIgdbsOwnJson_BindsTheAgeRatingsThroughToTheEsrbCode()
    {
        // The half no mapping test reaches: snake_case onto Organization and RatingCategory. Misname
        // either and EsrbRating is null again while every MapEsrbRating test still passes.
        var (service, _) = NewService();

        var games = await service.GetGamesAsync();

        Assert.Equal("M", Assert.Single(games.Items).EsrbRating);
    }

    private static readonly GameBrowseQuery E10 = new(Esrb: EsrbRatingKeys.E10);

    [Fact]
    public async Task WithAnEsrbFilter_ListsAGameOnlyUnderTheRatingItsBadgeShows()
    {
        // IGDB answers "an E10+ row" with both games, and Monster Train 2's badge says T — the
        // stricter of its two. A page filtered to E10+ does not carry it.
        var (service, igdb) = NewService(TwoE10GamesPayload);

        var games = await service.GetGamesAsync(browse: E10);

        Assert.Contains("age_ratings.rating_category = (4)", igdb.Query);
        var celeste = Assert.Single(games.Items);
        Assert.Equal("Celeste", celeste.Title);
        Assert.Equal("E10+", celeste.EsrbRating);
    }

    [Fact]
    public async Task WithAnEsrbFilter_ListsAGameUnderItsBadgesRating()
    {
        var (service, _) = NewService(TwoE10GamesPayload);

        var games = await service.GetGamesAsync(browse: new GameBrowseQuery(Esrb: EsrbRatingKeys.T));

        var monsterTrain = Assert.Single(games.Items);
        Assert.Equal("Monster Train 2", monsterTrain.Title);
        Assert.Equal("T", monsterTrain.EsrbRating);
    }

    [Fact]
    public async Task WithAnEsrbFilter_ReadsWhetherThereIsMoreFromIgdbsPageNotFromWhatIsLeft()
    {
        // A full page with one game dropped is still a full page: the next one may hold more.
        var (service, _) = NewService(TwoE10GamesPayload);

        var games = await service.GetGamesAsync(offset: 0, limit: 2, browse: E10);

        Assert.Single(games.Items);
        Assert.True(games.HasMore);
    }

    [Fact]
    public async Task WithoutAnEsrbFilter_ListsEveryGameIgdbReturned()
    {
        var (service, _) = NewService(TwoE10GamesPayload);

        var games = await service.GetGamesAsync();

        Assert.Equal(["T", "E10+"], games.Items.Select(g => g.EsrbRating));
    }

    [Fact]
    public async Task TheCacheKey_TellsTheEsrbFiltersApart()
    {
        // Left out of the key, the first listing to be cached would be served for every rating.
        var (service, igdb) = NewService(TwoE10GamesPayload);

        await service.GetGamesAsync();
        await service.GetGamesAsync(browse: E10);
        await service.GetGamesAsync(browse: new GameBrowseQuery(Esrb: EsrbRatingKeys.T));
        await service.GetGamesAsync(browse: E10);

        Assert.Equal(3, igdb.Queries);
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
