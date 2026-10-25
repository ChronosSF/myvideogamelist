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
/// The rules of the home page's Coming soon panel (ADR 0071), against games and rows recorded from live IGDB
/// on 2026-10-25, the day the rules were drawn.
/// </summary>
public class ComingSoonRulesTests
{
    private static readonly DateOnly Today = new(2026, 10, 25);

    private static readonly PlatformDto Pc = new(6, "PC (Microsoft Windows)", "PC", null, null);
    private static readonly PlatformDto Ps5 = new(167, "PlayStation 5", "PS5", null, null);
    private static readonly PlatformDto SeriesXs = new(169, "Xbox Series X|S", "Series X|S", null, null);
    private static readonly PlatformDto Switch2 = new(508, "Nintendo Switch 2", "Switch 2", null, null);
    private static readonly PlatformDto Switch = new(130, "Nintendo Switch", "Switch", null, null);
    private static readonly PlatformDto Ios = new(39, "iOS", "iOS", null, null);
    private static readonly PlatformDto Android = new(34, "Android", "Android", null, null);

    private const int Full = IgdbReleaseStatuses.FullRelease;

    /// <summary>IGDB's "Advanced Access" release status: the paid early start, seen on Fable's rows.</summary>
    private const int AdvancedAccess = 34;

    private static CalendarGame Game(int id, string name, int type = IgdbGameTypes.MainGame, int? status = null, int? versionParent = null) =>
        new(id, name, null, type, null, versionParent, [], GameStatus: status);

    private static ReleaseRow Day(int id, int gameId, DateOnly day, PlatformDto platform, int? status = Full) =>
        new(id, gameId, day, 0, day.Year, day.Month, platform, status);

    private static ComingSoonCandidate GtaVi() => new(Game(52189, "Grand Theft Auto VI"), 1111,
    [
        Day(831835, 52189, new DateOnly(2026, 11, 19), SeriesXs),
        Day(831834, 52189, new DateOnly(2026, 11, 19), Ps5),
    ]);

    private static ComingSoonCandidate PhantomBladeZero() => new(Game(250618, "Phantom Blade Zero"), 222,
    [
        Day(920986, 250618, new DateOnly(2026, 10, 29), Pc),
        Day(920987, 250618, new DateOnly(2026, 10, 29), Ps5),
    ]);

    private static ComingSoonCandidate OcarinaOfTime() =>
        new(Game(405460, "The Legend of Zelda: Ocarina of Time", IgdbGameTypes.Remake), 77,
            [Day(962721, 405460, new DateOnly(2026, 11, 5), Switch2)]);

    /// <summary>Known only to be Q1 2027, which IGDB stores on the quarter's last day.</summary>
    private static ComingSoonCandidate OutOfWords() => new(Game(347645, "Out of Words"), 80,
    [
        new(918996, 347645, new DateOnly(2027, 3, 31), 3, 2027, 3, Switch2, Full),
        new(918997, 347645, new DateOnly(2027, 3, 31), 3, 2027, 3, Pc, Full),
        new(918998, 347645, new DateOnly(2027, 3, 31), 3, 2027, 3, Ps5, Full),
        new(918999, 347645, new DateOnly(2027, 3, 31), 3, 2027, 3, SeriesXs, Full),
    ]);

    /// <summary>Known only to be "2026".</summary>
    private static ComingSoonCandidate Witchbrook() => new(Game(67195, "Witchbrook"), 71,
    [
        new(821925, 67195, new DateOnly(2026, 12, 31), 2, 2026, 12, Switch, Full),
        new(821927, 67195, new DateOnly(2026, 12, 31), 2, 2026, 12, Pc, Full),
    ]);

    /// <summary>A day on PC, and only years on the consoles.</summary>
    private static ComingSoonCandidate ActsOfBlood() => new(Game(305550, "Acts of Blood"), 58,
    [
        new(978415, 305550, new DateOnly(2027, 12, 31), 2, 2027, 12, SeriesXs, Full),
        Day(978511, 305550, new DateOnly(2026, 12, 4), Pc),
        new(978554, 305550, new DateOnly(2027, 12, 31), 2, 2027, 12, Ps5, Full),
    ]);

    /// <summary>Q4 2026, from a game IGDB marks as in beta.</summary>
    private static ComingSoonCandidate PetitPlanet() => new(Game(370095, "Petit Planet", status: 3), 24,
    [
        new(957194, 370095, new DateOnly(2026, 12, 31), 6, 2026, 12, Ios, Full),
        new(957195, 370095, new DateOnly(2026, 12, 31), 6, 2026, 12, Pc, Full),
        new(957196, 370095, new DateOnly(2026, 12, 31), 6, 2026, 12, Android, Full),
    ]);

    /// <summary>Advanced access on the 18th of February 2027, the full release on the 23rd.</summary>
    private static ComingSoonCandidate Fable() => new(Game(92550, "Fable"), 430,
    [
        Day(924163, 92550, new DateOnly(2027, 2, 18), Pc, AdvancedAccess),
        Day(924164, 92550, new DateOnly(2027, 2, 23), Pc),
        Day(924208, 92550, new DateOnly(2027, 2, 23), Ps5),
        Day(924209, 92550, new DateOnly(2027, 2, 18), Ps5, AdvancedAccess),
    ]);

    private static readonly IReadOnlySet<int> None = new HashSet<int>();

    private static IReadOnlyList<ComingSoonRelease> Compose(
        IEnumerable<ComingSoonCandidate> candidates, DateOnly? today = null, IReadOnlySet<int>? pinned = null, IReadOnlySet<int>? hidden = null) =>
        ComingSoon.Compose(candidates, pinned ?? None, hidden ?? None, today ?? Today);

    [Fact]
    public void Compose_TheDayTheRulesWereDrawn_ShowsWhatArrivesInTheWindowInTheOrderItArrives()
    {
        var panel = Compose([GtaVi(), PhantomBladeZero(), OcarinaOfTime(), OutOfWords(), Witchbrook(), ActsOfBlood(), PetitPlanet(), Fable()]);

        // Witchbrook is only a year and Fable is past the ninety days. A quarter follows the days it ends after.
        Assert.Equal(
            ["Phantom Blade Zero", "The Legend of Zelda: Ocarina of Time", "Grand Theft Auto VI", "Acts of Blood", "Petit Planet", "Out of Words"],
            panel.Select(r => r.Game.Name));
    }

    [Fact]
    public void Compose_ADay_IsShownToTheDayOnTheRowsOfThatDay()
    {
        var gta = Assert.Single(Compose([GtaVi()]));

        Assert.Equal((ReleasePrecision.Day, new DateOnly(2026, 11, 19)), (gta.Precision, gta.Starts));
        Assert.Equal([Ps5, SeriesXs], gta.Platforms);
    }

    [Fact]
    public void Compose_AQuarterOverlappingTheWindow_IsShownAsTheQuarter()
    {
        var outOfWords = Assert.Single(Compose([OutOfWords()]));

        Assert.Equal((ReleasePrecision.Quarter, new DateOnly(2027, 1, 1)), (outOfWords.Precision, outOfWords.Starts));
        Assert.Equal(4, outOfWords.Platforms.Count);
    }

    [Fact]
    public void Compose_AYearAlone_IsNotADateThePanelStandsBehind()
    {
        Assert.Empty(Compose([Witchbrook()]));
    }

    [Fact]
    public void Compose_ADayBesideYears_IsTheDay_OnlyOnThePlatformItIsFor()
    {
        var acts = Assert.Single(Compose([ActsOfBlood()]));

        Assert.Equal((ReleasePrecision.Day, new DateOnly(2026, 12, 4)), (acts.Precision, acts.Starts));
        Assert.Equal([Pc], acts.Platforms);
    }

    [Fact]
    public void Compose_TheFinestRowInTheWindow_WinsOverAnEarlierCoarserOne()
    {
        // Two consoles known to the day, and PC only to a quarter that starts earlier.
        var gta = GtaVi();
        var withPcLater = gta with { Rows = [.. gta.Rows, new(1, 52189, new DateOnly(2026, 12, 31), 6, 2026, 12, Pc, Full)] };

        var shown = Assert.Single(Compose([withPcLater]));

        Assert.Equal((ReleasePrecision.Day, new DateOnly(2026, 11, 19)), (shown.Precision, shown.Starts));
        Assert.DoesNotContain(Pc, shown.Platforms);
    }

    [Fact]
    public void Compose_OnlyAFullReleaseCounts_NotAdvancedAccess()
    {
        var fable = Assert.Single(Compose([Fable()], today: new DateOnly(2027, 1, 1)));

        Assert.Equal(new DateOnly(2027, 2, 23), fable.Starts);
    }

    [Fact]
    public void Compose_OutOnADayAlreadyPast_IsNotComingSoon()
    {
        // The day after Phantom Blade Zero came out.
        var panel = Compose([PhantomBladeZero(), GtaVi()], today: new DateOnly(2026, 10, 30));

        Assert.Equal(["Grand Theft Auto VI"], panel.Select(r => r.Game.Name));
    }

    [Fact]
    public void Compose_AMonthAlreadyBegun_StillCounts_AndAPastQuarterIsPassedOver()
    {
        // "October 2026" on the 25th of October, beside a Q3 2026 IGDB never came back to.
        var game = new ComingSoonCandidate(Game(1, "Known to October"), 30,
        [
            new(10, 1, new DateOnly(2026, 10, 1), 1, 2026, 10, Pc, Full),
            new(11, 1, new DateOnly(2026, 9, 30), 5, 2026, 9, Ps5, Full),
        ]);

        var shown = Assert.Single(Compose([game]));

        Assert.Equal((ReleasePrecision.Month, new DateOnly(2026, 10, 1)), (shown.Precision, shown.Starts));
        Assert.Equal([Pc], shown.Platforms);
    }

    [Fact]
    public void Compose_UnderTheFloorOfFollows_IsLeftOut_UnlessPinned()
    {
        var quiet = new ComingSoonCandidate(Game(2, "Quiet"), ComingSoon.MinHypes - 1, [Day(20, 2, new DateOnly(2026, 11, 1), Pc)]);

        Assert.Empty(Compose([quiet]));
        Assert.Single(Compose([quiet], pinned: new HashSet<int> { 2 }));
    }

    [Fact]
    public void Compose_APin_NeverCarriesAGamePastTheDates()
    {
        Assert.Empty(Compose([Witchbrook()], pinned: new HashSet<int> { 67195 }));
    }

    [Fact]
    public void Compose_AtMostTen_TheMostFollowed_WithThePinnedFirst()
    {
        var many = Enumerable.Range(1, 12)
            .Select(i => new ComingSoonCandidate(Game(i, $"Game {i}"), 100 + i, [Day(i, i, new DateOnly(2026, 11, i), Pc)]))
            .Append(new ComingSoonCandidate(Game(99, "Pinned"), 0, [Day(99, 99, new DateOnly(2026, 12, 1), Pc)]))
            .ToList();

        var panel = Compose(many, pinned: new HashSet<int> { 99 });

        Assert.Equal(ComingSoon.MaxShown, panel.Count);
        Assert.Contains(panel, r => r.Game.Id == 99);
        // The pin takes one of the ten, so the three least followed of the twelve are left out.
        Assert.DoesNotContain(panel, r => r.Game.Id is 1 or 2 or 3);
    }

    [Fact]
    public void Compose_Hidden_IsNeverShown_HoweverFollowed()
    {
        var panel = Compose([GtaVi(), PhantomBladeZero()], hidden: new HashSet<int> { 52189 });

        Assert.Equal(["Phantom Blade Zero"], panel.Select(r => r.Game.Name));
    }

    [Theory]
    [InlineData(IgdbGameStatuses.Cancelled)]
    [InlineData(IgdbGameStatuses.Rumored)]
    public void Compose_CancelledOrRumoured_IsNotComing(int status)
    {
        var gta = GtaVi();

        Assert.Empty(Compose([gta with { Game = gta.Game with { GameStatus = status } }]));
    }

    [Fact]
    public void Compose_NotANewGame_IsLeftOut_PinnedOrNot()
    {
        // A pinned game is asked for by its id, so these rules are all that keep a DLC or an edition out.
        var dlc = new ComingSoonCandidate(Game(3, "A DLC", IgdbGameTypes.Dlc), 500, [Day(30, 3, new DateOnly(2026, 11, 1), Pc)]);
        var edition = new ComingSoonCandidate(Game(4, "An edition", versionParent: 52189), 500, [Day(40, 4, new DateOnly(2026, 11, 1), Pc)]);

        Assert.Empty(Compose([dlc, edition], pinned: new HashSet<int> { 3, 4 }));
    }
}

/// <summary>The panel's one IGDB query, and what IGDB's answer to it becomes.</summary>
public class ComingSoonQueryTests
{
    private static long Unix(DateOnly day) =>
        new DateTimeOffset(day.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero).ToUnixTimeSeconds();

    [Fact]
    public void BuildComingSoonQuery_AsksFromThisMonthsFirstToAQuarterPastTheWindow_MostFollowedFirst()
    {
        var query = IgdbService.BuildComingSoonQuery(new DateOnly(2026, 10, 25), []);

        // The first of October holds a game known only to be "October"; a quarter starting inside the ninety
        // days is stored on a last day up to ninety-two days after them.
        Assert.Contains(
            "where game_type = (0,4,8,9) & version_parent = null & hypes >= 20"
            + $" & first_release_date >= {Unix(new DateOnly(2026, 10, 1))} & first_release_date < {Unix(new DateOnly(2027, 4, 26))};",
            query);
        Assert.Contains("sort hypes desc;", query);
        Assert.Contains("limit 500;", query);
        Assert.Contains("release_dates.platform.abbreviation", query);
    }

    [Fact]
    public void BuildComingSoonQuery_WithPins_AsksForThemByIdBeside()
    {
        var query = IgdbService.BuildComingSoonQuery(new DateOnly(2026, 10, 25), [12, 34]);

        Assert.Matches(@"where \(game_type = .*\) \| id = \(12,34\);", query);
    }
}

public class ComingSoonJsonTests
{
    /// <summary>Grand Theft Auto VI as IGDB answered the panel's query on 2026-10-25.</summary>
    private const string GamesPayload = """
        [
          {
            "id": 52189,
            "cover": { "id": 600115, "image_id": "cocv1v" },
            "first_release_date": 1795046400,
            "hypes": 1111,
            "name": "Grand Theft Auto VI",
            "release_dates": [
              { "id": 831835, "date": 1795046400, "m": 11, "platform": { "id": 169, "abbreviation": "Series X|S", "name": "Xbox Series X|S" }, "y": 2026, "status": 6, "date_format": 0 },
              { "id": 831834, "date": 1795046400, "m": 11, "platform": { "id": 167, "abbreviation": "PS5", "name": "PlayStation 5" }, "y": 2026, "status": 6, "date_format": 0 }
            ],
            "game_type": 0
          }
        ]
        """;

    private const string TokenPayload =
        """{ "access_token": "token", "expires_in": 3600, "token_type": "bearer" }""";

    private sealed class StubHandler : HttpMessageHandler
    {
        public List<string> Queries { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri?.Host == "id.twitch.tv") return Json(TokenPayload);

            Assert.EndsWith("/games", request.RequestUri!.AbsolutePath);
            Queries.Add(await request.Content!.ReadAsStringAsync(cancellationToken));
            return Json(GamesPayload);
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

        return (new IgdbService(factory, configuration, new MemoryCache(new MemoryCacheOptions()), NullLogger<IgdbService>.Instance), handler);
    }

    [Fact]
    public async Task GetComingSoonCandidatesAsync_GivesEachRowItsGame_AndKeepsTheFollows()
    {
        var (service, _) = NewService();

        var candidates = await service.GetComingSoonCandidatesAsync(new DateOnly(2026, 10, 25), []);

        var gta = Assert.Single(candidates.Games);
        Assert.Equal((52189, "Grand Theft Auto VI", 1111), (gta.Game.Id, gta.Game.Name, gta.Hypes));
        Assert.Equal("https://images.igdb.com/igdb/image/upload/t_cover_big/cocv1v.jpg", gta.Game.CoverImageUrl);
        Assert.All(gta.Rows, row => Assert.Equal((52189, new DateOnly(2026, 11, 19), 0), (row.GameId, row.Date, row.DateFormat)));
        Assert.Equal(["Series X|S", "PS5"], gta.Rows.Select(r => r.Platform!.Abbreviation));
        Assert.False(candidates.Truncated);
    }

    [Fact]
    public async Task GetComingSoonCandidatesAsync_AsksIgdbOnceADay_AndAgainForAnotherPin()
    {
        var (service, igdb) = NewService();

        await service.GetComingSoonCandidatesAsync(new DateOnly(2026, 10, 25), []);
        await service.GetComingSoonCandidatesAsync(new DateOnly(2026, 10, 25), []);
        await service.GetComingSoonCandidatesAsync(new DateOnly(2026, 10, 25), [67195]);
        await service.GetComingSoonCandidatesAsync(new DateOnly(2026, 10, 26), []);

        Assert.Equal(3, igdb.Queries.Count);
    }
}
