using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Releases;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Spec §3.3's rules against rows recorded from live IGDB (B5).
/// </summary>
/// <remarks>
/// Every game, id, type, parent, series, date and status below was read from IGDB on 2026-09-29, for a
/// library of Kingdom Hearts III, Grand Theft Auto V, The Witcher 3, Street Fighter 6, Hollow Knight:
/// Silksong, Resident Evil 2, Final Fantasy VII Remake and Xenoblade Chronicles 3 — only the memberships
/// are chosen per test. Where a test needs a shape the recording did not have, the row is marked as
/// made up and says why.
/// </remarks>
public class ConnectedReleasesTests
{
    private static readonly PlatformDto Pc = new(6, "PC (Microsoft Windows)", "PC", null, null);
    private static readonly PlatformDto Ps4 = new(48, "PlayStation 4", "PS4", null, null);
    private static readonly PlatformDto Ps5 = new(167, "PlayStation 5", "PS5", null, null);
    private static readonly PlatformDto SeriesXs = new(169, "Xbox Series X|S", "Series X|S", null, null);
    private static readonly PlatformDto Switch2 = new(508, "Nintendo Switch 2", "Switch 2", null, null);
    private static readonly PlatformDto Android = new(34, "Android", "Android", null, null);
    private static readonly PlatformDto Ios = new(39, "iOS", "iOS", null, null);

    private static readonly SeriesRef KingdomHearts = new(272, "Kingdom Hearts");
    private static readonly SeriesRef ResidentEvil = new(83, "Resident Evil");
    private static readonly SeriesRef GrandTheftAuto = new(847, "Grand Theft Auto");
    private static readonly SeriesRef Witcher = new(62, "The Witcher");
    private static readonly SeriesRef FinalFantasy = new(39, "Final Fantasy");
    private static readonly SeriesRef FinalFantasyVii = new(9007, "Final Fantasy VII");
    private static readonly SeriesRef CompilationOfFfvii = new(5134, "Compilation of Final Fantasy VII");
    private static readonly SeriesRef Xenoblade = new(1161, "Xenoblade Chronicles");
    private static readonly SeriesRef StreetFighter = new(219, "Street Fighter");
    private static readonly SeriesRef HollowKnight = new(5702, "Hollow Knight");

    private static CalendarGame Game(int id, string name, int type, int? parent = null, int? versionParent = null, params SeriesRef[] series) =>
        new(id, name, null, type, parent, versionParent, series);

    // The library.
    private static readonly CalendarGame KingdomHeartsIii = Game(2933, "Kingdom Hearts III", IgdbGameTypes.MainGame, series: KingdomHearts);
    private static readonly CalendarGame GtaV = Game(1020, "Grand Theft Auto V", IgdbGameTypes.MainGame, series: GrandTheftAuto);
    private static readonly CalendarGame WitcherIii = Game(1942, "The Witcher 3: Wild Hunt", IgdbGameTypes.MainGame, series: Witcher);
    private static readonly CalendarGame StreetFighter6 = Game(191692, "Street Fighter 6", IgdbGameTypes.MainGame, series: StreetFighter);
    private static readonly CalendarGame Silksong = Game(115289, "Hollow Knight: Silksong", IgdbGameTypes.MainGame, series: HollowKnight);
    private static readonly CalendarGame ResidentEvil2 = Game(19686, "Resident Evil 2", IgdbGameTypes.Remake, parent: 880, series: ResidentEvil);
    private static readonly CalendarGame ResidentEvil2Original = Game(880, "Resident Evil 2", IgdbGameTypes.MainGame, series: ResidentEvil);
    private static readonly CalendarGame FfviiRemake = Game(11169, "Final Fantasy VII Remake", IgdbGameTypes.Remake, series: [CompilationOfFfvii, FinalFantasy, FinalFantasyVii]);
    private static readonly CalendarGame XenobladeIii = Game(191411, "Xenoblade Chronicles 3", IgdbGameTypes.MainGame, series: Xenoblade);

    // What IGDB said is coming for it.
    private static readonly CalendarGame WitcherIiiRemastered = Game(415005, "The Witcher 3: Wild Hunt Remastered", IgdbGameTypes.Remaster, parent: 1942, series: Witcher);
    private static readonly CalendarGame EverCrisis = Game(144040, "Final Fantasy VII: Ever Crisis", IgdbGameTypes.MainGame, series: [CompilationOfFfvii, FinalFantasy, FinalFantasyVii]);
    private static readonly CalendarGame KingdomHeartsHd28 = Game(14159, "Kingdom Hearts HD 2.8 Final Chapter Prologue", IgdbGameTypes.Bundle, series: KingdomHearts);
    private static readonly CalendarGame KingdomHearts02 = Game(26676, "Kingdom Hearts 0.2: Birth by Sleep - A Fragmentary Passage", IgdbGameTypes.MainGame, series: KingdomHearts);
    private static readonly CalendarGame ReMind = Game(117778, "Kingdom Hearts III: Re Mind", IgdbGameTypes.Expansion, parent: 2933, series: KingdomHearts);
    private static readonly CalendarGame KingdomHeartsFinalMix = Game(212758, "Kingdom Hearts Final Mix", IgdbGameTypes.Remaster, parent: 20283, series: KingdomHearts);
    private static readonly CalendarGame SfArjunPass = Game(404718, "Street Fighter 6: Year 4 - Arjun", IgdbGameTypes.Dlc, parent: 191692);
    private static readonly CalendarGame SfArjunCharacter = Game(407142, "Street Fighter 6: Additional Character - Arjun & Outfit 2", IgdbGameTypes.Dlc, parent: 191692);
    private static readonly CalendarGame SfTifaPass = Game(404720, "Street Fighter 6: Year 4 - Tifa", IgdbGameTypes.Dlc, parent: 191692);
    private static readonly CalendarGame ResidentEvil2Deluxe = Game(110809, "Resident Evil 2: Deluxe Edition", IgdbGameTypes.Bundle, versionParent: 19686);
    private static readonly CalendarGame ResidentEvil3 = Game(115115, "Resident Evil 3", IgdbGameTypes.Remake, parent: 966, series: ResidentEvil);
    private static readonly CalendarGame GtaVi = Game(52189, "Grand Theft Auto VI", IgdbGameTypes.MainGame, series: GrandTheftAuto);
    private static readonly CalendarGame GtaViUltimate = Game(407999, "Grand Theft Auto VI: Ultimate Edition", IgdbGameTypes.MainGame, versionParent: 52189);
    private static readonly CalendarGame XenobladeIiiSwitch2 = Game(405448, "Xenoblade Chronicles 3: Nintendo Switch 2 Edition", IgdbGameTypes.ExpandedGame, parent: 191411, series: Xenoblade);
    private static readonly CalendarGame SeaOfSorrow = Game(381684, "Hollow Knight: Silksong - Sea of Sorrow", IgdbGameTypes.Update, parent: 115289, series: HollowKnight);
    private static readonly CalendarGame Evercold = Game(399337, "Final Fantasy XIV: Evercold", IgdbGameTypes.Expansion, parent: 386, series: FinalFantasy);
    private static readonly CalendarGame KingdomHeartsIv = Game(196761, "Kingdom Hearts IV", IgdbGameTypes.MainGame, series: KingdomHearts);
    private static readonly CalendarGame ReVeronica = Game(404673, "Resident Evil Veronica", IgdbGameTypes.Remake, parent: 968, series: ResidentEvil);

    // The Witcher 3's chain of editions, from the same day's recording.
    private static readonly CalendarGame WitcherCompleteEdition = Game(119402, "The Witcher 3: Wild Hunt - Complete Edition", IgdbGameTypes.Bundle, versionParent: 1942);
    private static readonly CalendarGame WitcherTenthAnniversary = Game(372654, "The Witcher 3: Wild Hunt - Complete Edition: 10th Anniversary Edition", IgdbGameTypes.MainGame, versionParent: 119402);

    private static readonly Dictionary<int, CalendarGame> Games = new[]
    {
        KingdomHeartsIii, GtaV, WitcherIii, StreetFighter6, Silksong, ResidentEvil2, ResidentEvil2Original, FfviiRemake, XenobladeIii,
        WitcherIiiRemastered, EverCrisis, KingdomHeartsHd28, KingdomHearts02, ReMind, KingdomHeartsFinalMix, SfArjunPass,
        SfArjunCharacter, SfTifaPass, ResidentEvil2Deluxe, ResidentEvil3, GtaVi, GtaViUltimate, XenobladeIiiSwitch2, SeaOfSorrow,
        Evercold, KingdomHeartsIv, ReVeronica, WitcherCompleteEdition, WitcherTenthAnniversary,
    }.ToDictionary(g => g.Id);

    private static ReleaseRow Row(int id, CalendarGame game, string date, PlatformDto platform, int? status = IgdbReleaseStatuses.FullRelease, int dateFormat = 0)
    {
        var day = DateOnly.Parse(date);
        return new ReleaseRow(id, game.Id, day, dateFormat, day.Year, day.Month, platform, status);
    }

    private static readonly List<ReleaseRow> Recorded =
    [
        Row(957238, WitcherIiiRemastered, "2026-09-29", Pc),
        Row(957250, WitcherIiiRemastered, "2026-09-29", Switch2),
        Row(957251, WitcherIiiRemastered, "2026-09-29", SeriesXs),
        Row(957252, WitcherIiiRemastered, "2026-09-29", Ps5),
        Row(940232, EverCrisis, "2026-10-06", Android, IgdbReleaseStatuses.Offline),
        Row(940233, EverCrisis, "2026-10-06", Ios, IgdbReleaseStatuses.Offline),
        Row(940234, EverCrisis, "2026-10-06", Pc, IgdbReleaseStatuses.Offline),
        Row(926942, KingdomHeartsIii, "2026-10-08", Ps5, status: null),
        Row(926943, KingdomHeartsIii, "2026-10-08", SeriesXs, status: null),
        Row(926944, KingdomHeartsIii, "2026-10-08", Switch2, status: null),
        Row(925904, KingdomHeartsHd28, "2026-10-08", Switch2),
        Row(926114, KingdomHearts02, "2026-10-08", Switch2),
        Row(926115, KingdomHearts02, "2026-10-08", Ps5),
        Row(926948, ReMind, "2026-10-08", Switch2, status: null),
        Row(926949, ReMind, "2026-10-08", Ps5, status: null),
        Row(926083, KingdomHeartsFinalMix, "2026-10-08", Switch2),
        Row(962456, SfArjunPass, "2026-10-13", Switch2),
        Row(962457, SfArjunPass, "2026-10-13", Pc),
        Row(963709, SfArjunCharacter, "2026-10-13", Switch2),
        Row(963710, SfArjunCharacter, "2026-10-13", Pc),
        Row(963571, ResidentEvil2, "2026-10-16", Switch2),
        Row(963340, ResidentEvil2Deluxe, "2026-10-16", Switch2),
        Row(963341, ResidentEvil3, "2026-10-16", Switch2),
        Row(831834, GtaVi, "2026-11-19", Ps5),
        Row(831835, GtaVi, "2026-11-19", SeriesXs),
        Row(933516, GtaViUltimate, "2026-11-19", Ps5),
        Row(933517, GtaViUltimate, "2026-11-19", SeriesXs),
        Row(925689, XenobladeIiiSwitch2, "2026-12-03", Switch2),
        // Known only to the year: stored as the year's last day (spec §4).
        Row(847083, SeaOfSorrow, "2026-12-31", Pc, status: null, dateFormat: 2),
        // Known only to the month: stored as its first day.
        Row(903415, Evercold, "2027-01-01", Ps5, dateFormat: 1),
        Row(903417, Evercold, "2027-01-01", Pc, dateFormat: 1),
        // Known only to the first quarter: stored as the quarter's last day.
        Row(923036, SfTifaPass, "2027-03-31", Switch2, dateFormat: 3),
        // Known only to the fourth quarter.
        Row(953866, KingdomHeartsIv, "2027-12-31", Switch2, dateFormat: 6),
        Row(922726, ReVeronica, "2027-12-31", Switch2, dateFormat: 2),
    ];

    /// <summary>The recorded library, each game under the membership a test gives it.</summary>
    private static Dictionary<int, SetMember> Set(params (CalendarGame Game, SetMembership Membership, string? List)[] members) =>
        members.ToDictionary(m => m.Game.Id, m => new SetMember(m.Game.Id, m.Membership, m.List));

    private static readonly Dictionary<int, SetMember> Library = Set(
        (KingdomHeartsIii, SetMembership.List, ListStatusKeys.Finished),
        (GtaV, SetMembership.List, ListStatusKeys.Finished),
        (WitcherIii, SetMembership.Favourite, null),
        (StreetFighter6, SetMembership.List, ListStatusKeys.Playing),
        (Silksong, SetMembership.List, ListStatusKeys.Backlog),
        (ResidentEvil2, SetMembership.List, ListStatusKeys.Finished),
        (FfviiRemake, SetMembership.List, ListStatusKeys.Backlog),
        (XenobladeIii, SetMembership.Wishlist, null));

    private static IReadOnlyList<ReleaseEntry> Compose(string from, string to, Dictionary<int, SetMember>? set = null) =>
        ConnectedReleases.Compose(set ?? Library, Games, Recorded, DateOnly.Parse(from), DateOnly.Parse(to));

    [Fact]
    public void Compose_ARemasterOfAFavourite_IsItsChildOnEveryPlatformAtOnce()
    {
        // R2 and F5: four rows, one per platform, are one release.
        var entry = Assert.Single(Compose("2026-09-29", "2026-09-30"));

        var release = Assert.Single(entry.Releases);
        Assert.Equal("The Witcher 3: Wild Hunt Remastered", release.Game.Name);
        Assert.Equal(ReleasePrecision.Day, release.Precision);
        Assert.Equal([Switch2, Pc, Ps5, SeriesXs], release.Platforms);
        Assert.Equal(new ReleaseReason(ReleaseRelation.Child, 1942, "The Witcher 3: Wild Hunt", SetMembership.Favourite, null, null), release.Reason);
    }

    [Fact]
    public void Compose_AGameGoingOffline_IsNotARelease()
    {
        // F4: Final Fantasy VII: Ever Crisis shuts down on 6 October, and is in the Remake's series.
        Assert.Empty(Compose("2026-10-06", "2026-10-07"));
    }

    [Fact]
    public void Compose_TheKingdomHeartsWave_IsOneEntryLedByTheGameItself_WithoutItsBundles()
    {
        // F6, F2 and §3.4 together: on 8 October Kingdom Hearts arrives on new consoles in bulk.
        var entry = Assert.Single(Compose("2026-10-08", "2026-10-09"));

        Assert.Equal("Kingdom Hearts", entry.GroupName);
        Assert.Equal(
            ["Kingdom Hearts III", "Kingdom Hearts III: Re Mind", "Kingdom Hearts 0.2: Birth by Sleep - A Fragmentary Passage", "Kingdom Hearts Final Mix"],
            entry.Releases.Select(r => r.Game.Name));
        Assert.Equal(
            [ReleaseRelation.Itself, ReleaseRelation.Child, ReleaseRelation.Series, ReleaseRelation.Series],
            entry.Releases.Select(r => r.Reason.Relation));

        // A row with no status at all is kept: most rows for the future have none.
        Assert.Equal([Switch2, Ps5, SeriesXs], entry.Releases[0].Platforms);
    }

    [Fact]
    public void Compose_TwoDlcForOneGameOnOneDay_AreOneEntryNamedAfterTheGame()
    {
        // F6's extension for §9's seventh question: neither DLC is in a series, but they belong together.
        var entry = Assert.Single(Compose("2026-10-13", "2026-10-14"));

        Assert.Equal("Street Fighter 6", entry.GroupName);
        Assert.Equal(2, entry.Releases.Count);
        Assert.All(entry.Releases, r =>
        {
            Assert.Equal(ReleaseRelation.Child, r.Reason.Relation);
            Assert.Equal(ListStatusKeys.Playing, r.Reason.ListKey);
        });
    }

    [Fact]
    public void Compose_TheGameItselfOnANewPlatform_LeadsItsSeriesAndDropsTheBundle()
    {
        // R1: Resident Evil 2 on Switch 2. Its Deluxe Edition is a bundle (F2) and would otherwise fold
        // into it; Resident Evil 3 arrives the same day and shares its series.
        var entry = Assert.Single(Compose("2026-10-16", "2026-10-17"));

        Assert.Equal("Resident Evil", entry.GroupName);
        Assert.Equal(["Resident Evil 2", "Resident Evil 3"], entry.Releases.Select(r => r.Game.Name));
        Assert.Equal(ReleaseRelation.Itself, entry.Releases[0].Reason.Relation);
        Assert.Equal(new SeriesRef(83, "Resident Evil"), entry.Releases[1].Reason.Series);
    }

    [Fact]
    public void Compose_AnEdition_IsShownAsTheGameItIsAnEditionOf()
    {
        // F3 and F5: the Ultimate Edition is Grand Theft Auto VI, on the same day and consoles.
        var set = Set((GtaVi, SetMembership.Wishlist, null));

        var entry = Assert.Single(Compose("2026-11-19", "2026-11-20", set));

        var release = Assert.Single(entry.Releases);
        Assert.Equal("Grand Theft Auto VI", release.Game.Name);
        Assert.Equal([Ps5, SeriesXs], release.Platforms);
        Assert.Equal(ReleaseRelation.Itself, release.Reason.Relation);
        Assert.Equal(SetMembership.Wishlist, release.Reason.Membership);
    }

    [Fact]
    public void Compose_TheNextInASeries_IsThereBecauseOfTheSeries()
    {
        // R3: Grand Theft Auto VI, because somebody finished Grand Theft Auto V.
        var release = Assert.Single(Assert.Single(Compose("2026-11-19", "2026-11-20")).Releases);

        Assert.Equal("Grand Theft Auto VI", release.Game.Name);
        Assert.Equal(new ReleaseReason(ReleaseRelation.Series, 1020, "Grand Theft Auto V", SetMembership.List, ListStatusKeys.Finished, GrandTheftAuto), release.Reason);
    }

    [Fact]
    public void Compose_AnExpandedEdition_IsANewGameRatherThanFolded()
    {
        // Typed Expanded Game, and linked by parent_game: a new product for a wishlisted game.
        var release = Assert.Single(Assert.Single(Compose("2026-12-03", "2026-12-04")).Releases);

        Assert.Equal("Xenoblade Chronicles 3: Nintendo Switch 2 Edition", release.Game.Name);
        Assert.Equal(ReleaseRelation.Child, release.Reason.Relation);
        Assert.Equal(SetMembership.Wishlist, release.Reason.Membership);
    }

    [Fact]
    public void Compose_AnUpdate_IsNotARelease()
    {
        // F2, and §9's second question: Silksong's "Sea of Sorrow" is typed Update.
        Assert.DoesNotContain(
            Compose("2026-10-01", "2027-01-01").SelectMany(e => e.Releases),
            r => r.Game.Id == SeaOfSorrow.Id);
    }

    [Fact]
    public void Compose_ARowNothingInTheSetConnectsTo_IsLeftOut()
    {
        var set = Set((WitcherIii, SetMembership.Favourite, null));

        Assert.Empty(Compose("2026-11-19", "2026-11-20", set));
    }

    [Fact]
    public void Compose_AMonthOnlyRow_IsItsMonth_ForAWindowStartingPartWayThroughIt()
    {
        // D2: "Jan 2027" is stored as the 1st, before this window starts, and still overlaps it.
        var release = Assert.Single(Compose("2027-01-15", "2027-02-01").SelectMany(e => e.Releases), r => r.Game.Id == Evercold.Id);

        Assert.Equal(ReleasePrecision.Month, release.Precision);
        Assert.Equal(new DateOnly(2027, 1, 1), release.Starts);
        Assert.Equal(new SeriesRef(39, "Final Fantasy"), release.Reason.Series);
    }

    [Fact]
    public void Compose_AQuarterOnlyRow_IsInEveryMonthOfItsQuarter()
    {
        // Stored as 31 March, which is outside a January window; the quarter is not.
        var entries = Compose("2027-01-01", "2027-02-01");

        var tifa = Assert.Single(entries.SelectMany(e => e.Releases), r => r.Game.Id == SfTifaPass.Id);
        Assert.Equal(ReleasePrecision.Quarter, tifa.Precision);
        Assert.Equal(new DateOnly(2027, 1, 1), tifa.Starts);
    }

    [Fact]
    public void Compose_AYearOnlyRow_IsInEveryWindowOfItsYear()
    {
        // Stored as 31 December 2027: a window in March would never have reached it by that date.
        var veronica = Assert.Single(
            Compose("2027-03-01", "2027-04-01").SelectMany(e => e.Releases),
            r => r.Game.Id == ReVeronica.Id);

        Assert.Equal(ReleasePrecision.Year, veronica.Precision);
        Assert.Equal(new DateOnly(2027, 1, 1), veronica.Starts);
    }

    [Fact]
    public void Compose_AGameKnownToTheDay_IsNotAlsoShownForItsMonth()
    {
        // Made up: a second, month-only row for the same game and platform, the shape IGDB holds when one
        // region's date is known to the day and another's only to the month.
        var monthRow = Row(1, KingdomHeartsIii, "2026-10-01", Switch2, status: null, dateFormat: 1);

        var entries = ConnectedReleases.Compose(
            Library, Games, [.. Recorded, monthRow], new DateOnly(2026, 10, 1), new DateOnly(2026, 11, 1));

        var kingdomHearts = entries.SelectMany(e => e.Releases).Where(r => r.Game.Id == KingdomHeartsIii.Id).ToList();
        Assert.Equal([ReleasePrecision.Day], kingdomHearts.Select(r => r.Precision));
    }

    [Fact]
    public void Compose_TheRelationOutranksTheMembership()
    {
        // §3.4: Re Mind is DLC for a finished game and in the series of a favourite — being its DLC is
        // the stronger reason.
        var set = Set(
            (KingdomHeartsIii, SetMembership.List, ListStatusKeys.Finished),
            (KingdomHearts02, SetMembership.Favourite, null));

        var reMind = Assert.Single(Compose("2026-10-08", "2026-10-09", set).SelectMany(e => e.Releases), r => r.Game.Id == ReMind.Id);

        Assert.Equal(ReleaseRelation.Child, reMind.Reason.Relation);
        Assert.Equal(KingdomHeartsIii.Id, reMind.Reason.ViaGameId);
    }

    [Fact]
    public void Compose_AmongTheSameRelation_TheStrongerMembershipIsTheReason()
    {
        // Resident Evil 3 is in the series of both Resident Evil 2s; the wishlisted one is the reason.
        var set = Set(
            (ResidentEvil2, SetMembership.List, ListStatusKeys.Finished),
            (ResidentEvil2Original, SetMembership.Wishlist, null));

        var re3 = Assert.Single(Compose("2026-10-16", "2026-10-17", set).SelectMany(e => e.Releases), r => r.Game.Id == ResidentEvil3.Id);

        Assert.Equal(ResidentEvil2Original.Id, re3.Reason.ViaGameId);
        Assert.Equal(SetMembership.Wishlist, re3.Reason.Membership);
    }

    [Fact]
    public void Fold_AChainOfEditions_EndsAtTheGame()
    {
        // The 10th Anniversary Edition is an edition of the Complete Edition, which is one of the game.
        Assert.Equal(WitcherIii, ConnectedReleases.Fold(WitcherTenthAnniversary, Games));
    }

    [Fact]
    public void Fold_ARemasterWithAVersionParent_StaysItself()
    {
        // Made up: ten of the 500 games checked were remasters, expanded games or ports carrying a
        // version_parent. They are products of their own, and folding one would hide that it is new.
        var remaster = Game(1, "A Remaster", IgdbGameTypes.Remaster, versionParent: WitcherIii.Id);

        Assert.Equal(remaster, ConnectedReleases.Fold(remaster, Games));
    }

    [Theory]
    [InlineData(3, 1)]
    [InlineData(4, 4)]
    [InlineData(5, 7)]
    [InlineData(6, 10)]
    public void PeriodOf_EachQuarter_StartsOnItsFirstMonth(int dateFormat, int firstMonth)
    {
        var period = ConnectedReleases.PeriodOf(new ReleaseRow(1, 1, new DateOnly(2027, firstMonth + 2, 28), dateFormat, 2027, firstMonth + 2, null, null));

        Assert.Equal(new DateOnly(2027, firstMonth, 1), period?.Starts);
        Assert.Equal(new DateOnly(2027, firstMonth, 1).AddMonths(3).AddDays(-1), period?.Ends);
    }

    [Fact]
    public void PeriodOf_ARowToBeDecided_HasNoPeriod()
    {
        Assert.Null(ConnectedReleases.PeriodOf(new ReleaseRow(1, 1, new DateOnly(2027, 12, 31), 7, 2027, 12, null, null)));
    }
}
