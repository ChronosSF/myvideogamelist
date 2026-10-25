using System.Net;
using System.Net.Http.Json;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Security;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The cookie that tells the edge and the home page's server render that a browser is signed in, and
/// nothing about who (ADR 0074): set and cleared with the session through the real pipeline, by the sign-in
/// cookie's own events and by <c>/api/auth/me</c>.
/// </summary>
public class SignedInFlagTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    /// <summary>The flag's <c>Set-Cookie</c> on a response, or null when it sent none.</summary>
    private static string? Flag(HttpResponseMessage response) =>
        response.Headers.TryGetValues("Set-Cookie", out var cookies)
            ? cookies.SingleOrDefault(cookie => cookie.StartsWith($"{SignedInFlag.CookieName}=", StringComparison.Ordinal))
            : null;

    private static void AssertSet(string? flag)
    {
        Assert.NotNull(flag);
        Assert.StartsWith($"{SignedInFlag.CookieName}=1;", flag);
        // The session cookie's own attributes: only the server reads it, and only over HTTPS.
        Assert.Contains("httponly", flag, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", flag, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", flag, StringComparison.OrdinalIgnoreCase);
    }

    private static void AssertCleared(string? flag)
    {
        Assert.NotNull(flag);
        Assert.StartsWith($"{SignedInFlag.CookieName}=;", flag);
        Assert.Contains("expires=Thu, 01 Jan 1970", flag, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Register_SetsTheFlag_ForAsLongAsTheSession()
    {
        // A registration signs in persistently, so the flag outlives the browser as the session does.
        using var browser = api.CreateBrowser();
        var userName = Browsers.NewUserName("flagged");

        var registered = await browser.PostAsJsonAsync(
            "/api/auth/register", new RegisterDto($"{userName}@test.local", Browsers.Password, userName));

        await registered.ExpectAsync(HttpStatusCode.OK);
        var flag = Flag(registered);
        AssertSet(flag);
        Assert.Contains("expires=", flag, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Login_WithoutRememberMe_SetsAFlagThatEndsWithTheBrowser()
    {
        // The session ends with the browser, so a flag that outlived it would draw the next visit's top
        // section for somebody no longer signed in.
        var userName = Browsers.NewUserName("brief");
        using (var first = api.CreateBrowser()) await first.RegisterAsync(userName);
        using var browser = api.CreateBrowser();

        var login = await browser.PostAsJsonAsync(
            "/api/auth/login", new LoginDto($"{userName}@test.local", Browsers.Password, RememberMe: false));

        await login.ExpectAsync(HttpStatusCode.OK);
        var flag = Flag(login);
        AssertSet(flag);
        Assert.DoesNotContain("expires=", flag, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Logout_ClearsTheFlag()
    {
        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("goodbye"));

        var logout = await browser.SendAsync(HttpMethod.Post, "/api/auth/logout");

        await logout.ExpectAsync(HttpStatusCode.NoContent);
        AssertCleared(Flag(logout));
    }

    [Fact]
    public async Task Me_SignedIn_SetsTheFlagAgain()
    {
        // Every page load asks, so a session that slid past the flag's first expiry gets it back.
        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("returning"));

        var me = await browser.GetAsync("/api/auth/me");

        await me.ExpectAsync(HttpStatusCode.OK);
        AssertSet(Flag(me));
    }

    [Fact]
    public async Task Me_AFlagLeftOverWithNoSession_IsCleared()
    {
        // A session that expired, or was refused for a changed security stamp, ends without a sign-out.
        // The flag it leaves costs the next page load the wrong top section, and this one clears it.
        using var stale = api.CreateDefaultClient(new Uri("https://localhost"));
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        request.Headers.Add("Cookie", $"{SignedInFlag.CookieName}=1");

        var me = await stale.SendAsync(request);

        await me.ExpectAsync(HttpStatusCode.NoContent);
        AssertCleared(Flag(me));
    }

    [Fact]
    public async Task Me_AVisitorWithNoFlag_IsSentNone()
    {
        using var browser = api.CreateBrowser();

        var me = await browser.GetAsync("/api/auth/me");

        await me.ExpectAsync(HttpStatusCode.NoContent);
        Assert.Null(Flag(me));
    }
}
