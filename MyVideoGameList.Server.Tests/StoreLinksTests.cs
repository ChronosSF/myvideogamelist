using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models.Igdb;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The game page's "Where to play" row, from IGDB's two sources. The ids are IGDB's as seen in live
/// responses on 2026-10-17: website types 13 Steam, 15 Itch, 16 Epic, 17 GOG, 22 Xbox, 23 Playstation,
/// 24 Nintendo; external game sources 1 Steam, 5 GOG, 11 Microsoft, 26 Epic Games Store, 30 Itchio,
/// 36 Playstation Store US.
/// </summary>
public class StoreLinksTests
{
    private static IgdbWebsite Website(int id, int? type, string? url) => new(id, url, type);

    private static IgdbExternalGame Synced(int id, int? source, string? url, string? uid = null) =>
        new(id, 1942, uid, source, url);

    private static List<StoreLinkDto> Map(
        IReadOnlyCollection<IgdbWebsite>? websites = null, IReadOnlyCollection<IgdbExternalGame>? synced = null) =>
        StoreLinks.Map(websites, synced);

    [Fact]
    public void Map_EveryStoreThePageKnows_ListsThemInOneFixedOrder()
    {
        // Shuffled, as IGDB returns them. The page lists the stores in the same order on every game,
        // so a reader looking for one finds it where it was on the last page.
        var result = Map(
        [
            Website(1, 24, "https://www.nintendo.com/us/store/products/celeste-switch/"),
            Website(2, 15, "https://maddymakesgamesinc.itch.io/celeste"),
            Website(3, 23, "https://store.playstation.com/en-us/concept/231477"),
            Website(4, 13, "https://store.steampowered.com/app/504230"),
            Website(5, 22, "https://www.xbox.com/en-us/games/store/celeste/BWMQL2RPWBHB"),
            Website(6, 16, "https://store.epicgames.com/p/celeste"),
            Website(7, 17, "https://www.gog.com/en/game/celeste"),
        ]);

        Assert.Equal(
            ["Steam", "GOG", "Epic Games Store", "PlayStation Store", "Microsoft Store", "Nintendo eShop", "itch.io"],
            result.Select(link => link.Store));
    }

    [Fact]
    public void Map_AStoreInBothSources_ListsItOnceFromTheWebsiteRow()
    {
        // IGDB keeps one curated website of each kind, where its store syncs keep a row per edition.
        var result = Map(
            [Website(45842, 13, "https://store.steampowered.com/app/504230")],
            [Synced(3888, 1, "https://store.steampowered.com/app/504230/Celeste/")]);

        Assert.Equal([new StoreLinkDto("Steam", "https://store.steampowered.com/app/504230")], result);
    }

    [Fact]
    public void Map_AStoreOnlyInTheSyncedRows_TakesItFromThere()
    {
        var result = Map(synced: [Synced(2627282, 26, "https://store.epicgames.com/en-US/p/celeste")]);

        Assert.Equal([new StoreLinkDto("Epic Games Store", "https://store.epicgames.com/en-US/p/celeste")], result);
    }

    [Fact]
    public void Map_SeveralSyncedRowsForOneStore_TakesTheOldestWhateverOrderTheyArriveIn()
    {
        // Mystic Pathways has four on the Microsoft Store: the game and three bundles. Without an order
        // of its own the link would follow whichever IGDB listed first.
        var result = Map(synced:
        [
            Synced(3020594, 11, "https://www.xbox.com/en-us/games/store/mystic-pathways/9PL7C2RPVWM8"),
            Synced(3020586, 11, "https://www.xbox.com/en-us/games/store/mystic-pathways-xbox-one/9PFJT5B7R4RP"),
            Synced(3020591, 11, "https://www.xbox.com/en-us/games/store/mystic-pathways-xbox-bundle/9P6XHQPZ5GT5"),
        ]);

        Assert.Equal(
            "https://www.xbox.com/en-us/games/store/mystic-pathways-xbox-one/9PFJT5B7R4RP",
            Assert.Single(result).Url);
    }

    [Fact]
    public void Map_SeveralWebsiteRowsForOneStore_TakesTheOldestWhateverOrderTheyArriveIn()
    {
        var result = Map(
        [
            Website(2067884, 17, "https://www.gog.com/en/game/the_witcher_3_wild_hunt_game_of_the_year_edition"),
            Website(119948, 17, "https://www.gog.com/game/the_witcher_3_wild_hunt"),
        ]);

        Assert.Equal("https://www.gog.com/game/the_witcher_3_wild_hunt", Assert.Single(result).Url);
    }

    [Fact]
    public void Map_AnUnusableRow_FallsThroughToTheNextOfTheSameSource()
    {
        // IGDB holds Steam website rows that are workshop items on steamcommunity.com.
        var result = Map(
        [
            Website(1, 13, "https://steamcommunity.com/sharedfiles/filedetails/?id=92990904"),
            Website(2, 13, "https://store.steampowered.com/app/504230"),
        ]);

        Assert.Equal("https://store.steampowered.com/app/504230", Assert.Single(result).Url);
    }

    [Fact]
    public void Map_AnUnusableWebsiteRow_FallsThroughToTheSyncedRow()
    {
        var result = Map(
            [Website(1, 16, "https://www.xbox.com/en-us/games/store/celeste/BWMQL2RPWBHB")],
            [Synced(2, 26, "https://store.epicgames.com/en-US/p/celeste")]);

        Assert.Equal([new StoreLinkDto("Epic Games Store", "https://store.epicgames.com/en-US/p/celeste")], result);
    }

    [Fact]
    public void Map_MicrosoftsTwoHosts_AreOneStore()
    {
        // IGDB's "Microsoft" rows use www.microsoft.com and www.xbox.com alike, and the first redirects
        // to the second.
        var result = Map(
            [Website(816073, 22, "https://www.xbox.com/en-us/games/store/celeste/BWMQL2RPWBHB")],
            [Synced(2728031, 11, "https://www.microsoft.com/en-us/p/-1-/BWMQL2RPWBHB")]);

        Assert.Equal(
            [new StoreLinkDto("Microsoft Store", "https://www.xbox.com/en-us/games/store/celeste/BWMQL2RPWBHB")],
            result);
    }

    [Theory]
    [InlineData(13, "https://store.steampowered.com/app/504230", "Steam")]
    [InlineData(17, "https://www.gog.com/en/game/celeste", "GOG")]
    [InlineData(17, "https://gog.com/game/celeste", "GOG")]
    [InlineData(16, "https://store.epicgames.com/p/celeste", "Epic Games Store")]
    [InlineData(16, "https://www.epicgames.com/store/product/celeste", "Epic Games Store")]
    [InlineData(16, "https://epicgames.com/store/en-US/p/celeste", "Epic Games Store")]
    [InlineData(23, "https://store.playstation.com/en-us/concept/231477", "PlayStation Store")]
    [InlineData(22, "https://www.xbox.com/en-us/games/store/celeste/BWMQL2RPWBHB", "Microsoft Store")]
    [InlineData(22, "https://www.microsoft.com/en-us/p/-1-/BWMQL2RPWBHB", "Microsoft Store")]
    [InlineData(24, "https://www.nintendo.com/us/store/products/celeste-switch/", "Nintendo eShop")]
    [InlineData(15, "https://maddymakesgamesinc.itch.io/celeste", "itch.io")]
    [InlineData(15, "https://itch.io/jam/celeste-classic", "itch.io")]
    [InlineData(15, "https://Hempuli.Itch.IO/baba", "itch.io")]
    public void Map_APageOnEveryHostAStoreServes_IsKept(int type, string url, string store)
    {
        // Every host in the table, each seen in IGDB's rows for its store.
        var link = Assert.Single(Map([Website(1, type, url)]));

        Assert.Equal(store, link.Store);
        Assert.Equal(url, link.Url, ignoreCase: true);
    }

    [Theory]
    [InlineData("https://store.steampowered.com/bundle/63198/Cairn_Deluxe_Edition/")]
    [InlineData("https://store.steampowered.com/sub/47880/")]
    [InlineData("https://store.steampowered.com//app/4887970/")]
    public void Map_SteamsOtherProductPages_AreKept(string url)
    {
        // A bundle is the page for Cairn's deluxe edition, and Steam serves the doubled slash IGDB holds.
        Assert.Equal(url, Assert.Single(Map([Website(1, 13, url)])).Url);
    }

    [Theory]
    [InlineData("https://store.steampowered.com/http://steamcommunity.com/sharedfiles/filedetails/?id=883541917")]
    [InlineData("https://store.steampowered.com/about/")]
    [InlineData("https://store.steampowered.com/app/")]
    public void Map_ASteamPathThatIsNoProduct_FallsThroughToTheSyncedRow(string url)
    {
        // The first is a row IGDB holds: a workshop item pasted after the host.
        var result = Map([Website(1, 13, url)], [Synced(2, 1, "https://store.steampowered.com/app/504230")]);

        Assert.Equal("https://store.steampowered.com/app/504230", Assert.Single(result).Url);
    }

    [Theory]
    [InlineData(
        "https://www.gog.com/en/game/broken_sword_4?cjdata=MXxOfDB8WXww&utm_campaign=cj&utm_medium=affiliate&utm_source=cj",
        "https://www.gog.com/en/game/broken_sword_4")]
    [InlineData(
        "https://store.steampowered.com/app/4895540/Digital_Waste/?curator_clanid=44759820",
        "https://store.steampowered.com/app/4895540/Digital_Waste/")]
    [InlineData(
        "https://store.steampowered.com/app/5315910/Hasami_Moonlight_Trim/?utm_source=igdb&utm_medium=referral",
        "https://store.steampowered.com/app/5315910/Hasami_Moonlight_Trim/")]
    [InlineData(
        "https://www.nintendo.com/us/store/products/deltarune-switch/?srsltid=AfmBOopaZ6FUP4FgMXYdlf0Y4f8C",
        "https://www.nintendo.com/us/store/products/deltarune-switch/")]
    [InlineData(
        "https://stairfallinstitute.itch.io/the-heat-of-battle?ac=jXdAbFQF",
        "https://stairfallinstitute.itch.io/the-heat-of-battle")]
    [InlineData(
        "https://store.epicgames.com/p/marvel-rivals-182004?lang=en-US#about",
        "https://store.epicgames.com/p/marvel-rivals-182004")]
    public void Map_AnAddressWithAQueryOrAFragment_IsCutAtItsPath(string url, string expected)
    {
        // IGDB's own rows. GOG's carries its affiliate network's tracking and itch.io's `ac` is an affiliate
        // code; no store's game page needs a query, and the row pays nobody for a click.
        var type = new Uri(url).Host switch
        {
            "www.gog.com" => 17,
            "store.steampowered.com" => 13,
            "www.nintendo.com" => 24,
            "stairfallinstitute.itch.io" => 15,
            _ => 16,
        };

        Assert.Equal(expected, Assert.Single(Map([Website(1, type, url)])).Url);
    }

    [Theory]
    [InlineData("https://fleamm.itch.io/lost-in-time-playtest?secret=TRIX3AO2dkZuRl7jtCfA29NMKYQ")]
    [InlineData("https://spotlightor.itch.io/yet-another-exhausting-day?password=spotlightor")]
    [InlineData("https://fleamm.itch.io/lost-in-time-playtest?utm_source=igdb&Secret=abc")]
    public void Map_APageThatOpensOnlyWithAKey_IsPassedOverRatherThanCut(string url)
    {
        // The first two are rows IGDB holds. Cut, the address leads to a page that will not open; whole,
        // it hands the key to everybody. Another row for the store can still answer.
        Assert.Empty(Map([Website(1, 15, url)]));
        Assert.Equal(
            "https://maddymakesgamesinc.itch.io/celeste",
            Assert.Single(Map([Website(1, 15, url)], [Synced(2, 30, "https://maddymakesgamesinc.itch.io/celeste")])).Url);
    }

    [Theory]
    // Kinds of row IGDB holds: a misfiled kind, a workshop item, a typo, another misfiled kind.
    [InlineData(16, "https://www.xbox.com/en-us/games/store/celeste/BWMQL2RPWBHB")]
    [InlineData(13, "https://steamcommunity.com/sharedfiles/filedetails/?id=3636926391")]
    [InlineData(16, "https://store.epicgames.coms/p/celeste")]
    [InlineData(23, "https://www.xbox.com/en-us/games/store/celeste/BWMQL2RPWBHB")]
    // Made up, to probe the host check: look-alikes, a host inside the path, user info, a neighbour.
    [InlineData(13, "https://store.steampowered.com.example.net/app/504230")]
    [InlineData(13, "https://example.net/store.steampowered.com/app/504230")]
    [InlineData(13, "https://store.steampowered.com@example.net/app/504230")]
    [InlineData(15, "https://example.net/itch.io/celeste")]
    [InlineData(15, "https://notitch.io/celeste")]
    public void Map_AnAddressOnAHostThatIsNotTheStores_IsSkipped(int type, string url)
    {
        // Under a store's name, the link has to lead to that store.
        Assert.Empty(Map([Website(1, type, url)]));
    }

    [Theory]
    [InlineData("http://store.steampowered.com/app/504230")]
    [InlineData("javascript:alert(document.cookie)")]
    [InlineData("ftp://store.steampowered.com/app/504230")]
    [InlineData("store.steampowered.com/app/504230")]
    [InlineData("/app/504230")]
    [InlineData("https://store.steampowered.com:8443/app/504230")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Map_AnAddressThatIsNotAnHttpsPage_IsSkipped(string? url)
    {
        Assert.Empty(Map([Website(1, 13, url)]));
    }

    [Theory]
    [InlineData(13, "https://store.steampowered.com/")]
    [InlineData(17, "https://www.gog.com")]
    [InlineData(24, "https://www.nintendo.com/?srsltid=x")]
    public void Map_TheStoresFrontPage_IsSkipped(int type, string url)
    {
        // A link to the store and not to the game answers nothing the store's name does not.
        Assert.Empty(Map([Website(1, type, url)]));
    }

    [Fact]
    public void Map_ASyncedRowWithoutAnAddress_IsPassedOverRatherThanGivenOneBuiltFromItsId()
    {
        // Only Steam's synced rows ever lack an address, and for every game whose only Steam link was one
        // — Lumines (app 11900) and realMyst (63600) among 45 opened — Steam no longer sells it: the page
        // built from the id redirects to Steam's front page.
        Assert.Empty(Map(synced:
        [
            Synced(1, 1, null, uid: "11900"),
            Synced(2, 5, null, uid: "1207664663"),
            Synced(3, 36, null, uid: "204794"),
        ]));
    }

    [Fact]
    public void Map_LinksThePageDoesNotList_AreIgnored()
    {
        var result = Map(
        [
            Website(1, 1, "https://www.celestegame.com/"),
            Website(2, 3, "https://en.wikipedia.org/wiki/Celeste_(video_game)"),
            Website(3, 4, "https://www.facebook.com/CDPROJEKTRED"),
            Website(4, 12, "https://play.google.com/store/apps/details?id=com.example"),
            Website(5, null, "https://store.steampowered.com/app/504230"),
        ],
        [
            // Amazon, Twitch, the closed Xbox 360 Marketplace, and Game Pass's cloud catalogue.
            Synced(6, 20, "https://amazon.com/dp/B07SH3D6HT"),
            Synced(7, 14, "https://www.twitch.tv/directory/game/Celeste"),
            Synced(8, 31, "https://marketplace.xbox.com/en-US/Product/ArcaniA/66acd000-77fe-1000-9115-d8024a5707d2"),
            Synced(9, 54, "https://www.microsoft.com/en-us/p/-1-/BWMQL2RPWBHB"),
            Synced(10, null, "https://store.steampowered.com/app/504230"),
        ]);

        Assert.Empty(result);
    }

    [Theory]
    [InlineData("http://marketplace.xbox.com/en-US/Product/ArcaniA/66acd000-77fe-1000-9115-d8024a5707d2")]
    [InlineData("https://marketplace.xbox.com/en-US/Product/ArcaniA/66acd000-77fe-1000-9115-d8024a5707d2")]
    public void Map_TheClosedMarketplaceFiledUnderMicrosoft_IsIgnored(string url)
    {
        // IGDB files 1,132 of the Xbox 360 store's addresses under "Microsoft" (11). Neither the scheme nor
        // the host is one the Microsoft Store row takes.
        Assert.Empty(Map(synced: [Synced(1, 11, url)]));
    }

    [Fact]
    public void Map_ASyncedRowWithNoSource_IsNotTakenForTheStoreWithNoSource()
    {
        // The Nintendo eShop has no external_games source. A row with none must not match it by both
        // being missing.
        Assert.Empty(Map(synced: [Synced(1, null, "https://www.nintendo.com/us/store/products/celeste-switch/")]));
    }

    [Fact]
    public void Map_NothingFromIgdb_ReturnsAnEmptyList()
    {
        Assert.Empty(Map());
        Assert.Empty(Map([], []));
    }
}
