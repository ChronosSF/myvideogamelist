using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Security;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// An account signs in only once its address is confirmed (ADR 0089): registered, sent a link, refused
/// until the link is used, and told why only by somebody who knows the password.
/// </summary>
public class ConfirmationFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    private static Task<HttpResponseMessage> ConfirmAsync(HttpClient browser, EmailLink link) =>
        browser.SendAsync(HttpMethod.Post, "/api/auth/confirm-email", new ConfirmEmailDto(link.UserId, link.Token));

    private static Task<HttpResponseMessage> ResendAsync(HttpClient browser, string email) =>
        browser.SendAsync(HttpMethod.Post, "/api/auth/resend-confirmation", new ResendConfirmationDto(email));

    private static (string Email, string UserName) NewAccount(string prefix)
    {
        var userName = Browsers.NewUserName(prefix);
        return ($"{userName}@test.local", userName);
    }

    [Fact]
    public async Task Register_SendsTheLinkAndSignsNobodyIn()
    {
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("fresh");

        var registered = await browser.SignUpAsync(email, userName);

        Assert.True((await registered.ReadAsync<RegisterResultDto>(HttpStatusCode.OK)).EmailSent);
        Assert.False(registered.Headers.TryGetValues("Set-Cookie", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await browser.GetAsync("/api/auth/me")).StatusCode);

        var sent = Assert.Single(api.Mail.SentTo(email));
        Assert.Equal("account confirmation", sent.Purpose);
        var link = EmailLink.In(sent.Text, EmailLink.ConfirmEmail);
        Assert.StartsWith("https://localhost:58546/confirm-email#user=", link.Url);
    }

    [Fact]
    public async Task Register_ABotsToken_MakesNoAccountAndSendsNothing()
    {
        // Cloudflare is asked first (ADR 0092), so a refused check spends no email and claims no name.
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("bot");

        var refused = await browser.SignUpAsync(email, userName, JudgingTurnstile.Bot);

        await refused.ExpectAsync(HttpStatusCode.BadRequest);
        Assert.Contains("person", (await refused.ReadAsync<AuthMessageDto>(HttpStatusCode.BadRequest)).Message);
        Assert.Empty(api.Mail.SentTo(email));
        // The name is still free: a person's sign-up with it goes through.
        await (await browser.SignUpAsync(email, userName)).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Register_CloudflareDoesNotAnswer_IsA502ThatSaysSoAndMakesNoAccount()
    {
        // Nobody signs up unchecked, and the 502 is about the check, not the handler's sentence about game data.
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("unchecked");

        var failed = await browser.SignUpAsync(email, userName, JudgingTurnstile.Unreachable);

        var problem = await failed.ReadAsync<ProblemDetails>(HttpStatusCode.BadGateway);
        Assert.Contains("person", problem.Detail);
        Assert.DoesNotContain("IGDB", problem.Detail);
        Assert.True(problem.Extensions.ContainsKey("traceId"));
        Assert.Empty(api.Mail.SentTo(email));
        await (await browser.SignUpAsync(email, userName)).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Register_ADeploymentWithNoKeys_IsA503InTheShapeOfEveryOtherFailure()
    {
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("nokeys");

        var unavailable = await browser.SignUpAsync(email, userName, JudgingTurnstile.NoKeys);

        var problem = await unavailable.ReadAsync<ProblemDetails>(HttpStatusCode.ServiceUnavailable);
        Assert.Contains("not available", problem.Detail);
        Assert.True(problem.Extensions.ContainsKey("traceId"));
        Assert.Empty(api.Mail.SentTo(email));
    }

    [Fact]
    public async Task Register_NoToken_IsToldToReloadAndCloudflareIsNotAsked()
    {
        // A page loaded before the check existed sends none. The sentence is the one that page shows.
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("stale");
        var asked = api.Turnstile.Asked.Count;

        var refused = await browser.PostAsJsonAsync(
            "/api/auth/register", new { email, password = Browsers.Password, userName });

        var problem = await refused.ReadAsync<ValidationProblemDetails>(HttpStatusCode.BadRequest);
        Assert.Equal(
            "This page is out of date. Reload it, then sign up again.", Assert.Single(problem.Errors["TurnstileToken"]));
        Assert.Equal(asked, api.Turnstile.Asked.Count);
    }

    [Fact]
    public async Task Register_ATokenLongerThanAnyOfCloudflares_IsRefusedUnasked()
    {
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("long");
        var token = new string('x', Turnstile.MaxTokenLength + 1);

        var refused = await browser.SignUpAsync(email, userName, token);

        await refused.ExpectAsync(HttpStatusCode.BadRequest);
        Assert.DoesNotContain(token, api.Turnstile.Asked);
        Assert.Empty(api.Mail.SentTo(email));
    }

    [Fact]
    public async Task TurnstileSiteKey_IsTheDeploymentsOwn()
    {
        using var browser = api.CreateBrowser();

        var answer = await browser.GetAsync("/api/auth/turnstile");

        Assert.Equal("integration-site-key", (await answer.ReadAsync<TurnstileSiteKeyDto>(HttpStatusCode.OK)).SiteKey);
        Assert.Contains("no-store", answer.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task Login_Unconfirmed_WithThePassword_IsToldToConfirm()
    {
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("waiting");
        await (await browser.SignUpAsync(email, userName)).ExpectAsync(HttpStatusCode.OK);

        var login = await browser.LoginAsync(userName, Browsers.Password);

        await login.ExpectAsync(HttpStatusCode.Forbidden);
        var body = await login.Content.ReadAsStringAsync();
        Assert.Contains("\"unconfirmed\":true", body);
        Assert.False(login.Headers.TryGetValues("Set-Cookie", out _));
    }

    [Fact]
    public async Task Login_Unconfirmed_WithAWrongPassword_AnswersAsAnyWrongCombination()
    {
        // Without the password, nobody learns that the address has an account waiting.
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("guessed");
        await (await browser.SignUpAsync(email, userName)).ExpectAsync(HttpStatusCode.OK);

        var login = await browser.LoginAsync(email, "wrong-password-1");

        await login.ExpectAsync(HttpStatusCode.Unauthorized);
        Assert.DoesNotContain("unconfirmed", await login.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Login_Unconfirmed_FiveWrongPasswords_LockTheAccountAsAConfirmedOneWould()
    {
        // Identity refuses an unconfirmed account before it counts anything, so the controller counts.
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("locked");
        await (await browser.SignUpAsync(email, userName)).ExpectAsync(HttpStatusCode.OK);

        for (var attempt = 0; attempt < 5; attempt++)
            await (await browser.LoginAsync(email, "wrong-password-1")).ExpectAsync(HttpStatusCode.Unauthorized);

        var right = await browser.LoginAsync(email, Browsers.Password);

        await right.ExpectAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ConfirmEmail_ThenLogin_SignsIn()
    {
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("confirmed");
        await (await browser.SignUpAsync(email, userName)).ExpectAsync(HttpStatusCode.OK);
        var link = EmailLink.In(Assert.Single(api.Mail.SentTo(email)).Text, EmailLink.ConfirmEmail);

        await (await ConfirmAsync(browser, link)).ExpectAsync(HttpStatusCode.NoContent);

        // Confirming signs nobody in: the link outlives its use.
        Assert.Equal(HttpStatusCode.NoContent, (await browser.GetAsync("/api/auth/me")).StatusCode);

        var login = await browser.LoginAsync(email, Browsers.Password);
        Assert.Equal(userName, (await login.ReadAsync<UserProfileDto>(HttpStatusCode.OK)).UserName);
    }

    [Fact]
    public async Task ConfirmEmail_PressedTwice_ConfirmsTwice()
    {
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("twice");
        await (await browser.SignUpAsync(email, userName)).ExpectAsync(HttpStatusCode.OK);
        var link = EmailLink.In(Assert.Single(api.Mail.SentTo(email)).Text, EmailLink.ConfirmEmail);

        await (await ConfirmAsync(browser, link)).ExpectAsync(HttpStatusCode.NoContent);
        await (await ConfirmAsync(browser, link)).ExpectAsync(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task ConfirmEmail_AWrongTokenOrAccount_IsOneRefusal()
    {
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("wrongtoken");
        await (await browser.SignUpAsync(email, userName)).ExpectAsync(HttpStatusCode.OK);
        var link = EmailLink.In(Assert.Single(api.Mail.SentTo(email)).Text, EmailLink.ConfirmEmail);

        var wrongToken = await ConfirmAsync(browser, link with { Token = "not-the-token" });
        var wrongAccount = await ConfirmAsync(browser, link with { UserId = Guid.NewGuid().ToString() });

        await wrongToken.ExpectAsync(HttpStatusCode.BadRequest);
        await wrongAccount.ExpectAsync(HttpStatusCode.BadRequest);
        Assert.Equal(await wrongToken.Content.ReadAsStringAsync(), await wrongAccount.Content.ReadAsStringAsync());
        await (await browser.LoginAsync(email, Browsers.Password)).ExpectAsync(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Login_Unconfirmed_WithThePassword_SendsTheLinkItNeverHad()
    {
        // Somebody whose first email never went, as one registered on the revision before confirmation
        // would be: the sign-in that proves the password sends it, at the account's pace.
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("unsent");
        api.Mail.RefuseNext();
        await (await browser.SignUpAsync(email, userName)).ExpectAsync(HttpStatusCode.OK);
        Assert.Empty(api.Mail.SentTo(email));

        await (await browser.LoginAsync(email, Browsers.Password)).ExpectAsync(HttpStatusCode.Forbidden);
        await (await browser.LoginAsync(email, Browsers.Password)).ExpectAsync(HttpStatusCode.Forbidden);

        Assert.Single(api.Mail.SentTo(email));
    }

    [Fact]
    public async Task Register_TheEmailRefused_SaysSoAndAResendSendsIt()
    {
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("refused");
        api.Mail.RefuseNext();

        var registered = await browser.SignUpAsync(email, userName);

        Assert.False((await registered.ReadAsync<RegisterResultDto>(HttpStatusCode.OK)).EmailSent);
        Assert.Empty(api.Mail.SentTo(email));

        // A send that failed lifts the pace, so asking again sends at once.
        await (await ResendAsync(browser, userName)).ExpectAsync(HttpStatusCode.Accepted);
        Assert.Single(api.Mail.SentTo(email));
    }

    [Fact]
    public async Task Resend_WithinTheFirstFewMinutes_SendsNothingMore()
    {
        using var browser = api.CreateBrowser();
        var (email, userName) = NewAccount("paced");
        await (await browser.SignUpAsync(email, userName)).ExpectAsync(HttpStatusCode.OK);

        await (await ResendAsync(browser, email)).ExpectAsync(HttpStatusCode.Accepted);
        await (await ResendAsync(browser, email)).ExpectAsync(HttpStatusCode.Accepted);

        Assert.Single(api.Mail.SentTo(email));
    }

    [Fact]
    public async Task Resend_NoSuchAccountOrAConfirmedOne_AnswersTheSameAndSendsNothing()
    {
        using var browser = api.CreateBrowser();
        var userName = Browsers.NewUserName("done");
        var nobody = $"{Browsers.NewUserName("nobody")}@test.local";
        await browser.RegisterAsync(userName);
        var before = api.Mail.Sent.Count;

        await (await ResendAsync(browser, nobody)).ExpectAsync(HttpStatusCode.Accepted);
        await (await ResendAsync(browser, $"{userName}@test.local")).ExpectAsync(HttpStatusCode.Accepted);

        Assert.Equal(before, api.Mail.Sent.Count);
    }
}
