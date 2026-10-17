using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// Registering, signing in and out, and the write guard, through the real pipeline and Identity's
/// real store.
/// </summary>
public class AuthFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Register_ANewAccount_IsSignedInPrivateAndNotAnAdmin()
    {
        using var browser = api.CreateBrowser();
        var userName = Browsers.NewUserName("newcomer");

        var registered = await browser.RegisterAsync(userName);
        var me = await browser.GetJsonAsync<UserProfileDto>("/api/auth/me");

        Assert.Equal(registered.Id, me.Id);
        Assert.Equal(userName, me.UserName);
        Assert.Equal($"{userName}@test.local", me.Email);

        // Private by default, new accounts included (ADR 0025), and nobody is an admin until named
        // (ADR 0042) — in this environment exactly as in any other.
        Assert.Equal(ProfileVisibility.Private, me.ProfileVisibility);
        Assert.False(me.IsAdmin);
    }

    [Fact]
    public async Task Logout_ASignedInBrowser_EndsTheSession()
    {
        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("leaver"));

        var logout = await browser.SendAsync(HttpMethod.Post, "/api/auth/logout");
        await logout.ExpectAsync(HttpStatusCode.NoContent);

        var me = await browser.GetAsync("/api/auth/me");
        await me.ExpectAsync(HttpStatusCode.Unauthorized);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Login_ByEmailOrByUserName_SignsAFreshBrowserIn(bool byEmail)
    {
        // By username as well as by email, because PasswordSignInAsync resolves its argument as a
        // username, and that once broke every sign-in by address without failing anything else.
        var userName = Browsers.NewUserName("returner");
        using (var first = api.CreateBrowser()) await first.RegisterAsync(userName);

        using var browser = api.CreateBrowser();
        var login = await browser.PostAsJsonAsync("/api/auth/login",
            new LoginDto(byEmail ? $"{userName}@test.local" : userName, Browsers.Password));
        await login.ExpectAsync(HttpStatusCode.OK);

        var me = await browser.GetJsonAsync<UserProfileDto>("/api/auth/me");
        Assert.Equal(userName, me.UserName);
    }

    [Fact]
    public async Task Login_WithAWrongPassword_AnswersExactlyAsAnUnknownAccountDoes()
    {
        var userName = Browsers.NewUserName("forgetful");
        using (var first = api.CreateBrowser()) await first.RegisterAsync(userName);

        using var browser = api.CreateBrowser();
        var wrongPassword = await browser.PostAsJsonAsync("/api/auth/login",
            new LoginDto(userName, "not-the-password-1"));
        var noSuchAccount = await browser.PostAsJsonAsync("/api/auth/login",
            new LoginDto(Browsers.NewUserName("nobody"), Browsers.Password));

        // One answer for both, so the endpoint cannot be asked whether an account exists (ADR 0033).
        await wrongPassword.ExpectAsync(HttpStatusCode.Unauthorized);
        await noSuchAccount.ExpectAsync(HttpStatusCode.Unauthorized);
        Assert.Equal(
            await noSuchAccount.Content.ReadAsStringAsync(),
            await wrongPassword.Content.ReadAsStringAsync());

        await (await browser.GetAsync("/api/auth/me")).ExpectAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task SetListEntry_WithoutTheRequestHeader_IsRefusedAndChangesNothing()
    {
        // The test browser adds X-MVGL-Request to every write, as apiFetch does. This is the one
        // request that does not, so the rest of the suite cannot be passing because the guard is
        // off (ADR 0033).
        using var browser = api.CreateBrowser();
        var user = await browser.RegisterAsync(Browsers.NewUserName("forged"));

        var forged = new HttpRequestMessage(HttpMethod.Put, "/api/lists/1942")
        {
            Content = JsonContent.Create(new SetListEntryDto(ListStatusKeys.Backlog))
        };
        forged.Options.Set(Requests.WithoutWriteHeader, true);

        var response = await browser.SendAsync(forged);

        await response.ExpectAsync(HttpStatusCode.Forbidden);
        await using var db = api.Database();
        Assert.False(await db.UserGameEntries.AnyAsync(entry => entry.UserId == user.Id));
    }
}
