using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Security;

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
        await me.ExpectAsync(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task Me_WithNoSession_AnswersNobodyRatherThanRefusing()
    {
        // A 401 here was a console error on every page a visitor opened (#316). Nobody is a 204,
        // with nothing in it, and kept nowhere, as the answer naming an account is.
        using var browser = api.CreateBrowser();

        var me = await browser.GetAsync("/api/auth/me");

        await me.ExpectAsync(HttpStatusCode.NoContent);
        Assert.Empty(await me.Content.ReadAsByteArrayAsync());
        Assert.True(me.Headers.CacheControl?.NoStore, "The answer for nobody says no-store too.");
    }

    [Fact]
    public async Task Logout_ASignedOutBrowser_IsStillRefused()
    {
        // Only "who is signed in" stopped refusing a visitor; what needs a session still does.
        using var browser = api.CreateBrowser();

        var logout = await browser.SendAsync(HttpMethod.Post, "/api/auth/logout");

        await logout.ExpectAsync(HttpStatusCode.Unauthorized);
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

        await (await browser.GetAsync("/api/auth/me")).ExpectAsync(HttpStatusCode.NoContent);
    }

    [Theory]
    [InlineData("GET", "/api/user/stats", HttpStatusCode.Unauthorized)]
    [InlineData("GET", "/api/user/export", HttpStatusCode.Unauthorized)]
    [InlineData("PUT", "/api/lists/1942", HttpStatusCode.Unauthorized)]
    [InlineData("GET", "/api/auth/me", HttpStatusCode.NoContent)]
    public async Task DeleteAccount_FromOneBrowser_EndsTheSessionInEveryOther(
        string method, string path, HttpStatusCode expected)
    {
        // Issue 295. The deletion signs out the browser it was made in and nothing else, and Identity
        // asks whether a cookie's account is still there only every thirty minutes. Until then these
        // read only the cookie's claim: the statistics answered 200 with every figure zero, the export
        // threw, and a write ran into the foreign key to the account that had gone (ADR 0077).
        var userName = Browsers.NewUserName("everywhere");
        using var deleting = api.CreateBrowser();
        using var elsewhere = api.CreateBrowser();
        await deleting.RegisterAsync(userName);

        var login = await elsewhere.PostAsJsonAsync("/api/auth/login", new LoginDto(userName, Browsers.Password));
        await login.ExpectAsync(HttpStatusCode.OK);
        await (await elsewhere.GetAsync("/api/user/stats")).ExpectAsync(HttpStatusCode.OK);

        var delete = await deleting.SendAsync(
            HttpMethod.Delete, "/api/user", new DeleteAccountDto(Browsers.Password));
        await delete.ExpectAsync(HttpStatusCode.NoContent);

        var body = method == "PUT" ? new SetListEntryDto(ListStatusKeys.Backlog) : null;
        var response = await elsewhere.SendAsync(new HttpMethod(method), path, body);

        await response.ExpectAsync(expected);

        // Signed out as a refused stamp signs a session out: the cookie, the two-factor remembrance and
        // the signed-in flag all go, on the first request that is refused, so the browser holds nothing
        // for an account that has gone.
        var cleared = response.Headers.TryGetValues("Set-Cookie", out var cookies) ? cookies.ToList() : [];
        Assert.Contains(cleared, cookie => cookie.StartsWith($".AspNetCore.{IdentityConstants.ApplicationScheme}=;", StringComparison.Ordinal));
        Assert.Contains(cleared, cookie => cookie.StartsWith($"{IdentityConstants.TwoFactorRememberMeScheme}=;", StringComparison.Ordinal));
        Assert.Contains(cleared, cookie => cookie.StartsWith($"{SignedInFlag.CookieName}=;", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ValidatePrincipal_AStampChangedSinceSignIn_IsStillRefusedPastTheInterval()
    {
        // ADR 0077's check wraps Identity's own, which ends a session whose security stamp has
        // changed once its thirty-minute interval has passed: what signs a renamed account out of its
        // other browsers. The deletion test cannot see that check, because the new one catches a
        // deleted account by itself. So this ages a real session past the interval, in the ticket
        // format the cookie handler reads, and changes the stamp of an account that still exists:
        // only Identity's check can refuse that.
        using var browser = api.CreateBrowser();
        var userName = Browsers.NewUserName("stamped");
        var (_, registered) = await browser.RegisterAndSignInAsync(userName);
        var account = await registered.ReadAsync<UserProfileDto>(HttpStatusCode.OK);

        var cookieName = $".AspNetCore.{IdentityConstants.ApplicationScheme}";
        var issued = registered.Headers.GetValues("Set-Cookie")
            .Single(cookie => cookie.StartsWith($"{cookieName}=", StringComparison.Ordinal));
        var session = issued[(cookieName.Length + 1)..issued.IndexOf(';')];

        var format = api.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(IdentityConstants.ApplicationScheme).TicketDataFormat;

        string Aged()
        {
            var ticket = format.Unprotect(session) ?? throw new InvalidOperationException("The session did not unprotect.");
            ticket.Properties.IssuedUtc = DateTimeOffset.UtcNow.AddHours(-1);
            return format.Protect(ticket);
        }

        Task<HttpResponseMessage> StatsWith(string cookie)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "/api/user/stats");
            request.Headers.Add("Cookie", $"{cookieName}={cookie}");
            return api.CreateDefaultClient(new Uri("https://localhost")).SendAsync(request);
        }

        // Aged alone it is checked, and passes: the stamp has not changed.
        await (await StatsWith(Aged())).ExpectAsync(HttpStatusCode.OK);

        using (var scope = api.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await users.FindByIdAsync(account.Id) ?? throw new InvalidOperationException("No account.");
            Assert.True((await users.UpdateSecurityStampAsync(user)).Succeeded);
        }

        // Inside the interval the old stamp is not asked about, as before ADR 0077.
        await (await StatsWith(session)).ExpectAsync(HttpStatusCode.OK);

        // Past it, Identity's check refuses the stamp of an account that is still there.
        var refused = await StatsWith(Aged());
        await refused.ExpectAsync(HttpStatusCode.Unauthorized);
        Assert.Contains(refused.Headers.GetValues("Set-Cookie"), cookie => cookie.StartsWith($"{cookieName}=;", StringComparison.Ordinal));

        await using var db = api.Database();
        Assert.True(await db.Users.AnyAsync(user => user.Id == account.Id));
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
