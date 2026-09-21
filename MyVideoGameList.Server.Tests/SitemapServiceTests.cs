using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What the sitemap lists, and — as with the public profile — what it must not.
/// </summary>
/// <remarks>
/// A sitemap is a publication. A private profile named in one has been told to every crawler that
/// reads it, which is the question a private profile's 404 exists to refuse. See
/// <c>docs/decisions/0036-what-a-crawler-is-told.md</c>.
/// </remarks>
public class SitemapServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 21, 12, 0, 0, TimeSpan.Zero);

    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static void AddGame(ApplicationDbContext db, int gameId, bool tombstone = false)
    {
        db.CachedGames.Add(new CachedGame
        {
            GameId = gameId,
            Payload = tombstone ? null : "{}",
            Title = tombstone ? null : $"Game {gameId}",
            RefreshedAt = Now
        });
        db.SaveChanges();
    }

    private static void AddAccount(
        ApplicationDbContext db,
        string userId,
        string userName,
        string visibility = ProfileVisibility.Public)
    {
        db.Users.Add(new ApplicationUser
        {
            Id = userId,
            UserName = userName,
            NormalizedUserName = userName.ToUpperInvariant(),
            Email = $"{userName}@test.local",
            ProfileVisibility = visibility
        });
        db.SaveChanges();
    }

    private static void AddEntry(ApplicationDbContext db, string userId, int gameId)
    {
        db.UserGameEntries.Add(new UserGameEntry { UserId = userId, GameId = gameId, AddedAt = Now });
        db.SaveChanges();
    }

    private static void AddFavourite(ApplicationDbContext db, string userId, int gameId)
    {
        db.UserFavourites.Add(new UserFavourite { UserId = userId, GameId = gameId, AddedAt = Now });
        db.SaveChanges();
    }

    [Fact]
    public async Task GetGameIdsAsync_ListsCachedGamesInKeyOrder()
    {
        using var db = NewDb();
        AddGame(db, 30);
        AddGame(db, 10);
        AddGame(db, 20);

        var ids = await new SitemapService(db).GetGameIdsAsync(1);

        Assert.Equal([10, 20, 30], ids);
    }

    /// <summary>
    /// A tombstone is a game IGDB no longer returns, whose page is a 404. Listing one asks a
    /// crawler to index a page that is not there.
    /// </summary>
    [Fact]
    public async Task GetGameIdsAsync_LeavesOutTombstones()
    {
        using var db = NewDb();
        AddGame(db, 1);
        AddGame(db, 2, tombstone: true);

        var service = new SitemapService(db);

        Assert.Equal([1], await service.GetGameIdsAsync(1));
        Assert.Equal(1, (await service.GetSummaryAsync()).Games);
    }

    [Fact]
    public async Task GetGameIdsAsync_PastTheLastPage_IsEmpty()
    {
        using var db = NewDb();
        AddGame(db, 1);

        Assert.Empty(await new SitemapService(db).GetGameIdsAsync(2));
    }

    /// <summary>
    /// The page arrives validated to be positive and nothing more, and the offset is a
    /// multiplication.
    /// </summary>
    [Fact]
    public async Task GetGameIdsAsync_OnAPageWhoseOffsetOverflows_IsEmptyRatherThanAnError()
    {
        using var db = NewDb();
        AddGame(db, 1);

        var service = new SitemapService(db);

        Assert.Empty(await service.GetGameIdsAsync(int.MaxValue));
        Assert.Empty(await service.GetProfileNamesAsync(int.MaxValue));
    }

    [Fact]
    public async Task GetProfileNamesAsync_NeverListsAPrivateProfile()
    {
        using var db = NewDb();
        AddAccount(db, "user-1", "alice");
        AddAccount(db, "user-2", "bob", ProfileVisibility.Private);
        AddEntry(db, "user-1", 1);
        AddEntry(db, "user-2", 1);

        var service = new SitemapService(db);

        Assert.Equal(["alice"], await service.GetProfileNamesAsync(1));
        Assert.Equal(1, (await service.GetSummaryAsync()).Profiles);
    }

    /// <summary>
    /// The profile page marks an empty profile <c>noindex</c>, and a sitemap that lists a page
    /// marked <c>noindex</c> is reported as an error by every search console there is.
    /// </summary>
    [Fact]
    public async Task GetProfileNamesAsync_LeavesOutAPublicProfileWithNothingOnIt()
    {
        using var db = NewDb();
        AddAccount(db, "user-1", "alice");
        AddAccount(db, "user-2", "bob");
        AddEntry(db, "user-1", 1);

        Assert.Equal(["alice"], await new SitemapService(db).GetProfileNamesAsync(1));
    }

    /// <summary>
    /// A favourite needs no entry (ADR 0029), so a profile can have a shelf of them and nothing
    /// tracked. That page has something on it.
    /// </summary>
    [Fact]
    public async Task GetProfileNamesAsync_ListsAProfileWhoseOnlyContentIsFavourites()
    {
        using var db = NewDb();
        AddAccount(db, "user-1", "alice");
        AddFavourite(db, "user-1", 1);

        Assert.Equal(["alice"], await new SitemapService(db).GetProfileNamesAsync(1));
    }

    /// <summary>
    /// The name as its owner capitalised it, because that is the spelling the profile page gives
    /// as its canonical URL and the two have to be the same string.
    /// </summary>
    [Fact]
    public async Task GetProfileNamesAsync_ReturnsTheNameAsItsOwnerWroteIt()
    {
        using var db = NewDb();
        AddAccount(db, "user-1", "AliceInChains");
        AddEntry(db, "user-1", 1);

        Assert.Equal(["AliceInChains"], await new SitemapService(db).GetProfileNamesAsync(1));
    }

    [Fact]
    public async Task GetSummaryAsync_ReportsThePageSizeTheListsAreCutTo()
    {
        using var db = NewDb();

        var summary = await new SitemapService(db).GetSummaryAsync();

        Assert.Equal(new(0, 0, SitemapService.PageSize), summary);
    }
}
