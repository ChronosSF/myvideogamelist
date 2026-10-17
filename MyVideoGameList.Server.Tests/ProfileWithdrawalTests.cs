using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
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
/// Which writes take a profile off the edge, with exactly which paths, and that a failing edge never
/// fails the write.
/// </summary>
/// <remarks>
/// <para>
/// Through the code that makes each write — the three account endpoints and the two services that
/// delete or rewrite a review — rather than through <see cref="ProfileWithdrawals"/> alone, because
/// the decision that matters is made at the call site: whether the profile was public before the
/// write, whether the review was. A withdrawals class that names the right paths is no use to a
/// controller that never calls it.
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

    private static ReviewInputDto Review(string visibility, string body = "Worth every hour.") =>
        new(body, HasSpoilers: false, visibility, PlaythroughId: null);

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

        var result = await site.Controller(alice).UpdateUserName(new UpdateUserNameDto("alicia"));

        Assert.IsType<OkObjectResult>(result.Result);
        AssertSent(edge, "profile renamed", "/u/alice*", "/u/alicia*", Sitemaps);
    }

    [Fact]
    public async Task UpdateUserName_PrivateProfile_InvalidatesNothing()
    {
        // Neither name serves this profile to anybody, so the edge holds nothing of it.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Private);

        await site.Controller(alice).UpdateUserName(new UpdateUserNameDto("alicia"));

        Assert.Equal("alicia", (await site.Users.FindByIdAsync(alice.Id))!.UserName);
        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task UpdateUserName_ChangeOfCaseOnly_InvalidatesNothing()
    {
        // `/u/alice` and `/u/Alice` were one page before and are one page after: nothing released,
        // nothing withdrawn.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);

        await site.Controller(alice).UpdateUserName(new UpdateUserNameDto("Alice"));

        Assert.Equal("Alice", (await site.Users.FindByIdAsync(alice.Id))!.UserName);
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
    public async Task DeleteAccount_PublicProfile_InvalidatesTheProfileAndTheSitemaps()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);

        var result = await site.Controller(alice).DeleteAccount(new DeleteAccountDto(Password));

        Assert.IsType<NoContentResult>(result);
        AssertSent(edge, "account deleted", "/u/alice*", Sitemaps);
    }

    [Fact]
    public async Task DeleteAccount_PrivateProfile_InvalidatesNothing()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Private);

        await site.Controller(alice).DeleteAccount(new DeleteAccountDto(Password));

        Assert.Null(await site.Users.FindByIdAsync(alice.Id));
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
    public async Task UpsertAsync_PublicReviewMadePrivate_InvalidatesTheProfileOnly()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));

        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Private));

        // No sitemap: a review changes nobody's place in it.
        AssertSent(edge, "review made private", "/u/alice*");
    }

    [Fact]
    public async Task UpsertAsync_PublicReviewEdited_InvalidatesTheProfileOnly()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public, "First thoughts."));

        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public, "Second thoughts."));

        AssertSent(edge, "review edited", "/u/alice*");
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
    public async Task DeleteAsync_PublicReview_InvalidatesTheProfileOnly()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));

        Assert.True(await reviews.DeleteAsync(alice.Id, GameId));

        AssertSent(edge, "review deleted", "/u/alice*");
    }

    [Fact]
    public async Task DeleteAsync_PrivateReview_InvalidatesNothing()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var reviews = site.Get<ReviewService>();
        await reviews.UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Private));

        await reviews.DeleteAsync(alice.Id, GameId);

        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task DeleteEntryAsync_TakingAPublicReviewWithIt_InvalidatesTheProfileOnly()
    {
        // Deleting everything recorded about a game deletes its review through the cascade, which
        // is the same withdrawal as deleting the review by itself.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        await site.Get<ReviewService>().UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Public));

        Assert.True(await site.Get<ListService>().DeleteEntryAsync(alice.Id, GameId));

        AssertSent(edge, "review deleted", "/u/alice*");
    }

    [Fact]
    public async Task DeleteEntryAsync_WithAPrivateReview_InvalidatesNothing()
    {
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        await site.Get<ReviewService>().UpsertAsync(alice.Id, GameId, Review(ReviewVisibility.Private));

        await site.Get<ListService>().DeleteEntryAsync(alice.Id, GameId);

        Assert.Empty(edge.Sent);
    }

    [Fact]
    public async Task DeleteEntryAsync_AnotherAccountsPublicReview_InvalidatesNothing()
    {
        // The question asked before the delete is scoped to the account deleting, like the delete.
        var edge = new RecordingEdgeInvalidator();
        using var site = new Site(edge);
        var alice = await site.AccountAsync("alice", ProfileVisibility.Public);
        var bob = await site.AccountAsync("bob", ProfileVisibility.Public);
        await site.Get<ListService>().SetScoreAsync(alice.Id, GameId, 8);
        await site.Get<ReviewService>().UpsertAsync(bob.Id, GameId, Review(ReviewVisibility.Public));

        await site.Get<ListService>().DeleteEntryAsync(alice.Id, GameId);

        Assert.Empty(edge.Sent);
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
        Assert.Equal(ProfileVisibility.Private, (await site.Users.FindByIdAsync(alice.Id))!.ProfileVisibility);
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
        Assert.Equal("alicia", (await site.Users.FindByIdAsync(alice.Id))!.UserName);
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
        Assert.Null(await site.Users.FindByIdAsync(alice.Id));
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
        var stored = await site.Get<ApplicationDbContext>().Reviews.AsNoTracking().SingleAsync();
        Assert.Equal(("Second thoughts.", rewrittenAs), (stored.Body, stored.Visibility));
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
        Assert.Empty(site.Get<ApplicationDbContext>().Reviews);
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
        Assert.Empty(site.Get<ApplicationDbContext>().UserGameEntries);
    }

    // ---------------------------------------------------------------------------------------
    // The shape of a path
    // ---------------------------------------------------------------------------------------

    [Fact]
    public void Profile_CoversTheDataUrlAndEveryQueryStringWithOneTrailingWildcard()
    {
        // React Router 8 asks for /u/alice.data, and the cache key holds ?page= and ?_routes=;
        // CloudFront reads a `*` as a wildcard only when it is the last character.
        Assert.Equal("/u/alice*", ProfileWithdrawals.Profile("alice"));
    }

    [Fact]
    public void ProfileSitemaps_EndsInTheWildcard()
    {
        // `/sitemaps/profiles-*.xml` would be matched literally, asterisk and all, and invalidate
        // nothing.
        Assert.Equal("/sitemaps/profiles-*", ProfileWithdrawals.ProfileSitemaps);
    }
}
