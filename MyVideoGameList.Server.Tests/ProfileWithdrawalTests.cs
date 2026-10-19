using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Controllers;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Security;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Edge;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Which writes take a profile off the edge, with exactly which paths, only once the write is
/// stored, and never at the cost of the write.
/// </summary>
/// <remarks>
/// <para>
/// Through the code that makes each write — the three account endpoints and the two services that
/// delete or rewrite a review — rather than through <see cref="ProfileWithdrawals"/> alone, because
/// the decision that matters is made at the call site: whether the profile was public before the
/// write, whether the review was, and for the two deletes, that nothing read before the write
/// decides anything. A withdrawals class that names the right paths is no use to a controller that
/// never calls it, or calls it before it saves.
/// </para>
/// <para>
/// What a write stored is read back through a scope of its own, not the one the write ran in: the
/// change tracker of the write's own context hands back the object it changed, saved or not.
/// </para>
/// <para>
/// The edge is a fake that records what it was handed. The CloudFront implementation behind the
/// interface is <see cref="CloudFrontEdgeInvalidatorTests"/>'; the AWS client itself is not under
/// test anywhere.
/// </para>
/// </remarks>
public class ProfileWithdrawalTests
{
    // Identity's default rules, which AddIdentityCore applies here and Program.cs relaxes.
    private const string Password = "Password1!";
    private const int GameId = 42;
    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);

    private const string Sitemaps = "/sitemaps/profiles-*";

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>
    /// One request's worth of the application: Identity over the in-memory store, the services
    /// that write reviews and entries, and <see cref="EdgeInvalidationRegistration"/> as
    /// <c>Program.cs</c> calls it — with the edge it registers replaced by the one under test.
    /// </summary>
    private sealed class Site : IDisposable
    {
        private readonly ServiceProvider root;
        private readonly IServiceScope scope;

        public Site(IEdgeInvalidator edge)
        {
            var store = Guid.NewGuid().ToString();
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddDbContext<ApplicationDbContext>(options => options.UseInMemoryDatabase(store));
            services
                .AddIdentityCore<ApplicationUser>(options =>
                    options.User.AllowedUserNameCharacters = UserNamePolicy.AllowedCharacters)
                .AddEntityFrameworkStores<ApplicationDbContext>();
            services.AddEdgeInvalidation(new ConfigurationBuilder().Build());
            services.AddSingleton(edge);
            services.AddSingleton<TimeProvider>(new FixedClock(Midday));
            services.AddScoped<IUserNameClaimService, UserNameClaimService>();
            services.Configure<AdminOptions>(_ => { });
            services.AddSingleton<AdminAccounts>();
            services.AddScoped(_ => Substitute.For<IGameCacheService>());
            services.AddScoped<ReviewService>();
            services.AddScoped<ListService>();

            root = services.BuildServiceProvider();
            scope = root.CreateScope();
        }

        public T Get<T>() where T : notnull => scope.ServiceProvider.GetRequiredService<T>();

        public UserManager<ApplicationUser> Users => Get<UserManager<ApplicationUser>>();

        /// <summary>The account as it is stored, read through a context of its own.</summary>
        public ApplicationUser? StoredUser(string id) => Stored(db => db.Users.SingleOrDefault(u => u.Id == id));

        public Review? StoredReview() => Stored(db => db.Reviews.SingleOrDefault());

        public int StoredEntries() => Stored(db => db.UserGameEntries.Count());

        private TResult Stored<TResult>(Func<ApplicationDbContext, TResult> read)
        {
            using var fresh = root.CreateScope();
            var db = fresh.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            db.ChangeTracker.QueryTrackingBehavior = QueryTrackingBehavior.NoTracking;
            return read(db);
        }

        public async Task<ApplicationUser> AccountAsync(string userName, string visibility)
        {
            var user = new ApplicationUser
            {
                UserName = userName,
                Email = $"{userName}@test.local",
                ProfileVisibility = visibility,
            };
            var created = await Users.CreateAsync(user, Password);
            Assert.True(created.Succeeded, string.Join(" ", created.Errors.Select(e => e.Description)));
            return user;
        }

        /// <summary>
        /// The controller as a signed-in request reaches it. Sign-in itself is a substitute: the
        /// rename refreshes the cookie and the deletion clears it, and neither is under test here.
        /// </summary>
        public UserController Controller(ApplicationUser user)
        {
            var signIn = Substitute.For<SignInManager<ApplicationUser>>(
                Users,
                Substitute.For<IHttpContextAccessor>(),
                Substitute.For<IUserClaimsPrincipalFactory<ApplicationUser>>(),
                Options.Create(new IdentityOptions()),
                NullLogger<SignInManager<ApplicationUser>>.Instance,
                Substitute.For<IAuthenticationSchemeProvider>(),
                Substitute.For<IUserConfirmation<ApplicationUser>>());

            return new UserController(
                Users,
                signIn,
                Get<ApplicationDbContext>(),
                Substitute.For<IStatsService>(),
                Substitute.For<IUserDataExporter>(),
                Get<IUserNameClaimService>(),
                Substitute.For<ITrackedNewsService>(),
                Substitute.For<IListNameService>(),
                Get<AdminAccounts>(),
                Get<ProfileWithdrawals>(),
                Get<TimeProvider>())
            {
                ControllerContext = new ControllerContext
                {
                    HttpContext = new DefaultHttpContext
                    {
                        User = new ClaimsPrincipal(new ClaimsIdentity(
                            [new Claim(ClaimTypes.NameIdentifier, user.Id)], "Test")),
                    },
                },
            };
        }

        public void Dispose()
        {
            scope.Dispose();
            root.Dispose();
        }
    }

    private static ReviewInputDto Review(string visibility, string body = "Worth every hour.", bool hasSpoilers = false) =>
        new(body, hasSpoilers, visibility, PlaythroughId: null);

    private static void AssertSent(RecordingEdgeInvalidator edge, string reason, params string[] paths)
    {
        var sent = Assert.Single(edge.Sent);
        Assert.Equal(reason, sent.Reason);
        Assert.Equal(paths, sent.Paths);
    }

    // ---------------------------------------------------------------------------------------
    // The profile's own three
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task UpdatePrivacy_PublicToPrivate_InvalidatesTheProfileAndTheSitemaps()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);

        var result = await site.Controller(alice)
            .UpdatePrivacy(new UpdateProfileVisibilityDto(ProfileVisibility.Private));

        Assert.IsType<OkObjectResult>(result.Result);
        AssertSent(edge, "profile made private", "/u/alice*", Sitemaps);
    }

    [Fact]
    public async Task UpdatePrivacy_PublicToPrivate_InvalidatesOnlyOnceTheChangeIsStored()
    {
        // Sent before the save, the invalidation could be answered by a render of the page as it
        // still was, which the edge would then keep for the whole window it was meant to close.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        string? storedWhenSent = null;
        edge.OnInvalidate = _ => storedWhenSent = site.StoredUser(alice.Id)?.ProfileVisibility;

        await site.Controller(alice).UpdatePrivacy(new UpdateProfileVisibilityDto(ProfileVisibility.Private));

        Assert.Equal(ProfileVisibility.Private, storedWhenSent);
    }

    [Theory]
    [InlineData(ProfileVisibility.Private, ProfileVisibility.Private)]
    [InlineData(ProfileVisibility.Private, ProfileVisibility.Public)]
    [InlineData(ProfileVisibility.Public, ProfileVisibility.Public)]
    public async Task UpdatePrivacy_NothingWithdrawn_InvalidatesNothing(string from, string to)
    {
        // Already private, published, or saved unchanged: nothing the edge holds has been taken back.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", from);

        await site.Controller(alice).UpdatePrivacy(new UpdateProfileVisibilityDto(to));

        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task UpdateUserName_PublicProfile_InvalidatesBothNamesAndTheSitemaps()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        string? storedWhenSent = null;
        edge.OnInvalidate = _ => storedWhenSent = site.StoredUser(alice.Id)?.UserName;

        var result = await site.Controller(alice).UpdateUserName(new UpdateUserNameDto("alicia"));

        Assert.IsType<OkObjectResult>(result.Result);
        AssertSent(edge, "profile renamed", "/u/alice*", "/u/alicia*", Sitemaps);
        Assert.Equal("alicia", storedWhenSent);
    }

    [Fact]
    public async Task UpdateUserName_PrivateProfile_InvalidatesNothing()
    {
        // Neither name serves this profile to anybody, so the edge holds nothing of it.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Private);

        await site.Controller(alice).UpdateUserName(new UpdateUserNameDto("alicia"));

        Assert.Equal("alicia", site.StoredUser(alice.Id)?.UserName);
        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task UpdateUserName_ChangeOfCaseOnPublicProfile_InvalidatesBothSpellingsAndTheSitemaps()
    {
        // Paths are case-sensitive and every later withdrawal names the new spelling, so the copies
        // under the old one — the spelling the site linked to until now — must go with this change.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        string? storedWhenSent = null;
        edge.OnInvalidate = _ => storedWhenSent = site.StoredUser(alice.Id)?.UserName;

        await site.Controller(alice).UpdateUserName(new UpdateUserNameDto("Alice"));

        AssertSent(edge, "profile renamed", "/u/alice*", "/u/Alice*", Sitemaps);
        Assert.Equal("Alice", storedWhenSent);
    }

    [Fact]
    public async Task UpdateUserName_ChangeOfCaseOnPrivateProfile_InvalidatesNothing()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Private);

        await site.Controller(alice).UpdateUserName(new UpdateUserNameDto("Alice"));

        Assert.Equal("Alice", site.StoredUser(alice.Id)?.UserName);
        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task UpdateUserName_NameTaken_InvalidatesNothing()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        await site.AccountAsync("bob", ProfileVisibility.Public);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);

        var result = await site.Controller(alice).UpdateUserName(new UpdateUserNameDto("bob"));

        Assert.IsNotType<OkObjectResult>(result.Result);
        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task DeleteAccount_PublicProfile_InvalidatesTheProfileAndTheSitemapsOnceItIsGone()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var goneWhenSent = false;
        edge.OnInvalidate = _ => goneWhenSent = site.StoredUser(alice.Id) is null;

        var result = await site.Controller(alice).DeleteAccount(new DeleteAccountDto(Password));

        Assert.IsType<NoContentResult>(result);
        AssertSent(edge, "account deleted", "/u/alice*", Sitemaps);
        Assert.True(goneWhenSent);
    }

    [Fact]
    public async Task DeleteAccount_PrivateProfile_InvalidatesNothing()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Private);

        await site.Controller(alice).DeleteAccount(new DeleteAccountDto(Password));

        Assert.Null(site.StoredUser(alice.Id));
        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task DeleteAccount_WrongPassword_InvalidatesNothing()
    {
        // Nothing was deleted, so nothing is withdrawn.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);

        var result = await site.Controller(alice).DeleteAccount(new DeleteAccountDto("not-the-password"));

        Assert.IsType<UnauthorizedObjectResult>(result);
        Assert.Empty(edge.Sent);
    }

    // ---------------------------------------------------------------------------------------
    // A review on a public profile
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task UpsertAsync_PublicReviewMadePrivate_InvalidatesTheProfileOnlyOnceStored()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));
        string? storedWhenSent = null;
        edge.OnInvalidate = _ => storedWhenSent = site.StoredReview()?.Visibility;

        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Private));

        // No sitemap: a review changes nobody's place in it.
        AssertSent(edge, "review made private", "/u/alice*");
        Assert.Equal(ReviewVisibility.Private, storedWhenSent);
    }

    [Fact]
    public async Task UpsertAsync_PublicReviewEdited_InvalidatesTheProfileOnlyOnceStored()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public, "First thoughts."));
        string? storedWhenSent = null;
        edge.OnInvalidate = _ => storedWhenSent = site.StoredReview()?.Body;

        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public, "Second thoughts."));

        AssertSent(edge, "review edited", "/u/alice*");
        Assert.Equal("Second thoughts.", storedWhenSent);
    }

    [Fact]
    public async Task UpsertAsync_SpoilerWarningAddedToAPublicReview_InvalidatesTheProfile()
    {
        // The edge still shows the words openly that their author now wants behind the warning.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));

        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public, hasSpoilers: true));

        AssertSent(edge, "review edited", "/u/alice*");
    }

    [Fact]
    public async Task UpsertAsync_PublicReviewSavedAgainUnchanged_InvalidatesNothing()
    {
        // Nothing taken back. Its move to the top of the list is content, and a save button pressed
        // in a loop must not be a way to spend money.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));

        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));

        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task UpsertAsync_FirstReview_InvalidatesNothing()
    {
        // Publishing is not withdrawing: a new review reaches the page when the TTL runs out.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);

        await site.Get<ReviewService>().UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));

        Assert.Empty(edge.Sent);
    }

    [Theory]
    [InlineData(ReviewVisibility.Private)]
    [InlineData(ReviewVisibility.Public)]
    public async Task UpsertAsync_PrivateReviewRewritten_InvalidatesNothing(string rewrittenAs)
    {
        // A private review was on no page, whether it stays private or is published now.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Private, "First thoughts."));

        await reviews.UpsertAsync(alice.Id, GameId, Review(rewrittenAs, "Second thoughts."));

        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task UpsertAsync_PublicReviewOnAPrivateProfile_InvalidatesNothing()
    {
        // The narrower gate wins (ADR 0027 §6): this review was visible to nobody.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Private);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));

        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Private));

        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task DeleteAsync_PublicReview_InvalidatesTheProfileOnlyOnceItIsGone()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));
        var goneWhenSent = false;
        edge.OnInvalidate = _ => goneWhenSent = site.StoredReview() is null;

        Assert.True(await reviews.DeleteAsync(alice.Id, GameId));

        AssertSent(edge, "review deleted", "/u/alice*");
        Assert.True(goneWhenSent);
    }

    [Fact]
    public async Task DeleteAsync_RequestCancelledAfterTheCommit_StillInvalidates()
    {
        // The reader closing the tab once the delete is stored must not cancel the invalidation of
        // what the database has already withdrawn: the lookup after the commit takes no token.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));
        using var request = new CancellationTokenSource();
        site.Get<ApplicationDbContext>().SavedChanges += (_, _) => request.Cancel();

        Assert.True(await reviews.DeleteAsync(alice.Id, GameId, request.Token));

        AssertSent(edge, "review deleted", "/u/alice*");
    }

    [Fact]
    public async Task DeleteAsync_PrivateReview_InvalidatesTheProfileAnyway()
    {
        // Private as the delete read it is not private as the delete took it: another of the
        // author's requests can publish it in between, and a render can put it at the edge. So the
        // delete asks nothing of it, at the price of a path where there was nothing to withdraw.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Private));

        Assert.True(await reviews.DeleteAsync(alice.Id, GameId));

        AssertSent(edge, "review deleted", "/u/alice*");
    }

    [Fact]
    public async Task DeleteAsync_ReviewOnAPrivateProfile_InvalidatesNothing()
    {
        // The one question left, asked after the commit: a private profile serves nothing to
        // withdraw, and a profile made private in between sent its own invalidation.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Private);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));

        Assert.True(await reviews.DeleteAsync(alice.Id, GameId));

        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task DeleteEntryAsync_TakingAPublicReviewWithIt_InvalidatesTheProfileOnlyOnceItIsGone()
    {
        // Deleting everything recorded about a game deletes its review through the cascade.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        await site.Get<ReviewService>().UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));
        var goneWhenSent = false;
        edge.OnInvalidate = _ => goneWhenSent = site.StoredEntries() == 0;

        Assert.True(await site.Get<ListService>().DeleteEntryAsync(alice.Id, GameId));

        AssertSent(edge, "entry deleted", "/u/alice*");
        Assert.True(goneWhenSent);
    }

    [Theory]
    [InlineData(ReviewVisibility.Private)]
    [InlineData(null)]
    public async Task DeleteEntryAsync_WithAPrivateReviewOrNone_InvalidatesTheProfileAnyway(string? review)
    {
        // The rule this pins: whatever the entry held. Between any question asked before the delete
        // and the cascade that settles it, the user's own request can publish the review, or write
        // one where there was none. So "it had a public review" and "it had a review at all" are
        // overtaken the same way. Nothing is asked, and a game with no review costs a path.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        await site.Get<ListService>().SetScoreAsync(alice.Id, GameId, 8);
        if (review is not null) await site.Get<ReviewService>().UpsertAsync(alice.Id, GameId, Review(review));

        Assert.True(await site.Get<ListService>().DeleteEntryAsync(alice.Id, GameId));

        AssertSent(edge, "entry deleted", "/u/alice*");
    }

    [Fact]
    public async Task DeleteEntryAsync_OnAPrivateProfile_InvalidatesNothing()
    {
        // As for a review, the profile is asked about after the commit, and a private one serves
        // nothing to withdraw.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Private);
        await site.Get<ReviewService>().UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));

        Assert.True(await site.Get<ListService>().DeleteEntryAsync(alice.Id, GameId));

        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task DeleteEntryAsync_AnotherAccountsReviewOfTheGame_InvalidatesOnlyTheDeletersProfile()
    {
        // Scoped to the account deleting, like the delete itself.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var bob = await site.AccountAsync("bob", ProfileVisibility.Public);
        await site.Get<ListService>().SetScoreAsync(alice.Id, GameId, 8);
        await site.Get<ReviewService>().UpsertAsync(bob.Id, GameId, Review(ReviewVisibility.Public));

        Assert.True(await site.Get<ListService>().DeleteEntryAsync(alice.Id, GameId));

        AssertSent(edge, "entry deleted", "/u/alice*");
    }

    // ---------------------------------------------------------------------------------------
    // The write stands when the edge fails
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task UpdatePrivacy_EdgeThrows_TheProfileIsPrivateAndTheAnswerIsOk()
    {
        var edge = new ThrowingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);

        var result = await site.Controller(alice)
            .UpdatePrivacy(new UpdateProfileVisibilityDto(ProfileVisibility.Private));

        Assert.Equal(1, edge.Calls);
        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(ProfileVisibility.Private, site.StoredUser(alice.Id)?.ProfileVisibility);
    }

    [Fact]
    public async Task UpdateUserName_EdgeThrows_TheRenameStands()
    {
        var edge = new ThrowingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);

        var result = await site.Controller(alice).UpdateUserName(new UpdateUserNameDto("alicia"));

        Assert.Equal(1, edge.Calls);
        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("alicia", site.StoredUser(alice.Id)?.UserName);
    }

    [Fact]
    public async Task DeleteAccount_EdgeThrows_TheAccountIsGone()
    {
        var edge = new ThrowingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);

        var result = await site.Controller(alice).DeleteAccount(new DeleteAccountDto(Password));

        Assert.Equal(1, edge.Calls);
        Assert.IsType<NoContentResult>(result);
        Assert.Null(site.StoredUser(alice.Id));
    }

    [Theory]
    [InlineData(ReviewVisibility.Private)]
    [InlineData(ReviewVisibility.Public)]
    public async Task UpsertAsync_EdgeThrows_TheRewriteStands(string rewrittenAs)
    {
        // Made private, or edited and left public.
        var edge = new ThrowingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public, "First thoughts."));

        var saved = await reviews.UpsertAsync(alice.Id, GameId, Review(rewrittenAs, "Second thoughts."));

        Assert.Equal(1, edge.Calls);
        Assert.Equal("Second thoughts.", saved.Body);
        var stored = site.StoredReview();
        Assert.Equal(("Second thoughts.", rewrittenAs), (stored?.Body, stored?.Visibility));
    }

    [Fact]
    public async Task DeleteAsync_EdgeThrows_TheReviewIsGone()
    {
        var edge = new ThrowingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));

        Assert.True(await reviews.DeleteAsync(alice.Id, GameId));

        Assert.Equal(1, edge.Calls);
        Assert.Null(site.StoredReview());
    }

    [Fact]
    public async Task DeleteEntryAsync_EdgeThrows_TheEntryIsGone()
    {
        var edge = new ThrowingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        await site.Get<ReviewService>().UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));

        Assert.True(await site.Get<ListService>().DeleteEntryAsync(alice.Id, GameId));

        Assert.Equal(1, edge.Calls);
        Assert.Equal(0, site.StoredEntries());
    }

    [Fact]
    public void ProfileMadePrivate_EdgeThrows_LogsThePathsAsAnError()
    {
        // The paths are in the log for whoever has to send them by hand.
        var logger = new ListLogger<ProfileWithdrawals>();
        using var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var withdrawals = new ProfileWithdrawals(db, new ThrowingEdgeInvalidator(), logger);

        withdrawals.ProfileMadePrivate("alice");

        var error = Assert.Single(logger.At(LogLevel.Error));
        Assert.Contains("/u/alice*, /sitemaps/profiles-*", error.Message);
    }

    [Fact]
    public async Task ReviewWithdrawnAsync_LookupThrows_DoesNotThrow()
    {
        // After the commit, even the database failing must not reach the write's answer.
        var logger = new ListLogger<ProfileWithdrawals>();
        var edge = new RecordingEdgeInvalidator();
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        await db.DisposeAsync();
        var withdrawals = new ProfileWithdrawals(db, edge, logger);

        await withdrawals.ReviewWithdrawnAsync("user-1", ReviewWithdrawal.Deleted);

        Assert.Empty(edge.Sent);
        Assert.Single(logger.At(LogLevel.Error));
    }

    // ---------------------------------------------------------------------------------------
    // The shape of a path
    // ---------------------------------------------------------------------------------------

    [Fact]
    public void Profile_AnyName_EndsInOneWildcardCoveringItsDataUrlAndQueryStrings()
    {
        // React Router 8 asks for /u/alice.data, and the cache key holds ?page= and ?_routes=;
        // CloudFront reads a `*` as a wildcard only when it is the last character.
        Assert.Equal("/u/alice*", ProfileWithdrawals.Profile("alice"));
    }

    [Fact]
    public void PathsForLog_PathWithALineBreak_IsOneLine()
    {
        // A path carries a username from a request; whatever the alphabet allows today, the log
        // does not take its word for it.
        var invalidation = new EdgeInvalidation("profile renamed", ["/u/alice\r\nINFO: all clear*", "/sitemaps/profiles-*"]);

        Assert.Equal("/u/aliceINFO: all clear*, /sitemaps/profiles-*", invalidation.PathsForLog);
    }

    [Fact]
    public void ProfileSitemaps_EveryFile_IsOnePathEndingInTheWildcard()
    {
        // `/sitemaps/profiles-*.xml` would be matched literally, asterisk and all, and invalidate
        // nothing.
        Assert.Equal("/sitemaps/profiles-*", ProfileWithdrawals.ProfileSitemaps);
    }
}
