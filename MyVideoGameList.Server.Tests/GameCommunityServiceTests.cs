using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What the community has recorded about one game — and which of it crosses which gate.
/// </summary>
/// <remarks>
/// The two reads are gated differently on purpose. The scores are an aggregate that names nobody,
/// so every score counts whatever the profile it came from; the reviews name their authors, so a
/// review is listed only when it is public <em>and</em> its author's profile is. See
/// <c>docs/decisions/0028-*</c>.
/// </remarks>
public class GameCommunityServiceTests
{
    private const int GameId = 1942;
    private const int OtherGameId = 7;

    private static readonly DateTimeOffset Now = new(2026, 9, 14, 12, 0, 0, TimeSpan.Zero);

    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static GameCommunityService NewService(ApplicationDbContext db) => new(db);

    /// <summary>An account, public unless a test says otherwise. Its id is derived from its name.</summary>
    private static string AddAccount(
        ApplicationDbContext db,
        string userName,
        string visibility = ProfileVisibility.Public)
    {
        var id = $"id-{userName.ToLowerInvariant()}";

        db.Users.Add(new ApplicationUser
        {
            Id = id,
            UserName = userName,
            NormalizedUserName = userName.ToUpperInvariant(),
            Email = $"{userName}@test.local",
            ProfileVisibility = visibility
        });
        db.SaveChanges();

        return id;
    }

    private static UserGameEntry AddEntry(
        ApplicationDbContext db,
        string userId,
        int gameId = GameId,
        short? score = null,
        string? status = ListStatusKeys.Finished)
    {
        var entry = new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            StatusId = status is null ? null : db.ListStatuses.Single(s => s.Key == status).Id,
            Score = score,
            AddedAt = Now
        };

        db.UserGameEntries.Add(entry);
        db.SaveChanges();
        return entry;
    }

    private static void AddReview(
        ApplicationDbContext db,
        string userId,
        int gameId = GameId,
        string body = "Played it.",
        string visibility = ReviewVisibility.Public,
        short? score = null,
        bool hasSpoilers = false,
        DateTimeOffset? updatedAt = null)
    {
        db.Reviews.Add(new Review
        {
            UserId = userId,
            Entry = AddEntry(db, userId, gameId, score),
            Body = body,
            HasSpoilers = hasSpoilers,
            Visibility = visibility,
            CreatedAt = Now.AddDays(-30),
            UpdatedAt = updatedAt ?? Now
        });

        db.SaveChanges();
    }

    // ── The scores ────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetScoresAsync_NobodyHasScored_IsTenEmptyBucketsAndNoMean()
    {
        using var db = NewDb();

        var scores = await NewService(db).GetScoresAsync(GameId);

        // An answer, not an absence: the client never has to guard a missing bucket, and a mean
        // over nothing is unknown rather than zero.
        Assert.Equal(0, scores.Scored);
        Assert.Null(scores.Mean);
        Assert.Equal(10, scores.Distribution.Count);
        Assert.All(scores.Distribution, count => Assert.Equal(0, count));
    }

    [Fact]
    public async Task GetScoresAsync_EveryMembersScore_IsCountedIntoItsBucket()
    {
        using var db = NewDb();
        AddEntry(db, AddAccount(db, "alex"), score: 8);
        AddEntry(db, AddAccount(db, "sam"), score: 8);
        AddEntry(db, AddAccount(db, "nadia"), score: 5);

        var scores = await NewService(db).GetScoresAsync(GameId);

        Assert.Equal(3, scores.Scored);
        Assert.Equal(7, scores.Mean);
        Assert.Equal(2, scores.Distribution[7]);
        Assert.Equal(1, scores.Distribution[4]);
        Assert.Equal(3, scores.Distribution.Sum());
    }

    [Fact]
    public async Task GetScoresAsync_AnotherGame_IsNotCounted()
    {
        using var db = NewDb();
        var alex = AddAccount(db, "alex");
        AddEntry(db, alex, score: 9);
        AddEntry(db, alex, gameId: OtherGameId, score: 2);

        var scores = await NewService(db).GetScoresAsync(GameId);

        Assert.Equal(1, scores.Scored);
        Assert.Equal(9, scores.Mean);
    }

    [Fact]
    public async Task GetScoresAsync_EntryWithNoScore_IsNotCounted()
    {
        // Tracking a game is not scoring it. Counting the entry would put a zero in nobody's
        // opinion and drag the mean with it.
        using var db = NewDb();
        AddEntry(db, AddAccount(db, "alex"), score: 6);
        AddEntry(db, AddAccount(db, "sam"), status: ListStatusKeys.Playing);

        var scores = await NewService(db).GetScoresAsync(GameId);

        Assert.Equal(1, scores.Scored);
        Assert.Equal(6, scores.Mean);
    }

    [Fact]
    public async Task GetScoresAsync_ScoredGameInNoList_StillCounts()
    {
        // A score is a judgement about the game and survives it leaving every list (ADR 0019), so
        // the entry's status has nothing to say about whether the score is real.
        using var db = NewDb();
        AddEntry(db, AddAccount(db, "alex"), score: 4, status: null);

        var scores = await NewService(db).GetScoresAsync(GameId);

        Assert.Equal(1, scores.Scored);
    }

    [Fact]
    public async Task GetScoresAsync_ScoreFromAPrivateProfile_StillCounts()
    {
        // The aggregate names nobody, so it is not publishing anybody's library — the same basis
        // the community times have always been counted on. Only the reviews, which do name their
        // authors, are held behind the profile gate.
        using var db = NewDb();
        AddEntry(db, AddAccount(db, "alex", ProfileVisibility.Private), score: 10);
        AddEntry(db, AddAccount(db, "sam"), score: 6);

        var scores = await NewService(db).GetScoresAsync(GameId);

        Assert.Equal(2, scores.Scored);
        Assert.Equal(8, scores.Mean);
    }

    [Fact]
    public async Task GetScoresAsync_ScoreOutsideTheScale_IsLeftOutOfEveryFigure()
    {
        // PostgreSQL's check constraint would refuse this row; the in-memory provider does not, and
        // the arithmetic is shared with the profile, which already pins the same rule.
        using var db = NewDb();
        AddEntry(db, AddAccount(db, "alex"), score: 42);
        AddEntry(db, AddAccount(db, "sam"), score: 6);

        var scores = await NewService(db).GetScoresAsync(GameId);

        Assert.Equal(1, scores.Scored);
        Assert.Equal(6, scores.Mean);
        Assert.Equal(1, scores.Distribution.Sum());
    }

    // ── The reviews: which cross the gate ─────────────────────────────────────────────

    [Fact]
    public async Task GetReviewsAsync_PublishedReview_IsListedUnderItsAuthorsName()
    {
        using var db = NewDb();
        AddReview(db, AddAccount(db, "Alex"), body: "The best side quests in the genre.", hasSpoilers: true);

        var page = await NewService(db).GetReviewsAsync(GameId, 1);

        var review = Assert.Single(page.Reviews);
        // As its owner capitalised it, because the name is theirs.
        Assert.Equal("Alex", review.UserName);
        Assert.Equal("The best side quests in the genre.", review.Body);
        Assert.True(review.HasSpoilers);
        Assert.Equal(1, page.Total);
    }

    [Fact]
    public async Task GetReviewsAsync_PrivateReview_IsNotListed()
    {
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"), visibility: ReviewVisibility.Private);

        var page = await NewService(db).GetReviewsAsync(GameId, 1);

        Assert.Empty(page.Reviews);
        Assert.Equal(0, page.Total);
    }

    [Fact]
    public async Task GetReviewsAsync_PublicReviewOnAPrivateProfile_IsNotListed()
    {
        // The narrower gate wins, here as on the profile. Somebody who marked a review public but
        // has not published their profile has published the review nowhere — and listing it on the
        // game page would put their name on it besides.
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex", ProfileVisibility.Private));

        var page = await NewService(db).GetReviewsAsync(GameId, 1);

        Assert.Empty(page.Reviews);
        Assert.Equal(0, page.Total);
    }

    [Fact]
    public async Task GetReviewsAsync_Total_CountsOnlyPublishedReviews()
    {
        // The total is what the page says there are, so a withheld review must not be counted
        // into it: "3 reviews" over one visible card would announce the other two.
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"), body: "Published.");
        AddReview(db, AddAccount(db, "sam"), visibility: ReviewVisibility.Private);
        AddReview(db, AddAccount(db, "nadia", ProfileVisibility.Private));

        var page = await NewService(db).GetReviewsAsync(GameId, 1);

        Assert.Equal(["Published."], page.Reviews.Select(r => r.Body));
        Assert.Equal(1, page.Total);
    }

    [Fact]
    public async Task GetReviewsAsync_AnotherGamesReview_IsNotListed()
    {
        using var db = NewDb();
        var alex = AddAccount(db, "alex");
        AddReview(db, alex, body: "This game.");
        AddReview(db, alex, gameId: OtherGameId, body: "Another game.");

        var page = await NewService(db).GetReviewsAsync(GameId, 1);

        Assert.Equal(["This game."], page.Reviews.Select(r => r.Body));
    }

    [Fact]
    public async Task GetReviewsAsync_CarriesTheAuthorsScoreFromTheEntry()
    {
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"), score: 9);
        AddReview(db, AddAccount(db, "sam"), updatedAt: Now.AddDays(-1));

        var page = await NewService(db).GetReviewsAsync(GameId, 1);

        Assert.Equal((short)9, page.Reviews.Single(r => r.UserName == "alex").Score);
        // Null rather than zero: writing about a game without scoring it is a real state.
        Assert.Null(page.Reviews.Single(r => r.UserName == "sam").Score);
    }

    // ── The reviews: order and pages ──────────────────────────────────────────────────

    [Fact]
    public async Task GetReviewsAsync_MostRecentlyUpdatedFirst()
    {
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"), body: "Oldest.", updatedAt: Now.AddDays(-10));
        AddReview(db, AddAccount(db, "sam"), body: "Newest.", updatedAt: Now);
        AddReview(db, AddAccount(db, "nadia"), body: "Middle.", updatedAt: Now.AddDays(-5));

        var page = await NewService(db).GetReviewsAsync(GameId, 1);

        Assert.Equal(["Newest.", "Middle.", "Oldest."], page.Reviews.Select(r => r.Body));
    }

    [Fact]
    public async Task GetReviewsAsync_SameUpdatedAt_BreaksTheTieOnTheLaterReview()
    {
        // Without a tie-break the order of equal timestamps is whatever the database returns, and a
        // page boundary could then show one review twice and another never.
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"), body: "Written first.");
        AddReview(db, AddAccount(db, "sam"), body: "Written second.");

        var page = await NewService(db).GetReviewsAsync(GameId, 1);

        Assert.Equal(["Written second.", "Written first."], page.Reviews.Select(r => r.Body));
    }

    [Fact]
    public async Task GetReviewsAsync_SecondPage_ContinuesWhereTheFirstEnded()
    {
        using var db = NewDb();
        var perPage = GameCommunityService.ReviewsPerPage;
        for (var i = 0; i < perPage + 2; i++)
            AddReview(db, AddAccount(db, $"member{i}"), body: $"Review {i}.", updatedAt: Now.AddMinutes(-i));

        var first = await NewService(db).GetReviewsAsync(GameId, 1);
        var second = await NewService(db).GetReviewsAsync(GameId, 2);

        Assert.Equal(perPage, first.Reviews.Count);
        Assert.Equal(["Review 10.", "Review 11."], second.Reviews.Select(r => r.Body));
        Assert.Equal(perPage + 2, second.Total);
        Assert.Equal(2, second.Page);
        Assert.Equal(perPage, second.PageSize);
        Assert.Empty(first.Reviews.Select(r => r.UserName).Intersect(second.Reviews.Select(r => r.UserName)));
    }

    [Fact]
    public async Task GetReviewsAsync_PageBeyondTheEnd_IsEmptyAndStillCarriesTheTotal()
    {
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"));

        var page = await NewService(db).GetReviewsAsync(GameId, 99);

        Assert.Empty(page.Reviews);
        // So a client that asked for one page too many — because a review was withdrawn while it
        // was reading — learns there is nothing further rather than an error.
        Assert.Equal(1, page.Total);
    }

    [Fact]
    public async Task GetReviewsAsync_PageAtIntMaxValue_IsEmptyRatherThanAnOverflow()
    {
        // [Range(1, int.MaxValue)] on the controller admits this, and (page - 1) * 10 overflows into
        // a negative offset that PostgreSQL refuses — a 500 for a URL anybody can type.
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"));

        var page = await NewService(db).GetReviewsAsync(GameId, int.MaxValue);

        Assert.Empty(page.Reviews);
        Assert.Equal(1, page.Total);
        Assert.Equal(int.MaxValue, page.Page);
    }
}
