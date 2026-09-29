using System.Net;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Releases;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>The release query's text: its relations, its window, and how it pages.</summary>
public class ConnectedReleaseQueryTests
{
    private static readonly DateOnly From = new(2026, 10, 1);
    private static readonly DateOnly To = new(2026, 10, 15);

    private static long Unix(DateOnly day) =>
        new DateTimeOffset(day.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero).ToUnixTimeSeconds();

    [Fact]
    public void BuildRelationFilters_ALibraryThatFits_IsOneFilterWithAllThreeRelations()
    {
        var filter = Assert.Single(IgdbService.BuildRelationFilters([1942, 2933], [62, 272]));

        Assert.Equal(
            "game = (1942,2933) | game.parent_game = (1942,2933) | game.version_parent = (1942,2933) | game.collections = (62,272)",
            filter);
    }

    [Fact]
    public void BuildRelationFilters_ALibraryLargerThanWasMeasured_IsSplit()
    {
        // 1,500 games was measured in one query; one more is two, and the series then go on their own.
        var filters = IgdbService.BuildRelationFilters(Enumerable.Range(1, 1501).ToList(), [62]);

        Assert.Equal(3, filters.Count);
        Assert.StartsWith("game = (1,", filters[0]);
        Assert.StartsWith("game = (1501)", filters[1]);
        Assert.Equal("game.collections = (62)", filters[2]);
    }

    [Fact]
    public void BuildRelationFilters_NoGames_AsksNothing()
    {
        Assert.Empty(IgdbService.BuildRelationFilters([], [62]));
    }

    [Fact]
    public void BuildConnectedReleasesQuery_ForTheLine_AsksOnlyForDaysInTheWindow()
    {
        var query = IgdbService.BuildConnectedReleasesQuery("game = (1)", From, To, withPeriods: false, offset: 0);

        Assert.Contains($"where (game = (1)) & ((date_format = 0 | date_format = null) & date >= {Unix(From)} & date < {Unix(To)});", query);
        Assert.DoesNotContain("date_format = (1,2,3,4,5,6)", query);
    }

    [Fact]
    public void BuildConnectedReleasesQuery_ForTheCalendar_WidensTheRangeForRowsKnownOnlyToAPeriod()
    {
        // A month's stand-in is its first day, so up to a month before the window; a quarter's and a
        // year's are their last, so up to a year after it.
        var query = IgdbService.BuildConnectedReleasesQuery("game = (1)", From, To, withPeriods: true, offset: 0);

        Assert.Contains(
            $"| (date_format = (1,2,3,4,5,6) & date >= {Unix(From.AddDays(-31))} & date < {Unix(To.AddDays(366))})",
            query);
    }

    [Fact]
    public void BuildConnectedReleasesQuery_PagesInIdOrder()
    {
        // Rows sharing a date could move between pages under a date sort, and be skipped or read twice.
        var query = IgdbService.BuildConnectedReleasesQuery("game = (1)", From, To, withPeriods: false, offset: 500);

        Assert.Contains("sort id asc;", query);
        Assert.Contains("limit 500;", query);
        Assert.Contains("offset 500;", query);
        Assert.Contains("fields game,date,date_format,y,m,status,platform.name,platform.abbreviation;", query);
    }
}

/// <summary>
/// The calendar's two queries against IGDB's own JSON, recorded on 2026-09-29 — the joint no test of
/// the rules can reach. <c>parent_game</c> asked for bare arrives as a number where
/// <c>IgdbGame</c> would read an object, and a misnamed <c>date_format</c> would read every row as
/// known to the day, with nothing logged.
/// </summary>
public class CalendarIgdbJsonTests
{
    private const string ReleaseRowsPayload = """
        [
          {
            "id": 847083, "date": 1798675200, "game": 381684, "m": 12,
            "platform": { "id": 6, "abbreviation": "PC", "name": "PC (Microsoft Windows)" },
            "y": 2026, "date_format": 2
          },
          {
            "id": 925689, "date": 1796256000, "game": 405448, "m": 12,
            "platform": { "id": 508, "abbreviation": "Switch 2", "name": "Nintendo Switch 2" },
            "y": 2026, "status": 6, "date_format": 0
          }
        ]
        """;

    private const string GamesPayload = """
        [
          {
            "id": 405448, "cover": { "id": 569764, "image_id": "coc7ms" },
            "name": "Xenoblade Chronicles 3: Nintendo Switch 2 Edition", "parent_game": 191411,
            "collections": [ { "id": 1161, "name": "Xenoblade Chronicles" } ], "game_type": 10
          },
          {
            "id": 407999, "cover": { "id": 600579, "image_id": "cocver" },
            "name": "Grand Theft Auto VI: Ultimate Edition", "version_parent": 52189, "game_type": 0
          }
        ]
        """;

    private const string TokenPayload =
        """{ "access_token": "token", "expires_in": 3600, "token_type": "bearer" }""";

    /// <summary>Answers the token request, then each endpoint with what it returned live.</summary>
    private sealed class StubHandler : HttpMessageHandler
    {
        public List<string> Queries { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri?.Host == "id.twitch.tv") return Json(TokenPayload);

            Queries.Add(await request.Content!.ReadAsStringAsync(cancellationToken));
            return Json(request.RequestUri!.AbsolutePath.EndsWith("/release_dates") ? ReleaseRowsPayload : GamesPayload);
        }

        private static HttpResponseMessage Json(string body) =>
            new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    }

    private static (IgdbService Service, StubHandler Igdb) NewService()
    {
        var handler = new StubHandler();

        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient("Igdb").Returns(_ => new HttpClient(handler));

        var configuration = Substitute.For<IConfiguration>();
        configuration["Igdb:ClientId"].Returns("client-id");
        configuration["Igdb:ClientSecret"].Returns("client-secret");

        var service = new IgdbService(
            factory, configuration, new MemoryCache(new MemoryCacheOptions()), NullLogger<IgdbService>.Instance);

        return (service, handler);
    }

    [Fact]
    public async Task GetConnectedReleaseRowsAsync_BindsHowMuchOfTheDateIsKnown()
    {
        var (service, _) = NewService();

        var answer = await service.GetConnectedReleaseRowsAsync(
            [115289], [5702], new DateOnly(2026, 12, 1), new DateOnly(2027, 1, 1), withPeriods: true);

        Assert.False(answer.Truncated);
        Assert.Equal(
            [
                new ReleaseRow(925689, 405448, new DateOnly(2026, 12, 3), 0, 2026, 12,
                    new PlatformDto(508, "Nintendo Switch 2", "Switch 2", null, null), 6),
                new ReleaseRow(847083, 381684, new DateOnly(2026, 12, 31), 2, 2026, 12,
                    new PlatformDto(6, "PC (Microsoft Windows)", "PC", null, null), null),
            ],
            answer.Rows);
    }

    [Fact]
    public async Task GetCalendarGamesAsync_BindsParentsAsIdsAndSeriesAsNames()
    {
        var (service, _) = NewService();

        var games = await service.GetCalendarGamesAsync([405448, 407999]);

        var xenoblade = games[405448];
        Assert.Equal(IgdbGameTypes.ExpandedGame, xenoblade.GameType);
        Assert.Equal(191411, xenoblade.ParentGameId);
        Assert.Equal([new SeriesRef(1161, "Xenoblade Chronicles")], xenoblade.Series);
        Assert.Equal("https://images.igdb.com/igdb/image/upload/t_cover_big/coc7ms.jpg", xenoblade.CoverImageUrl);

        var ultimate = games[407999];
        Assert.Equal(52189, ultimate.VersionParentId);
        Assert.Null(ultimate.ParentGameId);
        Assert.Empty(ultimate.Series);
    }

    [Fact]
    public async Task GetCalendarGamesAsync_AsksIgdbOnlyAboutGamesItHasNotAlreadyBeenToldAbout()
    {
        // Per game rather than per request, so a second library sharing games costs nothing for them. A
        // game IGDB did not answer for is remembered as missing too.
        var (service, igdb) = NewService();

        await service.GetCalendarGamesAsync([405448, 407999, 1]);
        var again = await service.GetCalendarGamesAsync([405448, 407999, 1]);

        Assert.Single(igdb.Queries);
        Assert.Equal([405448, 407999], again.Keys.Order());
    }
}
