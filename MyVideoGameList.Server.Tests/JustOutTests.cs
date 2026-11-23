using System.Net;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Releases;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The rules of the home page's Just out panel (ADR 0073), against games, rows and Twitch figures recorded
/// from live IGDB on 2026-10-25, the day the rules were drawn, and on 2026-11-22, the day the follows and the
/// pins joined them (ADR 0104).
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
        IEnumerable<JustOutCandidate> candidates,
        DateOnly? today = null,
        IReadOnlySet<int>? hidden = null,
        IReadOnlySet<int>? pinned = null) =>
        JustOut.Compose(candidates, pinned ?? None, hidden ?? None, today ?? Today);

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
    public void Compose_AtMostNine_TheMostWatched()
    {
        var many = Enumerable.Range(1, 12)
            .Select(i => new JustOutCandidate(Game(i, $"Game {i}"), i, [Day(i, i, new DateOnly(2026, 10, i), Pc)]))
            .ToList();

        var panel = Compose(many);

        Assert.Equal(JustOut.MaxShown, panel.Count);
        Assert.DoesNotContain(panel, r => r.Game.Id is 1 or 2 or 3);
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

    // From here the games, their rows and both counts are as IGDB answered on 2026-11-22 (ADR 0104), when the
    // nine most watched new games held none of the thirty-eight that people had followed ahead of release.

    private static readonly DateOnly TheDayOfTheFollows = new(2026, 11, 22);

    private static readonly PlatformDto Mac = new(14, "Mac", "Mac", null, null);
    private static readonly PlatformDto Ps4 = new(48, "PlayStation 4", "PS4", null, null);
    private static readonly PlatformDto XboxOne = new(49, "Xbox One", "XONE", null, null);

    /// <summary>
    /// Followed by 1,584 and three days out. IGDB's Twitch figure for it was 0.00000025, against 0.000226 for
    /// the five-hundredth most watched game, so it was never a candidate by that count.
    /// </summary>
    private static JustOutCandidate GrandTheftAutoVi() => new(Game(52189, "Grand Theft Auto VI"), 0,
    [
        Day(831835, 52189, new DateOnly(2026, 11, 19), SeriesXs),
        Day(831834, 52189, new DateOnly(2026, 11, 19), Ps5),
    ], Hypes: 1584);

    private static JustOutCandidate PhantomBladeZero() => new(Game(250618, "Phantom Blade Zero"), 0,
    [
        Day(920986, 250618, new DateOnly(2026, 10, 29), Pc),
        Day(920987, 250618, new DateOnly(2026, 10, 29), Ps5),
    ], Hypes: 227);

    /// <summary>On both lists: followed by 242, and the nineteenth most watched of the new games.</summary>
    private static JustOutCandidate ControlResonant() => new(Game(225582, "Control Resonant"), 0.001701,
    [
        Day(921304, 225582, new DateOnly(2026, 9, 24), Mac),
        Day(921305, 225582, new DateOnly(2026, 9, 24), Pc),
        Day(921306, 225582, new DateOnly(2026, 9, 24), Ps5),
        Day(921308, 225582, new DateOnly(2026, 9, 24), SeriesXs),
        Day(921307, 225582, new DateOnly(2026, 9, 22), Ps5, AdvancedAccess),
    ], Hypes: 242);

    /// <summary>The most watched new game that day, followed by six.</summary>
    private static JustOutCandidate EaSportsFc27() => new(Game(408819, "EA Sports FC 27"), 0.060283,
    [
        Day(945295, 408819, new DateOnly(2026, 9, 18), Ps5, AdvancedAccess),
        Day(945296, 408819, new DateOnly(2026, 9, 25), XboxOne),
        Day(945297, 408819, new DateOnly(2026, 9, 18), XboxOne, AdvancedAccess),
        Day(945298, 408819, new DateOnly(2026, 9, 25), SeriesXs),
        Day(945299, 408819, new DateOnly(2026, 9, 18), SeriesXs, AdvancedAccess),
        Day(945300, 408819, new DateOnly(2026, 9, 25), Switch),
        Day(945301, 408819, new DateOnly(2026, 9, 25), Switch2),
        Day(945290, 408819, new DateOnly(2026, 9, 25), Pc),
        Day(945291, 408819, new DateOnly(2026, 9, 18), Pc, AdvancedAccess),
        Day(945292, 408819, new DateOnly(2026, 9, 25), Ps4),
        Day(945293, 408819, new DateOnly(2026, 9, 18), Ps4, AdvancedAccess),
        Day(945294, 408819, new DateOnly(2026, 9, 25), Ps5),
    ], Hypes: 6);

    private static JustOutCandidate SonicPicoPark() => new(Game(404714, "Sonic Pico Park"), 0.021298,
    [
        Day(963297, 404714, new DateOnly(2026, 11, 12), Mac),
        Day(963298, 404714, new DateOnly(2026, 11, 12), Pc),
        Day(963299, 404714, new DateOnly(2026, 11, 12), Ps5),
        Day(963300, 404714, new DateOnly(2026, 11, 12), Switch2),
        Day(963301, 404714, new DateOnly(2026, 11, 12), SeriesXs),
        Day(963302, 404714, new DateOnly(2026, 11, 12), Switch),
    ], Hypes: 6);

    /// <summary>Third most watched of the new games, followed by one.</summary>
    private static JustOutCandidate ProbablyStolen() => new(Game(412177, "Probably Stolen"), 0.021193,
        [Day(965280, 412177, new DateOnly(2026, 10, 28), Pc)], Hypes: 1);

    /// <summary>A game with one day's release on PC, for the rules that are about the counts alone.</summary>
    private static JustOutCandidate Counted(int id, double watched = 0, int hypes = 0, DateOnly? day = null) =>
        new(Game(id, $"Game {id}"), watched, [Day(id, id, day ?? new DateOnly(2026, 10, 1), Pc)], Hypes: hypes);

    [Fact]
    public void Compose_FollowedAheadOfItsRelease_IsShown_ThoughTwitchHardlyCountsIt()
    {
        var gta = Assert.Single(Compose([GrandTheftAutoVi()], today: TheDayOfTheFollows));

        Assert.Equal(("Grand Theft Auto VI", new DateOnly(2026, 11, 19)), (gta.Game.Name, gta.Released));
        Assert.Equal(2, gta.Platforms.Count);
    }

    [Fact]
    public void Compose_TheDayOfTheFollows_ShowsTheFollowedBesideTheWatched_TheNewestFirst()
    {
        var panel = Compose(
            [EaSportsFc27(), SonicPicoPark(), ProbablyStolen(), GrandTheftAutoVi(), PhantomBladeZero(), ControlResonant()],
            today: TheDayOfTheFollows);

        Assert.Equal(
            ["Grand Theft Auto VI", "Sonic Pico Park", "Phantom Blade Zero", "Probably Stolen", "EA Sports FC 27", "Control Resonant"],
            panel.Select(r => r.Game.Name));
    }

    [Fact]
    public void Compose_MoreThanNine_TakesTheFollowedAndTheWatchedTurnAbout_TheFollowedFirst()
    {
        // Six followed and nobody watching, six watched and nobody following: five of the first, four of the second.
        var followed = Enumerable.Range(1, 6).Select(i => Counted(100 + i, hypes: 700 - 100 * i));
        var watched = Enumerable.Range(1, 6).Select(i => Counted(200 + i, watched: 7 - i));

        var panel = Compose([.. watched, .. followed]);

        Assert.Equal(
            [101, 102, 103, 104, 105, 201, 202, 203, 204],
            panel.Select(r => r.Game.Id).Order());
    }

    [Fact]
    public void Compose_OnBothLists_IsTakenOnce_AndTheWatchedMoveOnToTheirNext()
    {
        // Game 1 leads both lists. The followed give it; the watched, whose turn would have given it again,
        // give their second instead, so the panel still has four of theirs.
        var both = Counted(1, watched: 9, hypes: 900);
        var followed = Enumerable.Range(1, 5).Select(i => Counted(10 + i, hypes: 600 - 100 * i));
        var watched = Enumerable.Range(1, 5).Select(i => Counted(20 + i, watched: 6 - i));

        var panel = Compose([both, .. followed, .. watched]);

        Assert.Equal([1, 11, 12, 13, 14, 21, 22, 23, 24], panel.Select(r => r.Game.Id).Order());
    }

    [Fact]
    public void Compose_FollowedByFewerThanComingSoonShows_AndNotWatched_IsNotShown()
    {
        Assert.Empty(Compose([Counted(1, hypes: ComingSoon.MinHypes - 1)]));
        Assert.Single(Compose([Counted(1, hypes: ComingSoon.MinHypes)]));
    }

    [Fact]
    public void Compose_OnlyOneCountAnswers_ThePanelIsTheOther()
    {
        // What a count IGDB has withdrawn looks like: every candidate has nothing in it.
        var followedOnly = Enumerable.Range(1, 12).Select(i => Counted(i, hypes: 100 + i));
        var watchedOnly = Enumerable.Range(1, 12).Select(i => Counted(i, watched: i));

        Assert.Equal(JustOut.MaxShown, Compose(followedOnly).Count);
        Assert.Equal(JustOut.MaxShown, Compose(watchedOnly).Count);
    }

    [Fact]
    public void Compose_Pinned_IsShownWhateverItsCounts_AheadOfTheRest()
    {
        // Nine followed fill the panel; the pinned game, with neither count, takes the place of the least.
        var followed = Enumerable.Range(1, 9).Select(i => Counted(i, hypes: 1000 - 100 * i));
        var pinned = Counted(50);

        var panel = Compose([.. followed, pinned], pinned: new HashSet<int> { 50 });

        Assert.Equal(JustOut.MaxShown, panel.Count);
        Assert.Contains(panel, r => r.Game.Id == 50);
        Assert.DoesNotContain(panel, r => r.Game.Id == 9);
    }

    [Fact]
    public void Compose_Pinned_IsNotCarriedPastTheDatesOrTheKindOfGame()
    {
        var pins = new HashSet<int> { 1, 2, 3 };
        var outLongAgo = Counted(1, day: new DateOnly(2026, 7, 1));
        var outToday = Counted(2, day: Today);
        var dlc = new JustOutCandidate(Game(3, "A DLC", IgdbGameTypes.Dlc), 0, [Day(30, 3, new DateOnly(2026, 10, 1), Pc)]);

        Assert.Empty(Compose([outLongAgo, outToday, dlc], pinned: pins));
    }

    [Fact]
    public void Compose_Hidden_IsNeverShown_HoweverFollowed()
    {
        Assert.Empty(Compose([GrandTheftAutoVi()], today: TheDayOfTheFollows, hidden: new HashSet<int> { 52189 }));
    }
}

/// <summary>The panel's three IGDB queries.</summary>
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

    [Fact]
    public void BuildJustOutAwaitedQuery_AsksForTheNewGamesFollowedAheadOfARowInTheNinetyDays_MostFollowedFirst()
    {
        var query = IgdbService.BuildJustOutAwaitedQuery(new DateOnly(2026, 11, 22), []);

        Assert.Contains(
            "where game_type = (0,4,8,9) & version_parent = null & hypes >= 20"
            + $" & release_dates.date >= {Unix(new DateOnly(2026, 8, 24))} & release_dates.date < {Unix(new DateOnly(2026, 11, 22))};",
            query);
        Assert.Contains("sort hypes desc;", query);
        Assert.Contains("limit 500;", query);
        Assert.Contains("first_release_date,hypes,", query);
        Assert.DoesNotContain("first_release_date >=", query);
    }

    [Fact]
    public void BuildJustOutAwaitedQuery_Pinned_AsksForThemByTheirIdWhateverTheyAre()
    {
        var query = IgdbService.BuildJustOutAwaitedQuery(new DateOnly(2026, 11, 22), [52189, 403310]);

        Assert.Contains(
            "where (game_type = (0,4,8,9) & version_parent = null & hypes >= 20"
            + $" & release_dates.date >= {Unix(new DateOnly(2026, 8, 24))} & release_dates.date < {Unix(new DateOnly(2026, 11, 22))})"
            + " | id = (52189,403310);",
            query);
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

    /// <summary>Control Resonant's Twitch figure as IGDB answered it on 2026-11-22.</summary>
    private const string ControlResonantPopularityPayload = """
        [ { "id": 1, "game_id": 225582, "value": 0.001701216261955 } ]
        """;

    /// <summary>Control Resonant as IGDB answered both of the panel's games queries on 2026-11-22.</summary>
    private const string ControlResonant = """
        {
          "id": 225582,
          "cover": { "id": 567807, "image_id": "coc64f" },
          "first_release_date": 1790208000,
          "hypes": 242,
          "name": "Control Resonant",
          "release_dates": [
            { "id": 921305, "date": 1790208000, "m": 9, "platform": { "id": 6, "abbreviation": "PC", "name": "PC (Microsoft Windows)" }, "y": 2026, "status": 6, "date_format": 0 },
            { "id": 921306, "date": 1790208000, "m": 9, "platform": { "id": 167, "abbreviation": "PS5", "name": "PlayStation 5" }, "y": 2026, "status": 6, "date_format": 0 },
            { "id": 921307, "date": 1790035200, "m": 9, "platform": { "id": 167, "abbreviation": "PS5", "name": "PlayStation 5" }, "y": 2026, "status": 34, "date_format": 0 }
          ],
          "game_type": 0
        }
        """;

    /// <summary>
    /// Grand Theft Auto VI as IGDB answered the query for the followed on 2026-11-22: 1,584 follows, and no
    /// place among the five hundred most watched.
    /// </summary>
    private const string GrandTheftAutoVi = """
        {
          "id": 52189,
          "cover": { "id": 600115, "image_id": "cocv1v" },
          "first_release_date": 1795046400,
          "hypes": 1584,
          "name": "Grand Theft Auto VI",
          "release_dates": [
            { "id": 831835, "date": 1795046400, "m": 11, "platform": { "id": 169, "abbreviation": "Series X|S", "name": "Xbox Series X|S" }, "y": 2026, "status": 6, "date_format": 0 },
            { "id": 831834, "date": 1795046400, "m": 11, "platform": { "id": 167, "abbreviation": "PS5", "name": "PlayStation 5" }, "y": 2026, "status": 6, "date_format": 0 }
          ],
          "game_type": 0
        }
        """;

    private const string TokenPayload =
        """{ "access_token": "token", "expires_in": 3600, "token_type": "bearer" }""";

    /// <summary>
    /// IGDB, answering the panel's three queries: the Twitch figures, the games among them, and the games
    /// people followed, which is the games query that states a floor of follows.
    /// </summary>
    private sealed class StubHandler(string popularity, string watched, string followed) : HttpMessageHandler
    {
        public List<string> Endpoints { get; } = [];

        public List<string> Queries { get; } = [];

        /// <summary>While set, IGDB cannot be asked for the most watched: neither their figures nor their games.</summary>
        public bool WatchedFail { get; set; }

        /// <summary>While set, IGDB cannot be asked for the games people followed.</summary>
        public bool FollowedFail { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri?.Host == "id.twitch.tv") return Json(TokenPayload);

            var endpoint = request.RequestUri!.AbsolutePath.Split('/')[^1];
            var query = await request.Content!.ReadAsStringAsync(cancellationToken);
            Endpoints.Add(endpoint);
            Queries.Add(query);

            var asksForTheFollowed = endpoint == "games" && query.Contains("hypes >=");
            if (asksForTheFollowed ? FollowedFail : WatchedFail) throw new HttpRequestException("IGDB is down.");

            if (endpoint == "popularity_primitives") return Json(popularity);
            return Json(asksForTheFollowed ? followed : watched);
        }

        private static HttpResponseMessage Json(string body) =>
            new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    }

    private static (IgdbService Service, StubHandler Igdb) NewService(
        string popularity = PopularityPayload,
        string watched = GamesPayload,
        string followed = "[]",
        ILogger<IgdbService>? logger = null)
    {
        var handler = new StubHandler(popularity, watched, followed);

        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient("Igdb").Returns(_ => new HttpClient(handler));

        var configuration = Substitute.For<IConfiguration>();
        configuration["Igdb:ClientId"].Returns("client-id");
        configuration["Igdb:ClientSecret"].Returns("client-secret");

        return (new IgdbService(factory, configuration, new MemoryCache(new MemoryCacheOptions()), logger ?? NullLogger<IgdbService>.Instance), handler);
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_JoinsEachGameToHowMuchItWasWatched_AndGivesItsRowsTheGame()
    {
        var (service, _) = NewService();

        var candidates = await service.GetJustOutCandidatesAsync(new DateOnly(2026, 10, 25), []);

        Assert.False(candidates.Partial);
        var enshrouded = Assert.Single(candidates.Games);
        Assert.Equal((248643, "Enshrouded", 0.03883792), (enshrouded.Game.Id, enshrouded.Game.Name, enshrouded.Watched));
        Assert.Equal(0, enshrouded.Hypes);
        // The row with no date is not one the rules can place, so it is not a row here.
        Assert.Equal([541319, 934013], enshrouded.Rows.Select(r => r.Id));
        Assert.All(enshrouded.Rows, row => Assert.Equal(248643, row.GameId));
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_AsksIgdbOnceADay()
    {
        var (service, igdb) = NewService();

        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 10, 25), []);
        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 10, 25), []);
        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 10, 26), []);

        Assert.Equal(
            ["popularity_primitives", "games", "games", "popularity_primitives", "games", "games"],
            igdb.Endpoints);
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_NoTwitchFigures_StillAsksForTheFollowed()
    {
        // What a popularity type IGDB has withdrawn looks like: no rows and no error. The panel is then the
        // games people followed, and nothing is asked about the watched.
        var (service, igdb) = NewService(popularity: "[]", followed: $"[{GrandTheftAutoVi}]");

        var candidates = await service.GetJustOutCandidatesAsync(new DateOnly(2026, 11, 22), []);

        // An empty answer is an answer: the list was asked for, and the panel is whole.
        Assert.False(candidates.Partial);
        var gta = Assert.Single(candidates.Games);
        Assert.Equal((52189, "Grand Theft Auto VI", 0d, 1584), (gta.Game.Id, gta.Game.Name, gta.Watched, gta.Hypes));
        Assert.Equal([831835, 831834], gta.Rows.Select(r => r.Id));
        Assert.Equal(["popularity_primitives", "games"], igdb.Endpoints);
        Assert.Contains("hypes >= 20", igdb.Queries[1]);
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_WatchedAndFollowed_IsOneCandidateWithBothCounts()
    {
        var (service, _) = NewService(
            popularity: ControlResonantPopularityPayload,
            watched: $"[{ControlResonant}]",
            followed: $"[{GrandTheftAutoVi},{ControlResonant}]");

        var candidates = await service.GetJustOutCandidatesAsync(new DateOnly(2026, 11, 22), []);

        Assert.Equal(
            [(225582, 0.001701216261955, 242), (52189, 0d, 1584)],
            candidates.Games.Select(c => (c.Game.Id, c.Watched, c.Hypes)));
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_APin_IsAskedForByItsId_AndChangesOnlyTheFollowedQuestion()
    {
        var (service, igdb) = NewService();

        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 11, 22), []);
        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 11, 22), [403310, 52189, 52189]);
        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 11, 22), [52189, 403310]);

        // The followed are asked for twice, not three times: the same pins in another order are the same
        // question. The most watched are asked for once: a pin is nothing to them.
        Assert.Equal(["popularity_primitives", "games", "games", "games"], igdb.Endpoints);
        Assert.DoesNotContain("| id =", igdb.Queries[2]);
        Assert.Contains(") | id = (52189,403310);", igdb.Queries[3]);
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_TheFollowedCannotBeAskedFor_IsTheWatchedAndPartial_AndAsksForThemAloneNext()
    {
        var (service, igdb) = NewService(
            popularity: ControlResonantPopularityPayload,
            watched: $"[{ControlResonant}]",
            followed: $"[{GrandTheftAutoVi},{ControlResonant}]");
        igdb.FollowedFail = true;

        var partial = await service.GetJustOutCandidatesAsync(new DateOnly(2026, 11, 22), []);

        Assert.True(partial.Partial);
        Assert.Equal([225582], partial.Games.Select(c => c.Game.Id));

        // IGDB answers again. The most watched were kept, so only the followed are asked for, and the answer
        // is whole.
        igdb.FollowedFail = false;
        var whole = await service.GetJustOutCandidatesAsync(new DateOnly(2026, 11, 22), []);

        Assert.False(whole.Partial);
        Assert.Equal([225582, 52189], whole.Games.Select(c => c.Game.Id));
        Assert.Equal(["popularity_primitives", "games", "games", "games"], igdb.Endpoints);
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_TheWatchedCannotBeAskedFor_IsTheFollowedAndPartial()
    {
        var (service, igdb) = NewService(followed: $"[{GrandTheftAutoVi}]");
        igdb.WatchedFail = true;

        var candidates = await service.GetJustOutCandidatesAsync(new DateOnly(2026, 11, 22), []);

        Assert.True(candidates.Partial);
        var gta = Assert.Single(candidates.Games);
        Assert.Equal((52189, 0d, 1584), (gta.Game.Id, gta.Watched, gta.Hypes));
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_NeitherCanBeAskedFor_Throws_AndKeepsNothing()
    {
        var (service, igdb) = NewService();
        igdb.WatchedFail = igdb.FollowedFail = true;

        await Assert.ThrowsAsync<HttpRequestException>(
            () => service.GetJustOutCandidatesAsync(new DateOnly(2026, 10, 25), []));

        igdb.WatchedFail = igdb.FollowedFail = false;
        var candidates = await service.GetJustOutCandidatesAsync(new DateOnly(2026, 10, 25), []);

        Assert.False(candidates.Partial);
        Assert.Single(candidates.Games);
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_OnlyThePinnedComeBack_SaysTheFollowedAreMissing()
    {
        // What IGDB dropping its follows looks like while a game is pinned: the pinned game comes back by its
        // id, and nothing else does.
        var logger = new ListLogger<IgdbService>();
        var (service, _) = NewService(followed: $"[{GrandTheftAutoVi}]", logger: logger);

        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 11, 22), [52189]);

        Assert.Contains(logger.At(LogLevel.Warning), e => e.Message.Contains("without its most followed"));
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_BothListsHoldAGame_SaysNothing()
    {
        // Grand Theft Auto VI is pinned and Control Resonant is not, so the followed have a game of their own.
        var logger = new ListLogger<IgdbService>();
        var (service, _) = NewService(
            popularity: ControlResonantPopularityPayload,
            watched: $"[{ControlResonant}]",
            followed: $"[{GrandTheftAutoVi},{ControlResonant}]",
            logger: logger);

        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 11, 22), [52189]);

        Assert.Empty(logger.Entries);
    }

    [Fact]
    public async Task GetJustOutCandidatesAsync_NeitherListHoldsAGame_SaysSoOfEach_AndOnceADay()
    {
        var logger = new ListLogger<IgdbService>();
        var (service, _) = NewService(popularity: "[]", logger: logger);

        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 11, 22), []);
        await service.GetJustOutCandidatesAsync(new DateOnly(2026, 11, 22), []);

        // Each line is about its own list, so the two do not contradict each other.
        var said = logger.At(LogLevel.Warning).Select(e => e.Message).ToList();
        Assert.Equal(2, said.Count);
        Assert.Contains(said, m => m.Contains("without its most watched"));
        Assert.Contains(said, m => m.Contains("without its most followed"));
    }
}
