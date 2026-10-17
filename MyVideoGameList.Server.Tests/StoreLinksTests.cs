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

    [Fact]
    public void Map_MicrosoftsOtherHost_IsAcceptedOnItsOwn()
    {
        var result = Map(synced: [Synced(3002462, 11, "https://www.microsoft.com/en-us/p/-1-/C3FMRHHXDTFK")]);

        Assert.Equal("https://www.microsoft.com/en-us/p/-1-/C3FMRHHXDTFK", Assert.Single(result).Url);
    }

    [Fact]
    public void Map_ASteamRowWithoutAnAddress_BuildsTheStorePageFromTheAppId()
    {
        // Steam is the one source that leaves the address out, and the one whose pattern was confirmed:
        // 1338610 opens "Guardian Chronicle on Steam".
        var result = Map(synced: [Synced(2000608, 1, null, uid: "1338610")]);

        Assert.Equal([new StoreLinkDto("Steam", "https://store.steampowered.com/app/1338610")], result);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("-5")]
    [InlineData(" 1338610")]
    [InlineData("1338610abc")]
    [InlineData("99999999999")]
    public void Map_ASteamRowWithoutAnAddressOrAUsableAppId_IsSkipped(string? uid)
    {
        Assert.Empty(Map(synced: [Synced(1, 1, null, uid)]));
    }

    [Fact]
    public void Map_AnotherStoresRowWithoutAnAddress_IsSkippedRatherThanGuessed()
    {
        // No pattern but Steam's was confirmed by opening one, so no other address is built.
        Assert.Empty(Map(synced:
        [
            Synced(1, 5, null, uid: "1207664663"),
            Synced(2, 36, null, uid: "204794"),
            Synced(3, 26, null, uid: "544c18ccadf8466691d8f2a335721b14"),
        ]));
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
        "https://store.epicgames.com/p/marvel-rivals-182004?lang=en-US#about",
        "https://store.epicgames.com/p/marvel-rivals-182004")]
    public void Map_AnAddressWithAQueryOrAFragment_IsCutAtItsPath(string url, string expected)
    {
        // These are IGDB's own rows. GOG's carries its affiliate network's tracking; no page here
        // needs a query, and nobody is paid for a click from this page.
        var type = new Uri(url).Host switch
        {
            "www.gog.com" => 17,
            "store.steampowered.com" => 13,
            "www.nintendo.com" => 24,
            _ => 16,
        };

        Assert.Equal(expected, Assert.Single(Map([Website(1, type, url)])).Url);
    }

    [Theory]
    [InlineData(16, "https://www.xbox.com/en-us/games/store/celeste/BWMQL2RPWBHB")]
    [InlineData(13, "https://steamcommunity.com/sharedfiles/filedetails/?id=3636926391")]
    [InlineData(16, "https://store.epicgames.coms/p/celeste")]
    [InlineData(13, "https://store.steampowered.com.example.net/app/504230")]
    [InlineData(13, "https://example.net/store.steampowered.com/app/504230")]
    [InlineData(13, "https://store.steampowered.com@example.net/app/504230")]
    [InlineData(15, "https://example.net/itch.io/celeste")]
    [InlineData(15, "https://notitch.io/celeste")]
    [InlineData(23, "https://www.xbox.com/en-us/games/store/celeste/BWMQL2RPWBHB")]
    public void Map_AnAddressOnAHostThatIsNotTheStores_IsSkipped(int type, string url)
    {
        // All but the last four are rows IGDB holds: a misfiled kind, a workshop item, a typo. Under a
        // store's name, the link has to lead to that store.
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
    public void Map_AnUnusableWebsiteRow_FallsThroughToTheSyncedRow()
    {
        var result = Map(
            [Website(1, 16, "https://www.xbox.com/en-us/games/store/celeste/BWMQL2RPWBHB")],
            [Synced(2, 26, "https://store.epicgames.com/en-US/p/celeste")]);

        Assert.Equal([new StoreLinkDto("Epic Games Store", "https://store.epicgames.com/en-US/p/celeste")], result);
    }

    [Theory]
    [InlineData("https://maddymakesgamesinc.itch.io/celeste")]
    [InlineData("https://itch.io/jam/celeste-classic")]
    [InlineData("https://Hempuli.Itch.IO/baba")]
    public void Map_ItchIo_TakesTheSiteAndEveryCreatorsSubdomain(string url)
    {
        Assert.Equal("itch.io", Assert.Single(Map([Website(1, 15, url)])).Store);
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
