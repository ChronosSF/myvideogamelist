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

/// <summary>
/// The rules of the home page's Just out panel (ADR 0073), against games, rows and Twitch figures recorded
/// from live IGDB on 2026-10-25, the day the rules were drawn.
/// </summary>
public class JustOutRulesTests
{
    private static readonly DateOnly Today = new(2026, 10, 25);

    private static readonly PlatformDto Pc = new(6, "PC (Microsoft Windows)", "PC", null, null);
    private static readonly PlatformDto Ps5 = new(167, "PlayStation 5", "PS5", null, null);
    private static readonly PlatformDto SeriesXs = new(169, "Xbox Series X|S", "Series X|S", null, null);
    private static readonly PlatformDto Switch2 = new(508, "Nintendo Switch 2", "Switch 2", null, null);
    private static readonly PlatformDto Switch = new(130, "Nintendo Switch", "Switch", null, null);

    private const int Full = IgdbReleaseStatuses.FullRelease;

    /// <summary>IGDB's "Advanced Access" release status: the paid early start.</summary>
    private const int AdvancedAccess = 34;

    private static CalendarGame Game(int id, string name, int type = IgdbGameTypes.MainGame, int? versionParent = null) =>
        new(id, name, null, type, null, versionParent, []);

    private static ReleaseRow Day(int id, int gameId, DateOnly day, PlatformDto platform, int? status = Full) =>
        new(id, gameId, day, 0, day.Year, day.Month, platform, status);

    /// <summary>In early access on PC since the 24th of January 2024, its 1.0 on the 15th of October 2026.</summary>
    private static JustOutCandidate Enshrouded() => new(Game(248643, "Enshrouded"), 0.03884,
    [
        Day(541319, 248643, new DateOnly(2024, 1, 24), Pc, IgdbReleaseStatuses.EarlyAccess),
        Day(934013, 248643, new DateOnly(2026, 10, 15), Pc),
        Day(934014, 248643, new DateOnly(2026, 10, 15), Ps5),
    ]);

    /// <summary>Advanced access on the 29th of September, the full release on the 2nd of October.</summary>
    private static JustOutCandidate AceCombat8() => new(Game(381247, "Ace Combat 8: Wings of Theve"), 0.01580,
    [
        Day(920917, 381247, new DateOnly(2026, 9, 29), Ps5, AdvancedAccess),
        Day(920920, 381247, new DateOnly(2026, 9, 29), Pc, AdvancedAccess),
        Day(921040, 381247, new DateOnly(2026, 9, 29), SeriesXs, AdvancedAccess),
        Day(920916, 381247, new DateOnly(2026, 10, 2), Ps5),
        Day(920921, 381247, new DateOnly(2026, 10, 2), Pc),
        Day(921039, 381247, new DateOnly(2026, 10, 2), SeriesXs),
    ]);

    private static JustOutCandidate Castlevania() => new(Game(389434, "Castlevania: Belmont's Curse"), 0.00972,
    [
        Day(946095, 389434, new DateOnly(2026, 10, 15), Switch),
        Day(924287, 389434, new DateOnly(2026, 10, 15), Ps5),
        Day(924286, 389434, new DateOnly(2026, 10, 15), Pc),
        Day(924288, 389434, new DateOnly(2026, 10, 15), SeriesXs),
    ]);

    private static JustOutCandidate SilentHillTownfall() => new(Game(222342, "Silent Hill: Townfall"), 0.00645,
    [
        Day(955137, 222342, new DateOnly(2026, 9, 22), Pc, AdvancedAccess),
        Day(955138, 222342, new DateOnly(2026, 9, 22), Ps5, AdvancedAccess),
        Day(920840, 222342, new DateOnly(2026, 9, 24), Ps5),
        Day(920994, 222342, new DateOnly(2026, 9, 24), Pc),
    ]);

    /// <summary>Two follows and one rating on IGDB, and the eighth most watched new game on Twitch.</summary>
    private static JustOutCandidate Madden27() => new(Game(400379, "Madden NFL 27"), 0.00570,
    [
        Day(924420, 400379, new DateOnly(2026, 8, 6), Ps5, AdvancedAccess),
        Day(924422, 400379, new DateOnly(2026, 8, 6), SeriesXs, AdvancedAccess),
        Day(924411, 400379, new DateOnly(2026, 8, 13), Switch2),
        Day(924412, 400379, new DateOnly(2026, 8, 13), Pc),
        Day(924413, 400379, new DateOnly(2026, 8, 13), Ps5),
        Day(924421, 400379, new DateOnly(2026, 8, 13), SeriesXs),
    ]);

    private static readonly IReadOnlySet<int> None = new HashSet<int>();

    private static IReadOnlyList<JustOutRelease> Compose(
        IEnumerable<JustOutCandidate> candidates, DateOnly? today = null, IReadOnlySet<int>? hidden = null) =>
        JustOut.Compose(candidates, hidden ?? None, today ?? Today);

    [Fact]
    public void Compose_TheDayTheRulesWereDrawn_ShowsTheMostWatched_TheNewestFirst()
    {
        var panel = Compose([Madden27(), AceCombat8(), Enshrouded(), SilentHillTownfall(), Castlevania()]);

        Assert.Equal(
            ["Castlevania: Belmont's Curse", "Enshrouded", "Ace Combat 8: Wings of Theve", "Silent Hill: Townfall", "Madden NFL 27"],
            panel.Select(r => r.Game.Name));
    }

    [Fact]
    public void Compose_AFullReleaseAfterEarlyAccess_IsOutOnTheDayOfItsFullRelease()
    {
        var enshrouded = Assert.Single(Compose([Enshrouded()]));

        Assert.Equal(new DateOnly(2026, 10, 15), enshrouded.Released);
        Assert.Equal([Pc, Ps5], enshrouded.Platforms);
    }

    [Fact]
    public void Compose_AdvancedAccess_IsNotTheRelease()
    {
        var aceCombat = Assert.Single(Compose([AceCombat8()]));

        Assert.Equal(new DateOnly(2026, 10, 2), aceCombat.Released);
        Assert.Equal(3, aceCombat.Platforms.Count);
    }

    [Fact]
    public void Compose_OutToday_IsStillComingSoons_AndJustOutTomorrow()
    {
        // The two panels meet on today and never share a game: Coming soon keeps a game out today.
        Assert.Empty(Compose([Castlevania()], today: new DateOnly(2026, 10, 15)));
        Assert.Single(Compose([Castlevania()], today: new DateOnly(2026, 10, 16)));
    }

    [Fact]
    public void Compose_NinetyDaysOn_IsNoLongerJustOut()
    {
        // Out on the 13th of August: the 11th of November is its ninetieth day after, the 12th past them.
        Assert.Single(Compose([Madden27()], today: new DateOnly(2026, 11, 11)));
        Assert.Empty(Compose([Madden27()], today: new DateOnly(2026, 11, 12)));
    }

    [Fact]
    public void Compose_AReleasedGameWithAPortInTheWindow_IsNotJustOut()
    {
        // Out on PC since the 11th of October 2024, on a new platform inside the ninety days.
        var ported = new JustOutCandidate(Game(2, "Out before"), 0.01,
        [
            Day(20, 2, new DateOnly(2024, 10, 11), Pc),
            Day(21, 2, new DateOnly(2026, 10, 1), Switch2),
        ]);

        Assert.Empty(Compose([ported]));
    }

    [Fact]
    public void Compose_AnOlderGameKnownOnlyToItsYear_WithAPortInTheWindow_IsNotJustOut()
    {
        // IGDB dates the release only to "2019", which it stores on the year's last day; the port is the
        // only row it knows to the day.
        var olderGame = new JustOutCandidate(Game(7, "Out in 2019"), 0.01,
        [
            new(70, 7, new DateOnly(2019, 12, 31), 2, 2019, 12, Pc, Full),
            Day(71, 7, new DateOnly(2026, 10, 1), Switch2),
        ]);

        Assert.Empty(Compose([olderGame]));
    }

    [Theory]
    [InlineData(1, 2025, 3)] // March 2025
    [InlineData(4, 2025, 6)] // Q2 2025, stored on the quarter's last month
    public void Compose_AMonthOrQuarterEndedBeforeTheWindow_IsOutAlready(int dateFormat, int year, int month)
    {
        var stored = dateFormat == 1 ? new DateOnly(year, month, 1) : new DateOnly(year, month, DateTime.DaysInMonth(year, month));
        var olderGame = new JustOutCandidate(Game(8, "Out earlier"), 0.01,
        [
            new(80, 8, stored, dateFormat, year, month, Pc, Full),
            Day(81, 8, new DateOnly(2026, 10, 1), Ps5),
        ]);

        Assert.Empty(Compose([olderGame]));
    }

    [Fact]
    public void Compose_AMonthInsideTheWindow_LeavesTheDayItMeant()
    {
        // "September 2026" on one platform, the 1st of October on another: both inside the ninety days, so the
        // month says nothing against the day.
        var game = new JustOutCandidate(Game(9, "Known to September on PC"), 0.01,
        [
            new(90, 9, new DateOnly(2026, 9, 1), 1, 2026, 9, Pc, Full),
            Day(91, 9, new DateOnly(2026, 10, 1), Ps5),
        ]);

        var shown = Assert.Single(Compose([game]));

        Assert.Equal(new DateOnly(2026, 10, 1), shown.Released);
        Assert.Equal([Ps5], shown.Platforms);
    }

    [Fact]
    public void Compose_ThePlatforms_AreWhatItIsOutOnBeforeToday()
    {
        var pcFirst = new JustOutCandidate(Game(3, "PC first"), 0.01,
        [
            Day(30, 3, new DateOnly(2026, 10, 1), Pc),
            Day(31, 3, new DateOnly(2026, 12, 1), Ps5),
        ]);

        Assert.Equal([Pc], Assert.Single(Compose([pcFirst])).Platforms);
    }

    [Fact]
    public void Compose_AMonthAlreadyPast_IsNotARelease()
    {
        // A date IGDB never came back to says nothing about whether the game is out.
        var monthOnly = new JustOutCandidate(Game(4, "Known to September"), 0.01,
            [new(40, 4, new DateOnly(2026, 9, 1), 1, 2026, 9, Pc, Full)]);

        Assert.Empty(Compose([monthOnly]));
    }

    [Fact]
    public void Compose_AtMostTen_TheMostWatched()
    {
        var many = Enumerable.Range(1, 12)
            .Select(i => new JustOutCandidate(Game(i, $"Game {i}"), i, [Day(i, i, new DateOnly(2026, 10, i), Pc)]))
            .ToList();

        var panel = Compose(many);

        Assert.Equal(JustOut.MaxShown, panel.Count);
        Assert.DoesNotContain(panel, r => r.Game.Id is 1 or 2);
    }

    [Fact]
    public void Compose_Hidden_IsNeverShown_HoweverWatched()
    {
        var panel = Compose([Enshrouded(), Castlevania()], hidden: new HashSet<int> { 248643 });

        Assert.Equal(["Castlevania: Belmont's Curse"], panel.Select(r => r.Game.Name));
    }

    [Fact]
    public void Compose_NotANewGame_IsLeftOut()
    {
        var dlc = new JustOutCandidate(Game(5, "A DLC", IgdbGameTypes.Dlc), 1, [Day(50, 5, new DateOnly(2026, 10, 1), Pc)]);
        var edition = new JustOutCandidate(Game(6, "An edition", versionParent: 248643), 1, [Day(60, 6, new DateOnly(2026, 10, 1), Pc)]);

        Assert.Empty(Compose([dlc, edition]));
    }
}

/// <summary>The panel's two IGDB queries.</summary>
public class JustOutQueryTests
{
    private static long Unix(DateOnly day) =>
        new DateTimeOffset(day.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero).ToUnixTimeSeconds();

    [Fact]
    public void BuildJustOutPopularityQuery_AsksForTwitchsHoursWatched_MostWatchedFirst()
    {
        var query = IgdbService.BuildJustOutPopularityQuery();

        Assert.Contains("where popularity_type = 34;", query);
        Assert.Contains("sort value desc;", query);
        Assert.Contains("limit 500;", query);
    }

    [Fact]
    public void BuildJustOutQuery_AsksWhichOfThemHaveARowInTheNinetyDaysBeforeToday()
    {
        var query = IgdbService.BuildJustOutQuery(new DateOnly(2026, 10, 25), [381247, 248643]);

        Assert.Contains(
            "where id = (381247,248643) & game_type = (0,4,8,9) & version_parent = null"
            + $" & release_dates.date >= {Unix(new DateOnly(2026, 7, 27))} & release_dates.date < {Unix(new DateOnly(2026, 10, 25))};",
            query);
        Assert.DoesNotContain("first_release_date >=", query);
        Assert.Contains("release_dates.platform.abbreviation", query);
    }
}

public class JustOutJsonTests
{
    /// <summary>Enshrouded's Twitch figure as IGDB answered it on 2026-10-25, beside a game with no id.</summary>
    private const string PopularityPayload = """
        [
          { "id": 1, "game_id": 248643, "value": 0.03883792 },
          { "id": 2, "value": 0.02 }
        ]
        """;

    /// <summary>Enshrouded as IGDB answered the panel's games query on 2026-10-25, its undated row included.</summary>
    private const string GamesPayload = """
        [
          {
            "id": 248643,
            "cover": { "id": 1, "image_id": "co7abc" },
            "first_release_date": 1706054400,
            "name": "Enshrouded",
            "release_dates": [
              { "id": 842715, "date_format": 7, "platform": { "id": 169, "abbreviation": "Series X|S", "name": "Xbox Series X|S" }, "status": 6 },
              { "id": 541319, "date": 1706054400, "date_format": 0, "m": 1, "y": 2024, "platform": { "id": 6, "abbreviation": "PC", "name": "PC (Microsoft Windows)" }, "status": 3 },
              { "id": 934013, "date": 1792022400, "date_format": 0, "m": 10, "y": 2026, "platform": { "id": 6, "abbreviation": "PC", "name": "PC (Microsoft Windows)" }, "status": 6 }
            ],
            "game_type": 0
          }
        ]
        """;

    private const string TokenPayload =
        """{ "access_token": "token", "expires_in": 3600, "token_type": "bearer" }""";

    private sealed class StubHandler(string popularity) : HttpMessageHandler
    {
        public List<string> Endpoints { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri?.Host == "id.twitch.tv") return Json(TokenPayload);

            var endpoint = request.RequestUri!.AbsolutePath.Split('/')[^1];
            Endpoints.Add(endpoint);
            await request.Content!.ReadAsStringAsync(cancellationToken);
            return Json(endpoint == "popularity_primitives" ? popularity : GamesPayload);
        }

        private static HttpResponseMessage Json(string body) =>
            new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    }

    private static (IgdbService Service, StubHandler Igdb) NewService(string popularity = PopularityPayload)
    {
        var handler = new StubHandler(popularity);

        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient("Igdb").Returns(_ => new HttpClient(handler));

        var configuration = Substitute.For<IConfiguration>();
        configuration["Igdb:ClientId"].Returns("client-id");
        configuration["Igdb:ClientSecret"].Returns("client-secret");

        return (new IgdbService(factory, configuration, new MemoryCache(new MemoryCacheOptions()), NullLogger<IgdbService>.Instance), handler);
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_JoinsEachGameToHowMuchItWasWatched_AndGivesItsRowsTheGame()
    {
        var (service, _) = NewService();

        var candidates = await service.GetJustOutCandidatesAsync(new DateOnly(2026, 10, 25));

        var enshrouded = Assert.Single(candidates);
        Assert.Equal((248643, "Enshrouded", 0.03883792), (enshrouded.Game.Id, enshrouded.Game.Name, enshrouded.Watched));
        // The row with no date is not one the rules can place, so it is not a row here.
        Assert.Equal([541319, 934013], enshrouded.Rows.Select(r => r.Id));
        Assert.All(enshrouded.Rows, row => Assert.Equal(248643, row.GameId));
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_AsksIgdbOnceADay()
    {
        var (service, igdb) = NewService();

        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 10, 25));
        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 10, 25));
        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 10, 26));

        Assert.Equal(["popularity_primitives", "games", "popularity_primitives", "games"], igdb.Endpoints);
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_NoTwitchFigures_AsksForNoGames()
    {
        // What a popularity type IGDB has withdrawn looks like: no rows and no error.
        var (service, igdb) = NewService(popularity: "[]");

        var candidates = await service.GetJustOutCandidatesAsync(new DateOnly(2026, 10, 25));

        Assert.Empty(candidates);
        Assert.Equal(["popularity_primitives"], igdb.Endpoints);
    }
}
