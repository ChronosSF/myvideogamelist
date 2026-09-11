using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What a public profile publishes, and — more to the point — what it does not.
/// </summary>
/// <remarks>
/// Two gates are under test here rather than one. The account's <c>ProfileVisibility</c> decides
/// whether there is a page, and each review's own visibility decides what appears on it; the
/// narrower of the two always wins. See <c>docs/decisions/0027-usernames-and-public-profiles.md</c>.
/// </remarks>
public class PublicProfileServiceTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";

    private static readonly DateTimeOffset Now = new(2026, 9, 10, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    /// <summary>
    /// The real <see cref="StatsService"/>, deliberately. A substitute would let this suite agree
    /// with a set of figures nothing produces; using the same service the owner's own profile uses
    /// is what makes "the public page and the private one say the same thing" an actual claim.
    /// </summary>
    private static PublicProfileService NewService(
        ApplicationDbContext db, IIgdbService? igdb = null) =>
        new(db,
            new UpperInvariantLookupNormalizer(),
            new StatsService(db, new FixedClock(Now)),
            igdb ?? Substitute.For<IIgdbService>());

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
            // Set exactly as Identity would set it, because that is the column the lookup matches.
            NormalizedUserName = userName.ToUpperInvariant(),
            Email = $"{userName}@test.local",
            ProfileVisibility = visibility
        });
        db.SaveChanges();
    }

    private static short StatusId(ApplicationDbContext db, string key) =>
        db.ListStatuses.Single(s => s.Key == key).Id;

    private static UserGameEntry AddEntry(
        ApplicationDbContext db,
        int gameId,
        string userId = UserId,
        string? status = null,
        short? score = null)
    {
        var entry = new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            StatusId = status is null ? null : StatusId(db, status),
            Score = score,
            AddedAt = Now
        };

        db.UserGameEntries.Add(entry);
        db.SaveChanges();
        return entry;
    }

    private static void AddReview(
        ApplicationDbContext db,
        int gameId,
        string userId = UserId,
        string body = "Played it.",
        string visibility = ReviewVisibility.Public,
        short? score = null,
        DateTimeOffset? updatedAt = null)
    {
        var entry = AddEntry(db, gameId, userId, score: score);

        db.Reviews.Add(new Review
        {
            UserId = userId,
            Entry = entry,
            Body = body,
            HasSpoilers = false,
            Visibility = visibility,
            CreatedAt = Now,
            UpdatedAt = updatedAt ?? Now
        });

        db.SaveChanges();
    }

    private static GameDto Game(int id, string title) =>
        new(id, title, null, null, null, null, null, null, null, null, null, null, null,
            [], [], [], [], null);

    private static IIgdbService IgdbKnowing(params GameDto[] games)
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

    // ── The visibility gate ───────────────────────────────────────────────────────────

    [Fact]
    public async Task GetProfileAsync_PublicProfile_ReturnsTheirFigures()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "alex");
        AddEntry(db, gameId: 11, status: ListStatusKeys.Finished, score: 8);
        AddEntry(db, gameId: 12, status: ListStatusKeys.Playing);

        var profile = await NewService(db).GetProfileAsync("alex", default);

        Assert.NotNull(profile);
        Assert.Equal("alex", profile.UserName);
        Assert.Equal(2, profile.Library.Tracked);
        Assert.Equal(1, profile.Scores.Scored);
    }

    [Fact]
    public async Task GetProfileAsync_PrivateProfile_ReturnsNull()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "alex", ProfileVisibility.Private);
        AddEntry(db, gameId: 11, status: ListStatusKeys.Finished);

        Assert.Null(await NewService(db).GetProfileAsync("alex", default));
    }

    [Fact]
    public async Task GetProfileAsync_UnknownUserName_ReturnsNull()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "alex");

        // Indistinguishable from the private case above, and that is the design: telling them apart
        // would answer "does this name have an account here" for somebody who declined to say.
        Assert.Null(await NewService(db).GetProfileAsync("nobody", default));
    }

    [Theory]
    [InlineData("alex")]
    [InlineData("ALEX")]
    [InlineData("AlEx")]
    public async Task GetProfileAsync_AnyCasing_ResolvesTheSameProfile(string typed)
    {
        using var db = NewDb();
        AddAccount(db, UserId, "Alex");

        var profile = await NewService(db).GetProfileAsync(typed, default);

        Assert.NotNull(profile);
        // The stored capitalisation, not whatever was typed into the URL: it is the owner's name.
        Assert.Equal("Alex", profile.UserName);
    }

    [Fact]
    public async Task GetProfileAsync_AnotherUsersRows_AreNeverCounted()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "alex");
        AddAccount(db, OtherUserId, "sam");

        AddEntry(db, gameId: 11, status: ListStatusKeys.Finished, score: 8);
        AddEntry(db, gameId: 21, userId: OtherUserId, status: ListStatusKeys.Finished, score: 2);
        AddEntry(db, gameId: 22, userId: OtherUserId, status: ListStatusKeys.Playing);

        var profile = await NewService(db).GetProfileAsync("alex", default);

        Assert.NotNull(profile);
        Assert.Equal(1, profile.Library.Tracked);
        Assert.Equal(1, profile.Scores.Scored);
    }

    // ── What crosses the gate ─────────────────────────────────────────────────────────

    [Fact]
    public async Task GetProfileAsync_CountsOnlyPublicReviews()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "alex");
        AddReview(db, gameId: 11);
        AddReview(db, gameId: 12, visibility: ReviewVisibility.Private);

        var profile = await NewService(db).GetProfileAsync("alex", default);

        Assert.NotNull(profile);
        Assert.Equal(1, profile.Reviews);
    }

    [Fact]
    public async Task GetProfileAsync_MakesNoIgdbCall()
    {
        // The rule this pins is ADR 0023's, extended to the public page: a figure about what
        // somebody has done must not go dark because a third party is. The reviews are the one part
        // that needs game metadata, and they are a separate request for exactly this reason.
        using var db = NewDb();
        AddAccount(db, UserId, "alex");
        AddEntry(db, gameId: 11, status: ListStatusKeys.Finished, score: 8);

        var igdb = Substitute.For<IIgdbService>();
        await NewService(db, igdb).GetProfileAsync("alex", default);

        await igdb.DidNotReceiveWithAnyArgs()
            .GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>());
    }

    // ── The reviews ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetReviewsAsync_PrivateReviews_AreNeverReturned()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "alex");
        AddReview(db, gameId: 11, body: "Public one.");
        AddReview(db, gameId: 12, body: "Private one.", visibility: ReviewVisibility.Private);

        var page = await NewService(db, IgdbKnowing(Game(11, "One"), Game(12, "Two")))
            .GetReviewsAsync("alex", 1, default);

        Assert.NotNull(page);
        Assert.Equal(["Public one."], page.Reviews.Select(r => r.Body));
        Assert.Equal(1, page.Total);
    }

    [Fact]
    public async Task GetReviewsAsync_AnotherUsersReviews_AreNeverReturned()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "alex");
        AddAccount(db, OtherUserId, "sam");
        AddReview(db, gameId: 11, body: "Mine.");
        AddReview(db, gameId: 21, userId: OtherUserId, body: "Theirs.");

        var page = await NewService(db, IgdbKnowing(Game(11, "One"), Game(21, "Two")))
            .GetReviewsAsync("alex", 1, default);

        Assert.NotNull(page);
        Assert.Equal(["Mine."], page.Reviews.Select(r => r.Body));
    }

    [Fact]
    public async Task GetReviewsAsync_PublicReviewOnAPrivateProfile_IsNotVisible()
    {
        // The narrower gate wins. A review marked public by somebody who has not published their
        // profile is published nowhere — which is the only reading of the two settings that does
        // not surprise whoever set them.
        using var db = NewDb();
        AddAccount(db, UserId, "alex", ProfileVisibility.Private);
        AddReview(db, gameId: 11);

        Assert.Null(await NewService(db, IgdbKnowing(Game(11, "One")))
            .GetReviewsAsync("alex", 1, default));
    }

    [Fact]
    public async Task GetReviewsAsync_CarriesTheAuthorsScoreFromTheEntry()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "alex");
        AddReview(db, gameId: 11, score: 9);
        AddReview(db, gameId: 12, updatedAt: Now.AddDays(-1));

        var page = await NewService(db, IgdbKnowing(Game(11, "One"), Game(12, "Two")))
            .GetReviewsAsync("alex", 1, default);

        Assert.NotNull(page);
        Assert.Equal((short)9, page.Reviews.Single(r => r.Game.Id == 11).Score);
        // Null rather than zero: writing about a game without scoring it is a real state.
        Assert.Null(page.Reviews.Single(r => r.Game.Id == 12).Score);
    }

    [Fact]
    public async Task GetReviewsAsync_MostRecentlyUpdatedFirst()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "alex");
        AddReview(db, gameId: 11, body: "Oldest.", updatedAt: Now.AddDays(-10));
        AddReview(db, gameId: 12, body: "Newest.", updatedAt: Now);
        AddReview(db, gameId: 13, body: "Middle.", updatedAt: Now.AddDays(-5));

        var page = await NewService(db, IgdbKnowing(Game(11, "A"), Game(12, "B"), Game(13, "C")))
            .GetReviewsAsync("alex", 1, default);

        Assert.NotNull(page);
        Assert.Equal(["Newest.", "Middle.", "Oldest."], page.Reviews.Select(r => r.Body));
    }

    [Fact]
    public async Task GetReviewsAsync_PageBeyondTheEnd_IsEmptyRatherThanAnError()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "alex");
        AddReview(db, gameId: 11);

        var page = await NewService(db, IgdbKnowing(Game(11, "One")))
            .GetReviewsAsync("alex", 99, default);

        Assert.NotNull(page);
        Assert.Empty(page.Reviews);
        // Still says how many there are, so a client on a stale link can show the way back.
        Assert.Equal(1, page.Total);
    }

    [Fact]
    public async Task GetReviewsAsync_PageAtIntMaxValue_IsEmptyRatherThanAnOverflow()
    {
        // [Range(1, int.MaxValue)] on the controller admits this, and (page - 1) * 20 overflows
        // into a negative offset that PostgreSQL refuses — a 500 for a URL anybody can type. The
        // empty page is answered before any query or IGDB call is made.
        using var db = NewDb();
        AddAccount(db, UserId, "alex");
        AddReview(db, gameId: 11);
        var igdb = IgdbKnowing(Game(11, "One"));

        var page = await NewService(db, igdb).GetReviewsAsync("alex", int.MaxValue, default);

        Assert.NotNull(page);
        Assert.Empty(page.Reviews);
        Assert.Equal(1, page.Total);
        Assert.Equal(int.MaxValue, page.Page);
        await igdb.DidNotReceiveWithAnyArgs()
            .GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetReviewsAsync_GameIgdbNoLongerReturns_IsDroppedButStillCounted()
    {
        // Rendering a review against a blank card would be worse than omitting it, and ListService
        // drops an unresolvable entry the same way. The total is about what the user wrote, not
        // about what a third party can still describe, so it keeps counting the row.
        using var db = NewDb();
        AddAccount(db, UserId, "alex");
        AddReview(db, gameId: 11, body: "Still known.");
        AddReview(db, gameId: 12, body: "Vanished.", updatedAt: Now.AddDays(-1));

        var page = await NewService(db, IgdbKnowing(Game(11, "One")))
            .GetReviewsAsync("alex", 1, default);

        Assert.NotNull(page);
        Assert.Equal(["Still known."], page.Reviews.Select(r => r.Body));
        Assert.Equal(2, page.Total);
    }

    [Fact]
    public async Task GetReviewsAsync_NoReviews_MakesNoIgdbCall()
    {
        // A profile with nothing published must not spend a request asking IGDB about an empty
        // list of ids, which is a query with no answer and a rate limit behind it.
        using var db = NewDb();
        AddAccount(db, UserId, "alex");

        var igdb = Substitute.For<IIgdbService>();
        var page = await NewService(db, igdb).GetReviewsAsync("alex", 1, default);

        Assert.NotNull(page);
        Assert.Empty(page.Reviews);
        await igdb.DidNotReceiveWithAnyArgs()
            .GetGamesByIdsAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>());
    }
}
