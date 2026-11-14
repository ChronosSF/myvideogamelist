using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Edge;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The admin's side of moderation: what the queue shows, and what hiding, showing, clearing and dismissing
/// change (ADR 0076 §2, §3).
/// </summary>
/// <remarks>
/// Which of those take a profile off the edge is <see cref="ProfileWithdrawalTests"/>', with every other
/// withdrawal. PostgreSQL's cascades and indexes are the integration suite's.
/// </remarks>
public class ModerationServiceTests : IDisposable
{
    private const int GameId = 1942;
    private static readonly DateTimeOffset Midday = new(2026, 11, 2, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private readonly ServiceProvider root;
    private readonly IServiceScope scope;
    private readonly IGameCacheService games = Substitute.For<IGameCacheService>();
    private readonly BeforeTheNextSave beforeTheNextSave = new();

    /// <summary>
    /// Runs a write of somebody else's, through a context of its own, just before the act's next save: what
    /// a second request committing between the act's read and its save looks like from the act.
    /// </summary>
    private sealed class BeforeTheNextSave : SaveChangesInterceptor
    {
        public Action? Then { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            var then = Then;
            Then = null;
            then?.Invoke();
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    private void Meanwhile(Action<ApplicationDbContext> write) => beforeTheNextSave.Then = () =>
    {
        using var other = root.CreateScope();
        var db = other.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        write(db);
        db.SaveChanges();
    };

    public ModerationServiceTests()
    {
        var store = Guid.NewGuid().ToString();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContext<ApplicationDbContext>(options => options.UseInMemoryDatabase(store).AddInterceptors(beforeTheNextSave));
        services
            .AddIdentityCore<ApplicationUser>(options =>
                options.User.AllowedUserNameCharacters = UserNamePolicy.AllowedCharacters)
            .AddEntityFrameworkStores<ApplicationDbContext>();
        services.AddSingleton<IEdgeInvalidator>(new RecordingEdgeInvalidator());
        services.AddScoped<ProfileWithdrawals>();
        services.AddSingleton<TimeProvider>(new FixedClock(Midday));
        services.AddSingleton(games);
        services.AddScoped<ModerationService>();

        root = services.BuildServiceProvider();
        scope = root.CreateScope();
        Db.Database.EnsureCreated();
    }

    public void Dispose()
    {
        scope.Dispose();
        root.Dispose();
    }

    private ApplicationDbContext Db => scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

    private ModerationService Moderation => scope.ServiceProvider.GetRequiredService<ModerationService>();

    /// <summary>What is stored, through a context of its own rather than the one the write ran in.</summary>
    private T Stored<T>(Func<ApplicationDbContext, T> read)
    {
        using var fresh = root.CreateScope();
        var db = fresh.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        db.ChangeTracker.QueryTrackingBehavior = QueryTrackingBehavior.NoTracking;
        return read(db);
    }

    private async Task<ApplicationUser> AccountAsync(
        string userName,
        string visibility = ProfileVisibility.Public,
        string? displayName = "Shown Name",
        string? avatarUrl = "https://i.imgur.com/shown.png",
        string? bio = "A bio.")
    {
        var user = new ApplicationUser
        {
            UserName = userName,
            Email = $"{userName}@test.local",
            ProfileVisibility = visibility,
            DisplayName = displayName,
            AvatarUrl = avatarUrl,
            Bio = bio,
        };
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var created = await users.CreateAsync(user, "Password1!");
        Assert.True(created.Succeeded);
        return user;
    }

    private int AddReview(
        string userId,
        string body = "Words.",
        int gameId = GameId,
        string visibility = ReviewVisibility.Public,
        DateTimeOffset? hiddenAt = null)
    {
        var review = new Review
        {
            UserId = userId,
            Entry = new UserGameEntry { UserId = userId, GameId = gameId, AddedAt = Midday },
            Body = body,
            Visibility = visibility,
            CreatedAt = Midday,
            UpdatedAt = Midday,
            HiddenAt = hiddenAt,
        };
        Db.Reviews.Add(review);
        Db.SaveChanges();
        return review.Id;
    }

    private void AddReport(
        string reporterId,
        int? reviewId = null,
        string? profileUserId = null,
        string reason = ReportReason.Spam,
        string? note = null,
        int minutesAgo = 0)
    {
        Db.ContentReports.Add(new ContentReport
        {
            UserId = reporterId,
            ReviewId = reviewId,
            ProfileUserId = profileUserId,
            Reason = reason,
            Note = note,
            CreatedAt = Midday.AddMinutes(-minutesAgo),
        });
        Db.SaveChanges();
    }

    private static GameDto Game(int id, string title) =>
        new(id, title, null, null, null, null, null, null, null, null, null, null, null, [], [], [], [], null);

    // ---------------------------------------------------------------------------------------
    // The queue
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task GetQueueAsync_ThreeReportsOfOneReview_AreOneItemWithEveryReportAndNoReporter()
    {
        var alex = await AccountAsync("alex");
        var reviewId = AddReview(alex.Id, "Buy gold at example.test");
        AddReport("r1", reviewId, reason: ReportReason.Spam, minutesAgo: 30);
        AddReport("r2", reviewId, reason: ReportReason.Abuse, note: "Rude.", minutesAgo: 20);
        AddReport("r3", reviewId, reason: ReportReason.Other, minutesAgo: 10);
        games.GetGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns([Game(GameId, "Halo")]);

        var queue = await Moderation.GetQueueAsync();

        var item = Assert.Single(queue.Reviews);
        Assert.Equal((reviewId, "alex", "Shown Name", GameId, "Halo", "Buy gold at example.test", true),
            (item.ReviewId, item.UserName, item.DisplayName, item.GameId, item.GameTitle, item.Body, item.Published));
        Assert.Equal(
            [(ReportReason.Spam, null), (ReportReason.Abuse, "Rude."), (ReportReason.Other, null)],
            item.Reports.Select(r => (r.Reason, r.Note)));
        Assert.Equal(1, queue.ReviewsTotal);
        Assert.Empty(queue.Profiles);
    }

    [Fact]
    public async Task GetQueueAsync_SeveralThings_TheOneReportedLongestAgoFirst()
    {
        var alex = await AccountAsync("alex");
        var sam = await AccountAsync("sam");
        var newer = AddReview(alex.Id, "Newer.");
        var older = AddReview(sam.Id, "Older.");
        AddReport("r1", newer, minutesAgo: 5);
        AddReport("r1", older, minutesAgo: 50);
        AddReport("r2", newer, minutesAgo: 60);
        AddReport("r1", profileUserId: alex.Id, minutesAgo: 1);
        AddReport("r1", profileUserId: sam.Id, minutesAgo: 2);

        var queue = await Moderation.GetQueueAsync();

        // By each thing's first report: the newer review was reported an hour ago by somebody else.
        Assert.Equal(["Newer.", "Older."], queue.Reviews.Select(r => r.Body));
        Assert.Equal(["sam", "alex"], queue.Profiles.Select(p => p.UserName));
    }

    [Fact]
    public async Task GetQueueAsync_AReportedProfile_ShowsWhatItsOwnerWroteNow()
    {
        var alex = await AccountAsync("alex", bio: "Now this.");
        AddReport("r1", profileUserId: alex.Id, reason: ReportReason.Impersonation);

        var item = Assert.Single((await Moderation.GetQueueAsync()).Profiles);

        Assert.Equal((alex.Id, "alex", "Shown Name", "https://i.imgur.com/shown.png", "Now this.", true),
            (item.AccountId, item.UserName, item.DisplayName, item.AvatarUrl, item.Bio, item.Published));
        Assert.Equal(ReportReason.Impersonation, Assert.Single(item.Reports).Reason);
    }

    [Fact]
    public async Task GetQueueAsync_WithdrawnSinceItWasReported_SaysItIsNotPublished()
    {
        // The author made the review private, or the owner the profile, after the report: nothing is left
        // for a reader to see, and the admin can dismiss it knowing so.
        var alex = await AccountAsync("alex");
        var nadia = await AccountAsync("nadia", ProfileVisibility.Private);
        AddReport("r1", AddReview(alex.Id, visibility: ReviewVisibility.Private));
        AddReport("r1", AddReview(nadia.Id));
        AddReport("r1", profileUserId: nadia.Id);

        var queue = await Moderation.GetQueueAsync();

        Assert.All(queue.Reviews, item => Assert.False(item.Published));
        Assert.False(Assert.Single(queue.Profiles).Published);
    }

    [Fact]
    public async Task GetQueueAsync_AGameTheCacheHasNothingFor_IsShownByItsIdAlone()
    {
        var alex = await AccountAsync("alex");
        AddReport("r1", AddReview(alex.Id));
        games.GetGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>()).Returns([]);

        var item = Assert.Single((await Moderation.GetQueueAsync()).Reviews);

        Assert.Equal((GameId, null), (item.GameId, item.GameTitle));
    }

    [Fact]
    public async Task GetQueueAsync_HiddenReviews_TheOneHiddenLastFirst()
    {
        var alex = await AccountAsync("alex");
        AddReview(alex.Id, "Earlier.", gameId: 1, hiddenAt: Midday.AddDays(-2));
        AddReview(alex.Id, "Later.", gameId: 2, hiddenAt: Midday.AddDays(-1));
        AddReview(alex.Id, "Shown.", gameId: 3);

        var queue = await Moderation.GetQueueAsync();

        Assert.Equal(["Later.", "Earlier."], queue.Hidden.Select(h => h.Body));
        Assert.Equal(2, queue.HiddenTotal);
    }

    [Fact]
    public async Task GetQueueAsync_MoreThanAPage_ReturnsAPageAndCountsTheRest()
    {
        var alex = await AccountAsync("alex");
        for (var i = 0; i <= ModerationService.PageSize; i++)
            AddReport("r1", AddReview(alex.Id, gameId: 100 + i), minutesAgo: i);

        var queue = await Moderation.GetQueueAsync();

        Assert.Equal(ModerationService.PageSize, queue.Reviews.Count);
        Assert.Equal(ModerationService.PageSize + 1, queue.ReviewsTotal);
    }

    // ---------------------------------------------------------------------------------------
    // Hiding and showing
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task HideReviewAsync_AReportedReview_IsHiddenAndItsReportsAloneAreAnswered()
    {
        var alex = await AccountAsync("alex");
        var reported = AddReview(alex.Id, gameId: 1);
        var other = AddReview(alex.Id, gameId: 2);
        AddReport("r1", reported);
        AddReport("r2", reported);
        AddReport("r1", other);
        AddReport("r1", profileUserId: alex.Id);

        Assert.True(await Moderation.HideReviewAsync(reported));

        Assert.Equal(Midday, Stored(db => db.Reviews.Single(r => r.Id == reported).HiddenAt));
        Assert.Equal(
            [(other, null), (null, alex.Id)],
            Stored(db => db.ContentReports.OrderBy(r => r.Id).Select(r => new { r.ReviewId, r.ProfileUserId }).ToList())
                .Select(r => (r.ReviewId, r.ProfileUserId)));
    }

    [Fact]
    public async Task HideReviewAsync_AlreadyHidden_KeepsTheFirstMomentAndAnswersItsReports()
    {
        var alex = await AccountAsync("alex");
        var reviewId = AddReview(alex.Id, hiddenAt: Midday.AddDays(-1));
        AddReport("r1", reviewId);

        Assert.True(await Moderation.HideReviewAsync(reviewId));

        Assert.Equal(Midday.AddDays(-1), Stored(db => db.Reviews.Single().HiddenAt));
        Assert.Equal(0, Stored(db => db.ContentReports.Count()));
    }

    [Fact]
    public async Task HideReviewAsync_NoSuchReview_IsFalse()
    {
        Assert.False(await Moderation.HideReviewAsync(404));
    }

    [Fact]
    public async Task HideReviewAsync_LeavesItsWordsAndItsAuthorsChoices()
    {
        // An admin withdraws publication and writes nothing of the member's (ADR 0076 §3).
        var alex = await AccountAsync("alex");
        var reviewId = AddReview(alex.Id, "Their words.");
        AddReport("r1", reviewId);

        Assert.True(await Moderation.HideReviewAsync(reviewId));

        var stored = Stored(db => db.Reviews.Single());
        Assert.Equal(("Their words.", ReviewVisibility.Public, Midday), (stored.Body, stored.Visibility, stored.UpdatedAt));
    }

    [Fact]
    public async Task HideReviewAsync_AReviewNobodyReported_IsFalseAndStaysShown()
    {
        // An admin acts from a report, and the endpoint holds that, not only the page (ADR 0076 §3).
        var alex = await AccountAsync("alex");
        var reviewId = AddReview(alex.Id);

        Assert.False(await Moderation.HideReviewAsync(reviewId));

        Assert.Null(Stored(db => db.Reviews.Single().HiddenAt));
    }

    [Fact]
    public async Task HideReviewAsync_AReportThatGoesBeforeTheSave_IsReadAgainAndTheReviewHidden()
    {
        // One reporter deletes their account between the hide's read and its save, which takes their report
        // and rolls the hide's save back: the hide reads again and answers the report still open.
        var alex = await AccountAsync("alex");
        var reviewId = AddReview(alex.Id);
        AddReport("r1", reviewId);
        AddReport("r2", reviewId);
        Meanwhile(db => db.ContentReports.Remove(db.ContentReports.Single(r => r.UserId == "r1")));

        Assert.True(await Moderation.HideReviewAsync(reviewId));

        Assert.NotNull(Stored(db => db.Reviews.Single().HiddenAt));
        Assert.Equal(0, Stored(db => db.ContentReports.Count()));
    }

    [Fact]
    public async Task ShowReviewAsync_AHiddenReview_IsShownAgain()
    {
        var alex = await AccountAsync("alex");
        var reviewId = AddReview(alex.Id, hiddenAt: Midday);

        Assert.True(await Moderation.ShowReviewAsync(reviewId));

        Assert.Null(Stored(db => db.Reviews.Single().HiddenAt));
    }

    [Fact]
    public async Task ShowReviewAsync_AReviewThatIsNotHidden_IsFalse()
    {
        var alex = await AccountAsync("alex");

        Assert.False(await Moderation.ShowReviewAsync(AddReview(alex.Id)));
        Assert.False(await Moderation.ShowReviewAsync(404));
    }

    // ---------------------------------------------------------------------------------------
    // Clearing a profile
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task ClearProfileAsync_TheChosenFields_AreClearedAndTheOthersKept()
    {
        var alex = await AccountAsync("alex");
        AddReport("r1", profileUserId: alex.Id);

        var result = await Moderation.ClearProfileAsync(alex.Id, new ClearProfileDto(DisplayName: false, AvatarUrl: true, Bio: true));

        Assert.Equal(ProfileClear.Cleared, result);
        var stored = Stored(db => db.Users.Single(u => u.Id == alex.Id));
        Assert.Equal(("Shown Name", null, null), (stored.DisplayName, stored.AvatarUrl, stored.Bio));
    }

    [Fact]
    public async Task ClearProfileAsync_AnswersTheProfilesReportsAndNotItsReviews()
    {
        var alex = await AccountAsync("alex");
        var reviewId = AddReview(alex.Id);
        AddReport("r1", profileUserId: alex.Id);
        AddReport("r2", profileUserId: alex.Id);
        AddReport("r1", reviewId);

        await Moderation.ClearProfileAsync(alex.Id, new ClearProfileDto(true, false, false));

        Assert.Equal([reviewId], Stored(db => db.ContentReports.Select(r => r.ReviewId).ToList()));
    }

    [Fact]
    public async Task ClearProfileAsync_SignsNobodyOut()
    {
        // The security stamp is what Identity compares a cookie against; a clear is not a reason to end
        // the owner's session.
        var alex = await AccountAsync("alex");
        AddReport("r1", profileUserId: alex.Id);
        var stamp = alex.SecurityStamp;

        await Moderation.ClearProfileAsync(alex.Id, new ClearProfileDto(true, true, true));

        Assert.Equal(stamp, Stored(db => db.Users.Single(u => u.Id == alex.Id).SecurityStamp));
    }

    [Fact]
    public async Task ClearProfileAsync_AProfileNobodyReported_IsNotFoundAndKeepsItsWords()
    {
        var alex = await AccountAsync("alex");

        Assert.Equal(ProfileClear.NotFound,
            await Moderation.ClearProfileAsync(alex.Id, new ClearProfileDto(true, true, true)));

        Assert.Equal("A bio.", Stored(db => db.Users.Single(u => u.Id == alex.Id).Bio));
    }

    [Fact]
    public async Task ClearProfileAsync_AReportThatGoesMeanwhile_ClearsAndAnswersTheRest()
    {
        // A report gone with its reporter's account is not the owner's save: the clear stands, and the reports
        // still open are answered after it.
        var alex = await AccountAsync("alex");
        AddReport("r1", profileUserId: alex.Id);
        AddReport("r2", profileUserId: alex.Id);
        Meanwhile(db => db.ContentReports.Remove(db.ContentReports.Single(r => r.UserId == "r1")));

        Assert.Equal(ProfileClear.Cleared,
            await Moderation.ClearProfileAsync(alex.Id, new ClearProfileDto(false, false, Bio: true)));

        Assert.Null(Stored(db => db.Users.Single(u => u.Id == alex.Id).Bio));
        Assert.Equal(0, Stored(db => db.ContentReports.Count()));
    }

    [Fact]
    public async Task ClearProfileAsync_TheOwnerSavesBeforeTheClear_IsAConflictAndClearsNothing()
    {
        // Moved, the stamp says the owner saved: the admin sees what they saved before choosing again,
        // rather than having it cleared unseen (ADR 0076 §5).
        var alex = await AccountAsync("alex");
        AddReport("r1", profileUserId: alex.Id);
        Meanwhile(db =>
        {
            var owner = db.Users.Single(u => u.Id == alex.Id);
            owner.Bio = "Rewritten just now.";
            owner.ConcurrencyStamp = Guid.NewGuid().ToString();
        });

        Assert.Equal(ProfileClear.Conflict,
            await Moderation.ClearProfileAsync(alex.Id, new ClearProfileDto(false, false, Bio: true)));

        Assert.Equal("Rewritten just now.", Stored(db => db.Users.Single(u => u.Id == alex.Id).Bio));
        Assert.Equal(1, Stored(db => db.ContentReports.Count()));
    }

    [Fact]
    public async Task ClearProfileAsync_NoSuchAccount_IsNotFound()
    {
        Assert.Equal(ProfileClear.NotFound,
            await Moderation.ClearProfileAsync("nobody", new ClearProfileDto(true, true, true)));
    }

    [Fact]
    public void ClearProfileDto_NothingChosen_IsRefused()
    {
        var results = new ClearProfileDto(false, false, false)
            .Validate(new System.ComponentModel.DataAnnotations.ValidationContext(new object()));

        Assert.Single(results);
    }

    // ---------------------------------------------------------------------------------------
    // Dismissing
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task DismissReviewReportsAsync_AnswersThatReviewsReportsAndChangesNothingElse()
    {
        var alex = await AccountAsync("alex");
        var reviewId = AddReview(alex.Id);
        AddReport("r1", reviewId);
        AddReport("r1", profileUserId: alex.Id);

        await Moderation.DismissReviewReportsAsync(reviewId);

        Assert.Equal([alex.Id], Stored(db => db.ContentReports.Select(r => r.ProfileUserId).ToList()));
        Assert.Null(Stored(db => db.Reviews.Single().HiddenAt));
    }

    [Fact]
    public async Task DismissProfileReportsAsync_AnswersThatProfilesReportsAndChangesNothingElse()
    {
        var alex = await AccountAsync("alex");
        var reviewId = AddReview(alex.Id);
        AddReport("r1", reviewId);
        AddReport("r1", profileUserId: alex.Id);

        await Moderation.DismissProfileReportsAsync(alex.Id);

        Assert.Equal([reviewId], Stored(db => db.ContentReports.Select(r => r.ReviewId).ToList()));
        Assert.Equal("A bio.", Stored(db => db.Users.Single(u => u.Id == alex.Id).Bio));
    }

    [Fact]
    public async Task DismissReviewReportsAsync_AReportThatGoesBeforeTheSave_DeletesTheRest()
    {
        // The save that met the gone report rolled back with the others in it, so the dismissal reads again
        // rather than answering a success it did not have.
        var alex = await AccountAsync("alex");
        var reviewId = AddReview(alex.Id);
        AddReport("r1", reviewId);
        AddReport("r2", reviewId);
        AddReport("r3", reviewId);
        Meanwhile(db => db.ContentReports.Remove(db.ContentReports.Single(r => r.UserId == "r2")));

        await Moderation.DismissReviewReportsAsync(reviewId);

        Assert.Equal(0, Stored(db => db.ContentReports.Count()));
    }

    [Fact]
    public async Task DismissReviewReportsAsync_NothingToDismiss_DoesNotThrow()
    {
        await Moderation.DismissReviewReportsAsync(404);
        await Moderation.DismissProfileReportsAsync("nobody");
    }
}
