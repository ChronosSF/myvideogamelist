using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services.Releases;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Which of the games IGDB connects to a game the game page shows (#450, ADR 0084). The rows are The Witcher
/// series and The Witcher 3's children as live IGDB returned them on 2026-11-04, cut to the cases each rule
/// is about.
/// </summary>
public class RelatedGamesTests
{
    private const int TheWitcher = 80;
    private const int EnhancedEdition = 20275;
    private const int DirectorsCut = 27832;
    private const int TheWitcher2 = 478;
    private const int TheWitcher2Enhanced = 20740;
    private const int BattleArena = 9689;
    private const int TheWitcher3 = 1942;
    private const int CollectorsEdition = 44549;
    private const int GameOfTheYear = 22439;
    private const int CompleteEdition = 119402;
    private const int BloodAndWine = 13166;
    private const int FoolsGold = 170450;
    private const int NextGenUpdate = 230102;
    private const int Redux = 283715;
    private const int Remastered = 415005;
    private const int TheWitcherIV = 194662;
    private const int TheWitcherRemake = 220277;

    private static long Unix(int year, int month, int day) =>
        new DateTimeOffset(year, month, day, 0, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds();

    private static RelatedCandidate Row(
        int id, string name, int type, long? released,
        int? parent = null, int? versionParent = null, int? status = null) =>
        new(new CalendarGame(id, name, null, type, parent, versionParent, [], released is not null, status), released);

    private static readonly RelatedCandidate[] Witcher =
    [
        Row(TheWitcher, "The Witcher", IgdbGameTypes.MainGame, Unix(2007, 10, 26)),
        Row(EnhancedEdition, "The Witcher: Enhanced Edition", IgdbGameTypes.ExpandedGame, Unix(2008, 9, 16), parent: TheWitcher),
        Row(DirectorsCut, "The Witcher: Enhanced Edition Director's Cut", IgdbGameTypes.ExpandedGame, Unix(2008, 9, 16), parent: EnhancedEdition),
        Row(TheWitcher2, "The Witcher 2: Assassins of Kings", IgdbGameTypes.MainGame, Unix(2011, 5, 17)),
        Row(TheWitcher2Enhanced, "The Witcher 2: Assassins of Kings - Enhanced Edition", IgdbGameTypes.ExpandedGame, Unix(2012, 4, 16), parent: TheWitcher2),
        // Offline since: game_status 5, which no rule names, so it stays.
        Row(BattleArena, "The Witcher Battle Arena", IgdbGameTypes.MainGame, Unix(2015, 1, 22), status: 5),
        Row(TheWitcher3, "The Witcher 3: Wild Hunt", IgdbGameTypes.MainGame, Unix(2015, 5, 19)),
        Row(CollectorsEdition, "The Witcher 3: Wild Hunt - Collector's Edition", IgdbGameTypes.MainGame, Unix(2015, 6, 19), versionParent: TheWitcher3),
        Row(GameOfTheYear, "The Witcher 3: Wild Hunt - Game of the Year Edition", IgdbGameTypes.Bundle, Unix(2016, 8, 29), versionParent: TheWitcher3),
        Row(CompleteEdition, "The Witcher 3: Wild Hunt - Complete Edition", IgdbGameTypes.Bundle, Unix(2016, 8, 29), versionParent: TheWitcher3),
        Row(BloodAndWine, "The Witcher 3: Wild Hunt - Blood and Wine", IgdbGameTypes.Expansion, Unix(2016, 5, 30), parent: TheWitcher3),
        Row(FoolsGold, "The Witcher 3: Wild Hunt - New Quest 'Fool's Gold'", IgdbGameTypes.Dlc, Unix(2015, 6, 9), parent: TheWitcher3),
        Row(NextGenUpdate, "The Witcher 3: Wild Hunt - Free Next-Gen Update", IgdbGameTypes.Update, Unix(2022, 12, 14), parent: TheWitcher3),
        Row(Redux, "The Witcher 3: Enhanced Edition - Redux", IgdbGameTypes.Mod, Unix(2021, 6, 25), parent: TheWitcher3),
        Row(Remastered, "The Witcher 3: Wild Hunt Remastered", IgdbGameTypes.Remaster, Unix(2026, 9, 29), parent: TheWitcher3),
        // A year-only date, stored as the year's last day.
        Row(TheWitcherIV, "The Witcher IV", IgdbGameTypes.MainGame, Unix(2028, 12, 31)),
        Row(TheWitcherRemake, "The Witcher Remake", IgdbGameTypes.Remake, null, parent: TheWitcher),
    ];

    private static List<int> Ids(IEnumerable<RelatedGameDto> games) => games.Select(g => g.Id).ToList();

    [Fact]
    public void Fold_TheWitcher3_IsItsSeriesInReleaseOrderWithTheUndatedLast()
    {
        var related = RelatedGames.Fold(TheWitcher3, Witcher);

        Assert.Equal(
            [TheWitcher, TheWitcher2, BattleArena, TheWitcher3, Remastered, TheWitcherIV, TheWitcherRemake],
            Ids(related.Games));
        Assert.Equal(TheWitcher3, related.AnchorId);
    }

    [Fact]
    public void Fold_EnhancedEditionsOfOtherGamesInTheSeries_AreFoldedIntoThem()
    {
        // The Director's Cut is a child of the Enhanced Edition, not of The Witcher: found up the chain.
        var related = RelatedGames.Fold(TheWitcher3, Witcher);

        Assert.DoesNotContain(EnhancedEdition, Ids(related.Games));
        Assert.DoesNotContain(DirectorsCut, Ids(related.Games));
        Assert.DoesNotContain(TheWitcher2Enhanced, Ids(related.Games));
    }

    [Fact]
    public void Fold_TheAnchorsOwnExpandedGame_IsACard()
    {
        // On The Witcher's own page its Enhanced Edition is its re-release, so it is shown; the Director's
        // Cut of that is reached through it.
        var related = RelatedGames.Fold(TheWitcher, Witcher);

        Assert.Contains(EnhancedEdition, Ids(related.Games));
        Assert.Contains(DirectorsCut, Ids(related.Games));
        Assert.DoesNotContain(TheWitcher2Enhanced, Ids(related.Games));
    }

    [Fact]
    public void Fold_DlcExpansionsUpdatesAndMods_AreNeitherCardsNorEditions()
    {
        var related = RelatedGames.Fold(TheWitcher3, Witcher);
        var shown = Ids(related.Games).Concat(Ids(related.Editions)).ToList();

        Assert.DoesNotContain(BloodAndWine, shown);
        Assert.DoesNotContain(FoolsGold, shown);
        Assert.DoesNotContain(NextGenUpdate, shown);
        Assert.DoesNotContain(Redux, shown);
    }

    [Fact]
    public void Fold_TheAnchorsEditionsAndBundles_AreItsEditionsInReleaseOrder()
    {
        var related = RelatedGames.Fold(TheWitcher3, Witcher);

        Assert.Equal([CollectorsEdition, GameOfTheYear, CompleteEdition], Ids(related.Editions));
        Assert.Equal(["edition", "bundle", "bundle"], related.Editions.Select(e => e.Kind));
    }

    [Fact]
    public void Fold_AnEditionsAnEditionOfABundle_IsStillTheAnchors()
    {
        // Constructed, as the release spec found it on 2026-09-29 (F3): an edition naming the Complete
        // Edition, a bundle, which names the game. IGDB held no such row on 2026-11-04, so the id is not one.
        RelatedCandidate[] rows =
        [
            .. Witcher,
            Row(900003, "An edition of the Complete Edition", IgdbGameTypes.MainGame, Unix(2025, 5, 19), versionParent: CompleteEdition),
        ];

        var related = RelatedGames.Fold(TheWitcher3, rows);

        Assert.Contains(900003, Ids(related.Editions));
        Assert.DoesNotContain(900003, Ids(related.Games));
    }

    [Fact]
    public void Fold_OnAnEditionsPage_MarksTheGameItIsAnEditionOfAndListsTheOthers()
    {
        var related = RelatedGames.Fold(CollectorsEdition, Witcher);

        Assert.Equal(TheWitcher3, related.AnchorId);
        Assert.Contains(TheWitcher3, Ids(related.Games));
        Assert.Equal([GameOfTheYear, CompleteEdition], Ids(related.Editions));
    }

    [Fact]
    public void Fold_OnABundlesPage_MarksTheGameItBundles()
    {
        var related = RelatedGames.Fold(GameOfTheYear, Witcher);

        Assert.Equal(TheWitcher3, related.AnchorId);
        Assert.Equal([CollectorsEdition, CompleteEdition], Ids(related.Editions));
    }

    [Fact]
    public void Fold_ACancelledOrRumouredGame_IsDropped()
    {
        // Constructed: no Witcher game was cancelled or rumoured on 2026-11-04. The statuses are F4's.
        RelatedCandidate[] rows =
        [
            .. Witcher,
            Row(900001, "A cancelled sequel", IgdbGameTypes.MainGame, null, status: IgdbGameStatuses.Cancelled),
            Row(900002, "A rumoured sequel", IgdbGameTypes.MainGame, null, status: IgdbGameStatuses.Rumored),
        ];

        var related = RelatedGames.Fold(TheWitcher3, rows);

        Assert.DoesNotContain(900001, Ids(related.Games));
        Assert.DoesNotContain(900002, Ids(related.Games));
    }

    [Fact]
    public void Fold_AYearOnlyDate_GivesThatYear()
    {
        var witcherIV = RelatedGames.Fold(TheWitcher3, Witcher).Games.Single(g => g.Id == TheWitcherIV);

        Assert.Equal(2028, witcherIV.ReleaseYear);
        Assert.Equal("game", witcherIV.Kind);
    }

    [Fact]
    public void Fold_EachCard_SaysWhatItIs()
    {
        var games = RelatedGames.Fold(TheWitcher3, Witcher).Games.ToDictionary(g => g.Id);

        Assert.Equal("remaster", games[Remastered].Kind);
        Assert.Equal("remake", games[TheWitcherRemake].Kind);
        Assert.Null(games[TheWitcherRemake].ReleaseYear);
    }

    [Fact]
    public void Fold_AGameInNoSeriesWithNoChildren_IsItselfAlone()
    {
        var related = RelatedGames.Fold(TheWitcher3, [Witcher.Single(r => r.Game.Id == TheWitcher3)]);

        Assert.Equal([TheWitcher3], Ids(related.Games));
        Assert.Empty(related.Editions);
    }

    [Fact]
    public void BuildQuery_WithSeries_AsksForTheGameItsChildrenAndItsSeries()
    {
        var query = RelatedGames.BuildQuery(TheWitcher3, [62]);

        Assert.Contains("where id = 1942 | parent_game = 1942 | version_parent = 1942 | collections = (62);", query);
        Assert.Contains("fields id,name,cover.image_id,game_type,parent_game,version_parent,game_status,first_release_date;", query);
        Assert.Contains("limit 500;", query);
    }

    [Fact]
    public void BuildQuery_WithNoSeries_AsksForTheGameAndItsChildrenOnly()
    {
        var query = RelatedGames.BuildQuery(TheWitcher3, []);

        Assert.Contains("where id = 1942 | parent_game = 1942 | version_parent = 1942;", query);
        Assert.DoesNotContain("collections", query);
    }
}
