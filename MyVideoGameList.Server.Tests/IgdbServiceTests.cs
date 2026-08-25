using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models.Igdb;
using MyVideoGameList.Server.Services;

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
}

public class MapEsrbRatingTests
{
    [Theory]
    [InlineData(1, "RP")]
    [InlineData(3, "E")]
    [InlineData(4, "E10+")]
    [InlineData(6, "M")]
    [InlineData(7, "AO")]
    public void MapsKnownRatings(int value, string expected)
        => Assert.Equal(expected, IgdbService.MapEsrbRating(value));

    [Theory]
    [InlineData(0)]
    [InlineData(8)]
    [InlineData(-1)]
    public void ReturnsNullForUnknownRatings(int value)
        => Assert.Null(IgdbService.MapEsrbRating(value));
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

public class ComposeUpcomingTests
{
    private static readonly PlatformDto Pc = new(6, "PC", "PC", null, null);
    private static readonly PlatformDto Switch = new(130, "Nintendo Switch", "Switch", null, null);
    private static readonly PlatformDto Ps5 = new(167, "PlayStation 5", "PS5", null, null);

    private static GameDto Game(int id, string title, params PlatformDto[] platforms) =>
        new(id, title, null, new DateOnly(2020, 1, 1), null, null, null, null, null, null, null,
            null, null, platforms, Genres: [], Developers: [], Publishers: [], Details: null);

    private static long Unix(int year, int month, int day) =>
        new DateTimeOffset(new DateTime(year, month, day, 0, 0, 0, DateTimeKind.Utc)).ToUnixTimeSeconds();

    private static IgdbReleaseDate Row(int id, int gameId, int? platformId, long date) =>
        new(id, date, gameId, platformId);

    [Fact]
    public void SameGameOnTwoDates_ProducesTwoEntriesWithTheirOwnPlatforms()
    {
        var rows = new List<IgdbReleaseDate>
        {
            Row(1, 100, Pc.Id, Unix(2026, 3, 1)),
            Row(2, 100, Switch.Id, Unix(2026, 3, 5)),
            Row(3, 100, Ps5.Id, Unix(2026, 3, 5)),
        };
        var games = new Dictionary<int, GameDto> { [100] = Game(100, "Staggered", Pc, Switch, Ps5) };

        var result = IgdbService.ComposeUpcoming(rows, games);

        Assert.Equal(2, result.Count);

        var first = result[0];
        Assert.Equal(new DateOnly(2026, 3, 1), first.ReleaseDate);
        Assert.Equal(["PC"], first.Platforms.Select(p => p.Abbreviation));

        var second = result[1];
        Assert.Equal(new DateOnly(2026, 3, 5), second.ReleaseDate);
        Assert.Equal(["PS5", "Switch"], second.Platforms.Select(p => p.Abbreviation).Order());
    }

    [Fact]
    public void OverridesTheGamesOwnReleaseDate()
    {
        // The game's first_release_date is 2020; the timeline must show the upcoming date instead.
        var rows = new List<IgdbReleaseDate> { Row(1, 100, Switch.Id, Unix(2026, 6, 10)) };
        var games = new Dictionary<int, GameDto> { [100] = Game(100, "Port", Pc, Switch) };

        var result = IgdbService.ComposeUpcoming(rows, games);

        Assert.Equal(new DateOnly(2026, 6, 10), Assert.Single(result).ReleaseDate);
    }

    [Fact]
    public void RowWithoutPlatform_FallsBackToTheGamesFullPlatformList()
    {
        var rows = new List<IgdbReleaseDate> { Row(1, 100, null, Unix(2026, 4, 2)) };
        var games = new Dictionary<int, GameDto> { [100] = Game(100, "Unknown platform", Pc, Ps5) };

        var result = IgdbService.ComposeUpcoming(rows, games);

        Assert.Equal(2, Assert.Single(result).Platforms.Count());
    }

    [Fact]
    public void PlatformNotOnTheGame_FallsBackRatherThanEmittingAnEmptyList()
    {
        // Release row points at a platform absent from the game's platform list.
        var rows = new List<IgdbReleaseDate> { Row(1, 100, 999, Unix(2026, 4, 2)) };
        var games = new Dictionary<int, GameDto> { [100] = Game(100, "Mismatch", Pc) };

        var result = IgdbService.ComposeUpcoming(rows, games);

        Assert.Equal(["PC"], Assert.Single(result).Platforms.Select(p => p.Abbreviation));
    }

    [Fact]
    public void DropsRowsForGamesThatCouldNotBeResolved()
    {
        var rows = new List<IgdbReleaseDate>
        {
            Row(1, 100, Pc.Id, Unix(2026, 3, 1)),
            Row(2, 200, Pc.Id, Unix(2026, 3, 2)),
        };
        var games = new Dictionary<int, GameDto> { [100] = Game(100, "Known", Pc) };

        var result = IgdbService.ComposeUpcoming(rows, games);

        Assert.Equal(100, Assert.Single(result).Id);
    }

    [Fact]
    public void SortsByDateThenTitle()
    {
        var rows = new List<IgdbReleaseDate>
        {
            Row(1, 300, Pc.Id, Unix(2026, 5, 9)),
            Row(2, 100, Pc.Id, Unix(2026, 5, 1)),
            Row(3, 200, Pc.Id, Unix(2026, 5, 1)),
        };
        var games = new Dictionary<int, GameDto>
        {
            [100] = Game(100, "Zebra", Pc),
            [200] = Game(200, "Alpha", Pc),
            [300] = Game(300, "Later", Pc),
        };

        var result = IgdbService.ComposeUpcoming(rows, games);

        Assert.Equal(["Alpha", "Zebra", "Later"], result.Select(g => g.Title));
    }

    [Fact]
    public void DuplicateRowsForTheSamePlatformAndDate_DoNotDuplicatePlatforms()
    {
        // IGDB can return several regional rows for one platform on one date.
        var rows = new List<IgdbReleaseDate>
        {
            Row(1, 100, Pc.Id, Unix(2026, 7, 1)),
            Row(2, 100, Pc.Id, Unix(2026, 7, 1)),
        };
        var games = new Dictionary<int, GameDto> { [100] = Game(100, "Regional", Pc) };

        var result = IgdbService.ComposeUpcoming(rows, games);

        Assert.Single(result);
        Assert.Single(result[0].Platforms);
    }
}
