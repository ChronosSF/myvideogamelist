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

public class ComposeUpcomingTests
{
    private static readonly PlatformDto Pc = new(6, "PC", "PC", null, null);
    private static readonly PlatformDto Switch = new(130, "Nintendo Switch", "Switch", null, null);
    private static readonly PlatformDto Ps5 = new(167, "PlayStation 5", "PS5", null, null);

    private static GameDto Game(int id, string title, params PlatformDto[] platforms) =>
        new(id, title, null, new DateOnly(2020, 1, 1), null, null, null, null, null, null, null,
            platforms, [], [], []);

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
