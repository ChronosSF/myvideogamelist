using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Releases;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>The admin page's pins and hides for the Coming soon panel (ADR 0071), and what reads them.</summary>
public class ComingSoonCurationServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 25, 12, 0, 0, TimeSpan.Zero);

    private static readonly CalendarGame Witchbrook = new(67195, "Witchbrook", null, IgdbGameTypes.MainGame, null, null, []);
    private static readonly CalendarGame GtaVi = new(52189, "Grand Theft Auto VI", null, IgdbGameTypes.MainGame, null, null, []);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static ApplicationDbContext NewDb() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    /// <summary>An IGDB that knows Witchbrook and Grand Theft Auto VI, and no other game.</summary>
    private static IIgdbService Igdb()
    {
        var igdb = Substitute.For<IIgdbService>();
        var known = new[] { Witchbrook, GtaVi }.ToDictionary(g => g.Id);
        igdb.GetCalendarGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult<IReadOnlyDictionary<int, CalendarGame>>(
                call.Arg<IEnumerable<int>>().Where(known.ContainsKey).ToDictionary(id => id, id => known[id])));
        return igdb;
    }

    private static ComingSoonCurationService NewService(ApplicationDbContext db, IMemoryCache? cache = null) =>
        new(db, Igdb(), cache ?? new MemoryCache(new MemoryCacheOptions()), new FixedClock(Now));

    [Fact]
    public async Task SetAsync_AGameIgdbKnows_IsPickedUnderIgdbsName()
    {
        await using var db = NewDb();

        var saved = await NewService(db).SetAsync(67195, ComingSoonPickKinds.Pin);

        Assert.Equal(new(67195, "Witchbrook", ComingSoonPickKinds.Pin, Now), saved);
        Assert.Single(db.ComingSoonPicks);
    }

    [Fact]
    public async Task SetAsync_AGameAlreadyPicked_ChangesWhatItIs_StillOneRow()
    {
        await using var db = NewDb();
        var service = NewService(db);

        await service.SetAsync(52189, ComingSoonPickKinds.Pin);
        await service.SetAsync(52189, ComingSoonPickKinds.Hide);

        var pick = Assert.Single(db.ComingSoonPicks);
        Assert.Equal(ComingSoonPickKinds.Hide, pick.Kind);
    }

    [Fact]
    public async Task SetAsync_AnIdIgdbHasNoGameFor_IsRefusedAndStoresNothing()
    {
        await using var db = NewDb();

        Assert.Null(await NewService(db).SetAsync(1, ComingSoonPickKinds.Hide));
        Assert.Empty(db.ComingSoonPicks);
    }

    [Fact]
    public async Task SetAndRemove_DropThisProcesssCopyOfTheHomePage()
    {
        // So that the admin sees a pick on the next load rather than up to a quarter of an hour later.
        await using var db = NewDb();
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = NewService(db, cache);

        cache.Set(HomeService.CacheKey, "the home page");
        await service.SetAsync(52189, ComingSoonPickKinds.Hide);
        Assert.False(cache.TryGetValue(HomeService.CacheKey, out _));

        cache.Set(HomeService.CacheKey, "the home page");
        Assert.True(await service.RemoveAsync(52189));
        Assert.False(cache.TryGetValue(HomeService.CacheKey, out _));
    }

    [Fact]
    public async Task RemoveAsync_AGameNeitherPinnedNorHidden_IsFalse()
    {
        await using var db = NewDb();

        Assert.False(await NewService(db).RemoveAsync(52189));
    }

    [Fact]
    public async Task ListAsync_PinnedFirst_ThenByTitle()
    {
        await using var db = NewDb();
        db.ComingSoonPicks.AddRange(
            new ComingSoonPick { GameId = 3, Kind = ComingSoonPickKinds.Hide, Title = "Alpha", PickedAt = Now },
            new ComingSoonPick { GameId = 2, Kind = ComingSoonPickKinds.Pin, Title = "Zeta", PickedAt = Now },
            new ComingSoonPick { GameId = 1, Kind = ComingSoonPickKinds.Pin, Title = "Beta", PickedAt = Now });
        await db.SaveChangesAsync();

        var picks = await NewService(db).ListAsync();

        Assert.Equal(["Beta", "Zeta", "Alpha"], picks.Select(p => p.Title));
    }

    [Fact]
    public async Task GetPicksAsync_SplitsThePinnedFromTheHidden()
    {
        await using var db = NewDb();
        db.ComingSoonPicks.AddRange(
            new ComingSoonPick { GameId = 1, Kind = ComingSoonPickKinds.Pin, Title = "Pinned", PickedAt = Now },
            new ComingSoonPick { GameId = 2, Kind = ComingSoonPickKinds.Hide, Title = "Hidden", PickedAt = Now });
        await db.SaveChangesAsync();

        var picks = await new ComingSoonService(db, Igdb()).GetPicksAsync();

        Assert.Equal([1], picks.Pinned);
        Assert.Equal([2], picks.Hidden);
    }
}
