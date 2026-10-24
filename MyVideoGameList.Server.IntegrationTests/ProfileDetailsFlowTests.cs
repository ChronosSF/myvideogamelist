using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// A display name, an avatar and a bio, from the settings page's save to the public page, the export
/// and the edge, through the real pipeline and PostgreSQL's own columns and check constraint (ADR
/// 0056).
/// </summary>
/// <remarks>
/// What only this suite can show: the attributes on a record's constructor parameters run as MVC
/// binds a real body, the refusal arrives in the shape a client reads, and the database's
/// <c>ILIKE</c> constraint and column lengths take what the policies let through — an address in
/// capitals included, which a <c>LIKE</c> would have refused as a 500.
/// </remarks>
public class ProfileDetailsFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    private static readonly UpdateProfileDetailsDto Typed = new(
        "  Alex   Smith ",
        "HTTPS://I.IMGUR.COM/removed.png",
        "Mostly RPGs.\r\n\r\n\r\n\r\n  Slowly.  ");

    [Fact]
    public async Task UpdateProfileDetails_AsTyped_IsStoredAsThePublicPageAndTheExportShowIt()
    {
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("describer"));

        var saved = await (await browser.SendAsync(HttpMethod.Put, "/api/user/profile", Typed))
            .ReadAsync<UserProfileDto>(HttpStatusCode.OK);
        await (await browser.SendAsync(HttpMethod.Put, "/api/user/privacy",
            new UpdateProfileVisibilityDto(ProfileVisibility.Public))).ExpectAsync(HttpStatusCode.OK);

        // Folded, as given, and with one blank line where four were typed.
        Assert.Equal("Alex Smith", saved.DisplayName);
        Assert.Equal("HTTPS://I.IMGUR.COM/removed.png", saved.AvatarUrl);
        Assert.Equal("Mostly RPGs.\n\n  Slowly.", saved.Bio);

        var me = await browser.GetJsonAsync<UserProfileDto>("/api/auth/me");
        Assert.Equal((saved.DisplayName, saved.AvatarUrl, saved.Bio), (me.DisplayName, me.AvatarUrl, me.Bio));

        using var stranger = api.CreateBrowser();
        var page = await stranger.GetJsonAsync<PublicProfileDto>($"/api/users/{account.UserName}");
        Assert.Equal((saved.DisplayName, saved.AvatarUrl, saved.Bio), (page.DisplayName, page.AvatarUrl, page.Bio));

        var export = await browser.GetJsonAsync<UserDataExportDto>("/api/user/export");
        Assert.Equal(
            (saved.DisplayName, saved.AvatarUrl, saved.Bio),
            (export.Account.DisplayName, export.Account.AvatarUrl, export.Account.Bio));

        await using var db = api.Database();
        var stored = await db.Users.AsNoTracking().SingleAsync(u => u.Id == account.Id);
        Assert.Equal((saved.DisplayName, saved.AvatarUrl, saved.Bio), (stored.DisplayName, stored.AvatarUrl, stored.Bio));
    }

    [Fact]
    public async Task UpdateProfileDetails_Refused_AnswersAValidationProblemKeyedByEachField()
    {
        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("refused"));

        var response = await browser.SendAsync(HttpMethod.Put, "/api/user/profile",
            new UpdateProfileDetailsDto("Bob @ChronosSF", "https://example.com/me.png", new string('a', 501)));

        var problem = await response.ReadAsync<ValidationProblemDetails>(HttpStatusCode.BadRequest);
        Assert.Equal(["AvatarUrl", "Bio", "DisplayName"], problem.Errors.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(DisplayNamePolicy.Problem("Bob @ChronosSF"), Assert.Single(problem.Errors["DisplayName"]));
        Assert.Equal(AvatarUrlPolicy.Problem("https://example.com/me.png"), Assert.Single(problem.Errors["AvatarUrl"]));
        Assert.Equal(BioPolicy.Problem(new string('a', 501)), Assert.Single(problem.Errors["Bio"]));
        // Written through the problem details service, as every error is (ADR 0034).
        Assert.IsType<JsonElement>(problem.Extensions["traceId"]);
    }

    [Fact]
    public async Task UpdateProfileDetails_OnAPrivateProfile_PublishesNothing()
    {
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("private"));
        await (await browser.SendAsync(HttpMethod.Put, "/api/user/profile", Typed)).ExpectAsync(HttpStatusCode.OK);

        using var stranger = api.CreateBrowser();
        var page = await stranger.GetAsync($"/api/users/{account.UserName}");

        // The same 404 as a name nobody has claimed (ADR 0027 §7), with nothing of the three in it.
        await page.ExpectAsync(HttpStatusCode.NotFound);
        var body = await page.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Alex Smith", body);
        Assert.DoesNotContain("Mostly RPGs", body);
    }

    [Fact]
    public async Task UpdateProfileDetails_RewrittenOnAPublicProfile_TakesThePageOffTheEdge()
    {
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("rewriter"));
        await (await browser.SendAsync(HttpMethod.Put, "/api/user/privacy",
            new UpdateProfileVisibilityDto(ProfileVisibility.Public))).ExpectAsync(HttpStatusCode.OK);

        // Set for the first time: that publishes, and waits out the window like any new content.
        var beforeFirst = api.Edge.Sent.Count;
        await (await browser.SendAsync(HttpMethod.Put, "/api/user/profile", Typed)).ExpectAsync(HttpStatusCode.OK);
        Assert.Empty(api.Edge.SentSince(beforeFirst));

        // The bio taken back: the page leaves the edge now (ADR 0058), and the sitemap, which lists
        // only names, stays.
        var beforeRewrite = api.Edge.Sent.Count;
        await (await browser.SendAsync(HttpMethod.Put, "/api/user/profile", Typed with { Bio = null }))
            .ExpectAsync(HttpStatusCode.OK);

        var invalidation = Assert.Single(api.Edge.SentSince(beforeRewrite));
        Assert.Equal("profile details changed", invalidation.Reason);
        Assert.Equal([$"/u/{account.UserName}*"], invalidation.Paths);
    }
}
