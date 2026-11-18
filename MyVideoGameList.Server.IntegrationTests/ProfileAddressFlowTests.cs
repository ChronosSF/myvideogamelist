using System.Net;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// A profile is addressed by its public id over the real database and the real pipeline: the
/// column's default, the lookup, the 404 that says nothing, and a rename that moves nothing (ADR 0096).
/// </summary>
public class ProfileAddressFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    /// <summary>A public profile, signed in.</summary>
    private async Task<(HttpClient Browser, UserProfileDto Account)> PublicAsync(string prefix)
    {
        var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName(prefix));
        await (await browser.SendAsync(HttpMethod.Put, "/api/user/privacy",
            new UpdateProfileVisibilityDto(ProfileVisibility.Public))).ExpectAsync(HttpStatusCode.OK);
        return (browser, account);
    }

    /// <summary>A 404's body without its trace id, which names the request and nothing about the profile.</summary>
    private static async Task<string> NotFoundBodyAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        Assert.NotNull(body["traceId"]);
        body.Remove("traceId");
        return body.ToJsonString();
    }

    [Fact]
    public async Task Register_TheAccount_HasAWellFormedPublicIdItsProfileAnswersTo()
    {
        var (browser, account) = await PublicAsync("addressed");
        using var _ = browser;

        Assert.True(PublicIdPolicy.IsWellFormed(account.PublicId));
        using var stranger = api.CreateBrowser();
        var profile = await stranger.GetJsonAsync<PublicProfileDto>($"/api/users/{account.PublicId}");
        Assert.Equal((account.PublicId, account.UserName), (profile.PublicId, profile.UserName));
    }

    [Fact]
    public async Task AnAccountInsertedWithoutAPublicId_GetsOneFromTheDatabase()
    {
        // The revision still serving while a release migrates knows nothing of the column, and inserts
        // an account without it. The default gives that account an id rather than refusing the sign-up.
        var id = Guid.NewGuid().ToString();
        await using var db = api.Database();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "AspNetUsers" ("Id", "UserName", "NormalizedUserName", "ListView", "EmailConfirmed",
                "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
            VALUES ({id}, {"old_revision"}, {"OLD_REVISION"}, {ListViewModes.Tiles}, TRUE, FALSE, FALSE, TRUE, 0)
            """);

        var stored = await db.Users.AsNoTracking().SingleAsync(u => u.Id == id);

        Assert.True(PublicIdPolicy.IsWellFormed(stored.PublicId), stored.PublicId);
    }

    [Fact]
    public async Task GetProfile_PrivateOrHeldByNobody_IsTheSameAnswer()
    {
        // ADR 0027 §7: a 403 for one and a 404 for the other would say whether the id has an account.
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("private"));
        using var stranger = api.CreateBrowser();

        var nobody = "zzzzzzzzzzzz";
        Assert.NotEqual(nobody, account.PublicId);

        foreach (var path in new[] { "", "/reviews", "/favourites" })
        {
            Assert.Equal(
                await NotFoundBodyAsync(await stranger.GetAsync($"/api/users/{nobody}{path}")),
                await NotFoundBodyAsync(await stranger.GetAsync($"/api/users/{account.PublicId}{path}")));
        }
    }

    [Fact]
    public async Task GetProfile_ByTheUserName_IsNotFound()
    {
        // Only the id is looked up: a name can change hands, so an address built on one could come to
        // mean somebody else.
        var (browser, account) = await PublicAsync("named");
        using var _ = browser;
        using var stranger = api.CreateBrowser();

        await NotFoundBodyAsync(await stranger.GetAsync($"/api/users/{account.UserName}"));
    }

    [Fact]
    public async Task GetProfile_AUserNameThatIsSomebodysId_FindsTheIdsOwner()
    {
        var (owner, held) = await PublicAsync("holder");
        using var _ = owner;

        // A username the same string as somebody else's id: the alphabets overlap, and no name is looked up.
        using var browser = api.CreateBrowser();
        var namesake = await browser.RegisterAsync(held.PublicId);
        await (await browser.SendAsync(HttpMethod.Put, "/api/user/privacy",
            new UpdateProfileVisibilityDto(ProfileVisibility.Public))).ExpectAsync(HttpStatusCode.OK);

        using var stranger = api.CreateBrowser();
        var byHeldId = await stranger.GetJsonAsync<PublicProfileDto>($"/api/users/{held.PublicId}");
        var byNamesakesId = await stranger.GetJsonAsync<PublicProfileDto>($"/api/users/{namesake.PublicId}");

        Assert.Equal(held.UserName, byHeldId.UserName);
        Assert.Equal(held.PublicId, byNamesakesId.UserName);
    }

    [Fact]
    public async Task Rename_KeepsTheAddressAndTakesTheProfileOffTheEdgeAsOnePath()
    {
        var (browser, account) = await PublicAsync("renamer");
        using var _ = browser;
        var sent = api.Edge.Sent.Count;
        var renamed = Browsers.NewUserName("renamed");

        var answer = await (await browser.SendAsync(HttpMethod.Put, "/api/user/username",
            new UpdateUserNameDto(renamed))).ReadAsync<UserProfileDto>(HttpStatusCode.OK);

        Assert.Equal(account.PublicId, answer.PublicId);
        using var stranger = api.CreateBrowser();
        var profile = await stranger.GetJsonAsync<PublicProfileDto>($"/api/users/{account.PublicId}");
        Assert.Equal((account.PublicId, renamed), (profile.PublicId, profile.UserName));

        var invalidation = Assert.Single(api.Edge.SentSince(sent));
        Assert.Equal("profile renamed", invalidation.Reason);
        Assert.Equal([$"/u/{account.PublicId}*", "/sitemaps/profiles-*"], invalidation.Paths);
    }

    [Fact]
    public async Task Me_CarriesThePublicId_SoTheNavbarCanLinkToTheReadersOwnProfile()
    {
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("me"));

        var me = await browser.GetJsonAsync<UserProfileDto>("/api/auth/me");

        Assert.Equal(account.PublicId, me.PublicId);
        Assert.True(PublicIdPolicy.IsWellFormed(me.PublicId));
    }
}
