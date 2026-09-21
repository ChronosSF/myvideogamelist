using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The cache exists so that a page about somebody's own library does not depend on IGDB answering.
/// Most of these tests are therefore about what happens when it does not.
/// </summary>
public class GameCacheServiceTests
{
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    private static readonly DateTimeOffset Midday = new(2026, 9, 21, 12, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// A context whose writes fail, so the caching can be broken without breaking the reads that
    /// precede it - which is the situation the answer has to survive.
    /// </summary>
    private sealed class UnwritableDb(DbContextOptions<ApplicationDbContext> options, Exception failure)
        : ApplicationDbContext(options)
    {
        public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) =>
            Task.FromException<int>(failure);
    }

    private static ApplicationDbContext NewUnwritableDb(Exception failure) =>
        new UnwritableDb(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options,
            failure);

    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static GameDto Game(int id, string title = "Game", float? rating = null) =>
        new(id, title, null, new DateOnly(2020, 1, 1), "cover.jpg", null, null, null, rating,
            null, null, null, null,
            Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    private static IIgdbService IgdbReturning(params GameDto[] games)
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(callInfo =>
            {
                var wanted = callInfo.Arg<IEnumerable<int>>().ToHashSet();
                return Task.FromResult(games.Where(g => wanted.Contains(g.Id)).AsEnumerable());
            });
        return igdb;
    }

    private static GameCacheService NewService(
        ApplicationDbContext db, IIgdbService igdb, TimeProvider? clock = null) =>
        new(db, igdb, clock ?? new FixedClock(Midday), NullLogger<GameCacheService>.Instance);

    // ── Filling it ────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetGamesAsync_WithNothingCached_FetchesAndStores()
    {
        using var db = NewDb();
        var igdb = IgdbReturning(Game(7, "Hades", rating: 92.5f));

        var games = await NewService(db, igdb).GetGamesAsync([7]);

        Assert.Equal("Hades", Assert.Single(games).Title);

        // The extracted columns are copies for reading a shelf without deserialising every
        // payload, so they have to be written alongside it rather than left to drift.
        var row = await db.CachedGames.SingleAsync();
        Assert.Equal(7, row.GameId);
        Assert.Equal("Hades", row.Title);
        Assert.Equal("cover.jpg", row.CoverImageUrl);
        Assert.Equal(92.5f, row.Rating);
        Assert.Equal(Midday, row.RefreshedAt);
        Assert.NotNull(row.Payload);
    }

    [Fact]
    public async Task GetGamesAsync_WithEverythingCachedAndFresh_AsksIgdbNothing()
    {
        using var db = NewDb();
        var igdb = IgdbReturning(Game(7));
        await NewService(db, igdb).GetGamesAsync([7]);
        igdb.ClearReceivedCalls();

        var games = await NewService(db, igdb).GetGamesAsync([7]);

        // The whole point: a second reader of the same shelf costs IGDB nothing.
        Assert.Single(games);
        await igdb.DidNotReceive()
            .GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetGamesAsync_WithSomeCached_AsksOnlyForTheRest()
    {
        using var db = NewDb();
        var igdb = IgdbReturning(Game(7), Game(8));
        await NewService(db, igdb).GetGamesAsync([7]);
        igdb.ClearReceivedCalls();

        var games = await NewService(db, igdb).GetGamesAsync([7, 8]);

        Assert.Equal([7, 8], games.Select(g => g.Id));
        await igdb.Received(1).GetGamesByIdsAsync(
            Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new[] { 8 })),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetGamesAsync_PastTheRefreshInterval_AsksAgainAndUpdates()
    {
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        await NewService(db, IgdbReturning(Game(7, "Hades")), clock).GetGamesAsync([7]);

        clock.Advance(GameCacheService.RefreshAfter);
        var games = await NewService(db, IgdbReturning(Game(7, "Hades II")), clock).GetGamesAsync([7]);

        Assert.Equal("Hades II", Assert.Single(games).Title);
        Assert.Equal("Hades II", (await db.CachedGames.SingleAsync()).Title);
    }

    // ── Surviving IGDB ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetGamesAsync_WhenIgdbFailsAndTheRowIsStale_ServesTheStaleOne()
    {
        using var db = NewDb();
        var clock = new FixedClock(Midday);
        await NewService(db, IgdbReturning(Game(7, "Hades")), clock).GetGamesAsync([7]);

        clock.Advance(GameCacheService.RefreshAfter * 10);
        var dead = Substitute.For<IIgdbService>();
        dead.GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down"));

        var games = await NewService(db, dead, clock).GetGamesAsync([7]);

        // Ten days stale and still rendered: this is the whole reason the table exists. The
        // alternative is somebody unable to see their own list because a third party is down.
        Assert.Equal("Hades", Assert.Single(games).Title);
    }

    [Fact]
    public async Task GetGamesAsync_WhenIgdbFailsAndNothingIsCached_ReturnsWhatItHas()
    {
        using var db = NewDb();
        await NewService(db, IgdbReturning(Game(7, "Hades"))).GetGamesAsync([7]);

        var dead = Substitute.For<IIgdbService>();
        dead.GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down"));

        var games = await NewService(db, dead).GetGamesAsync([7, 8]);

        // Game 8 has never been seen, so it cannot be rendered - but it does not take 7 down with
        // it, and the caller drops what it cannot show exactly as it always has.
        Assert.Equal([7], games.Select(g => g.Id));
    }

    [Fact]
    public async Task GetGamesAsync_WhenTheRequestIsCancelled_DoesNotSwallowIt()
    {
        using var db = NewDb();
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new OperationCanceledException());

        // A reader who navigated away is not an IGDB failure, and treating it as one would hide
        // the cancellation the whole stack is built to propagate.
        await Assert.ThrowsAsync<OperationCanceledException>(
            () => NewService(db, igdb).GetGamesAsync([7]));
    }

    // ── When the caching itself fails ─────────────────────────────────────────────────

    /// <summary>
    /// The write is the optimisation, not the answer. Caught in review on #90: the first version
    /// wrapped the store in the same try as the IGDB call, so a database hiccup was reported as an
    /// IGDB outage and discarded games already in hand.
    /// </summary>
    public static TheoryData<Exception> WriteFailures() =>
    [
        new DbUpdateException("another request inserted the same rows"),
        new TimeoutException("the database did not answer"),
    ];

    [Theory]
    [MemberData(nameof(WriteFailures))]
    public async Task GetGamesAsync_WhenTheWriteFails_StillAnswersWithWhatIgdbSaid(Exception failure)
    {
        using var db = NewUnwritableDb(failure);

        var games = await NewService(db, IgdbReturning(Game(7, "Hades"))).GetGamesAsync([7]);

        Assert.Equal("Hades", Assert.Single(games).Title);
    }

    [Theory]
    [MemberData(nameof(WriteFailures))]
    public async Task GetGamesAsync_WhenTheWriteFails_LeavesNothingPendingOnTheContext(Exception failure)
    {
        using var db = NewUnwritableDb(failure);

        await NewService(db, IgdbReturning(Game(7))).GetGamesAsync([7]);

        // Rows left pending would be retried by whatever the request saves next, and would fail it
        // too - turning a cache problem into a failed write of the user's own data.
        Assert.Empty(db.ChangeTracker.Entries<CachedGame>());
    }

    // ── Ids IGDB has no answer for ────────────────────────────────────────────────────

    [Fact]
    public async Task GetGamesAsync_WhenIgdbHasNoSuchGame_RemembersThatAndStopsAsking()
    {
        using var db = NewDb();
        var igdb = IgdbReturning(Game(7));

        var games = await NewService(db, igdb).GetGamesAsync([7, 404]);
        igdb.ClearReceivedCalls();
        await NewService(db, igdb).GetGamesAsync([7, 404]);

        Assert.Equal([7], games.Select(g => g.Id));

        // A tombstone: a withdrawn game still sitting on somebody's list must not mean an IGDB
        // call on every page load for as long as it stays there.
        var tombstone = await db.CachedGames.SingleAsync(g => g.GameId == 404);
        Assert.Null(tombstone.Payload);
        Assert.Null(tombstone.Title);
        await igdb.DidNotReceive()
            .GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>());
    }

    // ── Shape ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetGamesAsync_ReadingBackAPayload_KeepsTheGameItStored()
    {
        using var db = NewDb();
        var stored = Game(7, "Hades", rating: 92.5f);
        await NewService(db, IgdbReturning(stored)).GetGamesAsync([7]);

        var read = Assert.Single(await NewService(db, IgdbReturning(), new FixedClock(Midday))
            .GetGamesAsync([7]));

        Assert.Equal(stored.Id, read.Id);
        Assert.Equal(stored.Title, read.Title);
        Assert.Equal(stored.ReleaseDate, read.ReleaseDate);
        Assert.Equal(stored.CoverImageUrl, read.CoverImageUrl);
        Assert.Equal(stored.Rating, read.Rating);

        // Never the detail half: that is the game page's own query and is null everywhere else.
        Assert.Null(read.Details);
    }

    [Fact]
    public async Task GetGamesAsync_WithNoIds_AsksNothingAtAll()
    {
        using var db = NewDb();
        var igdb = Substitute.For<IIgdbService>();

        Assert.Empty(await NewService(db, igdb).GetGamesAsync([]));
        await igdb.DidNotReceive()
            .GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetGamesAsync_WithRepeatedIds_AsksForEachOnce()
    {
        using var db = NewDb();
        var igdb = IgdbReturning(Game(7));

        var games = await NewService(db, igdb).GetGamesAsync([7, 7, 7]);

        Assert.Single(games);
        await igdb.Received(1).GetGamesByIdsAsync(
            Arg.Is<IEnumerable<int>>(ids => ids.SequenceEqual(new[] { 7 })),
            Arg.Any<CancellationToken>());
    }
}
