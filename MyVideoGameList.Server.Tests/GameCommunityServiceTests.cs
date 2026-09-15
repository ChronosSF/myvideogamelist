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
        DateTimeOffset? createdAt = null)
    {
        db.Reviews.Add(new Review
        {
            UserId = userId,
            Entry = AddEntry(db, userId, gameId, score),
            Body = body,
            HasSpoilers = hasSpoilers,
            Visibility = visibility,
            CreatedAt = createdAt ?? Now,
            UpdatedAt = createdAt ?? Now
        });

        db.SaveChanges();
    }

    /// <summary>Twelve published reviews, written a minute apart, "Review 0." the newest.</summary>
    private static void AddTwelveReviews(ApplicationDbContext db)
    {
        for (var i = 0; i < 12; i++)
            AddReview(db, AddAccount(db, $"member{i}"), body: $"Review {i}.", createdAt: Now.AddMinutes(-i));
    }

    /// <summary>Every page of a game's reviews, following each cursor to the end.</summary>
    private static async Task<List<string>> ReadEveryPage(GameCommunityService service)
    {
        var bodies = new List<string>();
        string? after = null;

        // Bounded, so a cursor that failed to advance fails the test rather than hanging it.
        for (var pages = 0; pages < 10; pages++)
        {
            var page = await service.GetReviewsAsync(GameId, after);
            bodies.AddRange(page.Reviews.Select(r => r.Body));
            if (page.Next is null) return bodies;
            after = page.Next;
        }

        throw new InvalidOperationException("The cursor never reached the end.");
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

        var page = await NewService(db).GetReviewsAsync(GameId, after: null);

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

        var page = await NewService(db).GetReviewsAsync(GameId, after: null);

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

        var page = await NewService(db).GetReviewsAsync(GameId, after: null);

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

        var page = await NewService(db).GetReviewsAsync(GameId, after: null);

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

        var page = await NewService(db).GetReviewsAsync(GameId, after: null);

        Assert.Equal(["This game."], page.Reviews.Select(r => r.Body));
    }

    [Fact]
    public async Task GetReviewsAsync_CarriesTheAuthorsScoreFromTheEntry()
    {
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"), score: 9);
        AddReview(db, AddAccount(db, "sam"), createdAt: Now.AddDays(-1));

        var page = await NewService(db).GetReviewsAsync(GameId, after: null);

        Assert.Equal((short)9, page.Reviews.Single(r => r.UserName == "alex").Score);
        // Null rather than zero: writing about a game without scoring it is a real state.
        Assert.Null(page.Reviews.Single(r => r.UserName == "sam").Score);
    }

    // ── The reviews: order ────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetReviewsAsync_MostRecentlyWrittenFirst()
    {
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"), body: "Oldest.", createdAt: Now.AddDays(-10));
        AddReview(db, AddAccount(db, "sam"), body: "Newest.", createdAt: Now);
        AddReview(db, AddAccount(db, "nadia"), body: "Middle.", createdAt: Now.AddDays(-5));

        var page = await NewService(db).GetReviewsAsync(GameId, after: null);

        Assert.Equal(["Newest.", "Middle.", "Oldest."], page.Reviews.Select(r => r.Body));
    }

    [Fact]
    public async Task GetReviewsAsync_RewrittenReview_KeepsItsPlace()
    {
        // Ordering by the last rewrite would let a review jump above a reader's cursor and be skipped
        // on their next page. The order is by when it was written, which never changes.
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"), body: "Written first.", createdAt: Now.AddDays(-10));
        AddReview(db, AddAccount(db, "sam"), body: "Written second.", createdAt: Now.AddDays(-5));

        var rewritten = db.Reviews.Single(r => r.Body == "Written first.");
        rewritten.UpdatedAt = Now;
        db.SaveChanges();

        var page = await NewService(db).GetReviewsAsync(GameId, after: null);

        Assert.Equal(["Written second.", "Written first."], page.Reviews.Select(r => r.Body));
    }

    [Fact]
    public async Task GetReviewsAsync_WrittenInTheSameInstant_OrderedByAuthorsName()
    {
        // Without a tie-break the order of equal timestamps is whatever the database returns, and a
        // page boundary could then show one review twice and another never.
        using var db = NewDb();
        AddReview(db, AddAccount(db, "sam"), body: "By sam.");
        AddReview(db, AddAccount(db, "alex"), body: "By alex.");

        var page = await NewService(db).GetReviewsAsync(GameId, after: null);

        Assert.Equal(["By alex.", "By sam."], page.Reviews.Select(r => r.Body));
    }

    // ── The reviews: pages ────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetReviewsAsync_NextPage_ContinuesWhereTheFirstEnded()
    {
        using var db = NewDb();
        AddTwelveReviews(db);
        var service = NewService(db);

        var first = await service.GetReviewsAsync(GameId, after: null);
        var second = await service.GetReviewsAsync(GameId, first.Next);

        Assert.Equal(GameCommunityService.ReviewsPerPage, first.Reviews.Count);
        Assert.NotNull(first.Next);
        Assert.Equal(["Review 10.", "Review 11."], second.Reviews.Select(r => r.Body));
        Assert.Equal(12, second.Total);
    }

    [Fact]
    public async Task GetReviewsAsync_LastPage_HasNoCursor()
    {
        // Learned by reading one row past the page rather than by counting, so a page that happens
        // to end exactly on the last review does not offer an empty one after it.
        using var db = NewDb();
        for (var i = 0; i < GameCommunityService.ReviewsPerPage; i++)
            AddReview(db, AddAccount(db, $"member{i}"), createdAt: Now.AddMinutes(-i));

        var page = await NewService(db).GetReviewsAsync(GameId, after: null);

        Assert.Equal(GameCommunityService.ReviewsPerPage, page.Reviews.Count);
        Assert.Null(page.Next);
    }

    [Fact]
    public async Task GetReviewsAsync_ReviewWithdrawnFromAnEarlierPage_SkipsNothingOnTheNext()
    {
        // The case an offset gets wrong. With page 1 already read, withdrawing one of its reviews
        // shifts every later one up a place, so "offset 10" would start at Review 11 and Review 10
        // would never be shown. A cursor names Review 9, and everything written before it is still
        // everything written before it.
        using var db = NewDb();
        AddTwelveReviews(db);
        var service = NewService(db);

        var first = await service.GetReviewsAsync(GameId, after: null);

        db.Reviews.Single(r => r.Body == "Review 3.").Visibility = ReviewVisibility.Private;
        db.SaveChanges();

        var second = await service.GetReviewsAsync(GameId, first.Next);

        Assert.Equal(["Review 10.", "Review 11."], second.Reviews.Select(r => r.Body));
        Assert.Equal(11, second.Total);
    }

    [Fact]
    public async Task GetReviewsAsync_UnreadReviewRewrittenWhileReading_IsStillReached()
    {
        // The other way offsets and rewrite-ordering lose a review: rewriting one the reader has not
        // reached yet. It keeps its place, so the next page still finds it.
        using var db = NewDb();
        AddTwelveReviews(db);
        var service = NewService(db);

        var first = await service.GetReviewsAsync(GameId, after: null);

        var unread = db.Reviews.Single(r => r.Body == "Review 11.");
        unread.Body = "Review 11, rewritten.";
        unread.UpdatedAt = Now.AddMinutes(5);
        db.SaveChanges();

        var second = await service.GetReviewsAsync(GameId, first.Next);

        Assert.Equal(["Review 10.", "Review 11, rewritten."], second.Reviews.Select(r => r.Body));
    }

    [Fact]
    public async Task GetReviewsAsync_TieAcrossAPageBoundary_ShowsEveryReviewOnce()
    {
        // Eleven reviews written in one instant: the cursor's name is what carries the second page
        // on from the right place.
        using var db = NewDb();
        for (var i = 0; i < 11; i++)
            AddReview(db, AddAccount(db, $"member{i:00}"), body: $"By member{i:00}.");

        var bodies = await ReadEveryPage(NewService(db));

        Assert.Equal(11, bodies.Count);
        Assert.Equal(11, bodies.Distinct().Count());
        Assert.Equal(Enumerable.Range(0, 11).Select(i => $"By member{i:00}."), bodies);
    }

    [Fact]
    public async Task GetReviewsAsync_CursorPastTheEnd_IsEmptyAndStillCarriesTheTotal()
    {
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"));

        var past = ReviewCursor.Format(Now.AddYears(-50), "zzz");
        var page = await NewService(db).GetReviewsAsync(GameId, past);

        Assert.Empty(page.Reviews);
        Assert.Null(page.Next);
        Assert.Equal(1, page.Total);
    }

    [Fact]
    public async Task GetReviewsAsync_MalformedCursor_Throws()
    {
        // The endpoint's attribute turns this into a 400 before it gets here. Quietly reading it as
        // "from the start" instead would show a reader the first page again as though it were the
        // next.
        using var db = NewDb();

        await Assert.ThrowsAsync<ArgumentException>(() =>
            NewService(db).GetReviewsAsync(GameId, "not-a-cursor"));
    }
}
