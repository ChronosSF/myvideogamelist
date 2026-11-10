using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Security;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// A forgotten password (ADR 0090): a request that answers the same whatever it names, a link at most
/// every few minutes, and a reset that works once, confirms the address, ends the lockout and ends every
/// session, and signs nobody in.
/// </summary>
public class PasswordResetFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    private const string NewPassword = "reset-password-2";

    private static Task<HttpResponseMessage> ForgotAsync(HttpClient browser, string emailOrUserName) =>
        browser.SendAsync(HttpMethod.Post, "/api/auth/forgot-password", new ForgotPasswordDto(emailOrUserName));

    private static Task<HttpResponseMessage> ResetAsync(HttpClient browser, ResetPasswordLink link, string password) =>
        browser.SendAsync(HttpMethod.Post, "/api/auth/reset-password", new ResetPasswordDto(link.UserId, link.Token, password));

    private static Task<HttpResponseMessage> LoginAsync(HttpClient browser, string email, string password) =>
        browser.PostAsJsonAsync("/api/auth/login", new LoginDto(email, password));

    /// <summary>A confirmed account, signed in on the browser it was made in.</summary>
    private static async Task<string> SignedUpAsync(HttpClient browser, string prefix)
    {
        var userName = Browsers.NewUserName(prefix);
        await browser.RegisterAsync(userName);
        return userName;
    }

    /// <summary>Asks for a reset on a browser of its own, and hands back the link the email carried.</summary>
    private async Task<ResetPasswordLink> LinkForAsync(string emailOrUserName, string email)
    {
        using var browser = api.CreateBrowser();
        await (await ForgotAsync(browser, emailOrUserName)).ExpectAsync(HttpStatusCode.Accepted);
        return api.Mail.LatestResetTo(email);
    }

    [Fact]
    public void TheResetsToken_IsMadeByTheProviderWhoseLifespanTheEmailStates()
    {
        // The email reads PasswordResetTokenProviderOptions; this is what makes that the token's real life.
        var identity = api.Services.GetRequiredService<IOptions<IdentityOptions>>().Value;

        Assert.Equal(
            typeof(PasswordResetTokenProvider),
            identity.Tokens.ProviderMap[identity.Tokens.PasswordResetTokenProvider].ProviderType);
        Assert.NotEqual(identity.Tokens.EmailConfirmationTokenProvider, identity.Tokens.PasswordResetTokenProvider);
        Assert.Equal(
            TimeSpan.FromHours(1),
            api.Services.GetRequiredService<IOptions<PasswordResetTokenProviderOptions>>().Value.TokenLifespan);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ForgotPassword_ByEmailOrByUserName_SendsTheLinkToTheAddress(bool byEmail)
    {
        using var browser = api.CreateBrowser();
        var userName = await SignedUpAsync(browser, byEmail ? "byemail" : "byname");
        var email = $"{userName}@test.local";

        await (await ForgotAsync(browser, byEmail ? email : userName)).ExpectAsync(HttpStatusCode.Accepted);

        var sent = Assert.Single(api.Mail.SentTo(email), message => message.Purpose == "password reset");
        Assert.Contains("The link works for 1 hour, and only once.", sent.Text);
        Assert.StartsWith("https://localhost:58546/reset-password#user=", ResetPasswordLink.In(sent.Text).Url);
    }

    [Fact]
    public async Task ForgotPassword_NoSuchAccount_AnswersAsARealOneAndSendsNothing()
    {
        using var browser = api.CreateBrowser();
        var userName = await SignedUpAsync(browser, "real");
        var before = api.Mail.Sent.Count;

        var real = await ForgotAsync(browser, userName);
        var nobody = await ForgotAsync(browser, $"{Browsers.NewUserName("nobody")}@test.local");

        await real.ExpectAsync(HttpStatusCode.Accepted);
        await nobody.ExpectAsync(HttpStatusCode.Accepted);
        Assert.Equal(await real.Content.ReadAsStringAsync(), await nobody.Content.ReadAsStringAsync());
        Assert.Equal(before + 1, api.Mail.Sent.Count);
    }

    [Fact]
    public async Task ForgotPassword_AskedAgainWithinTheFewMinutes_SendsNothingMore()
    {
        using var browser = api.CreateBrowser();
        var userName = await SignedUpAsync(browser, "paced");
        var email = $"{userName}@test.local";

        await (await ForgotAsync(browser, email)).ExpectAsync(HttpStatusCode.Accepted);
        await (await ForgotAsync(browser, userName)).ExpectAsync(HttpStatusCode.Accepted);

        Assert.Single(api.Mail.SentTo(email), message => message.Purpose == "password reset");
    }

    [Fact]
    public async Task ForgotPassword_TheEmailRefused_IsSentWhenAskedAgain()
    {
        using var browser = api.CreateBrowser();
        var userName = await SignedUpAsync(browser, "refused");
        var email = $"{userName}@test.local";
        api.Mail.RefuseNext();

        await (await ForgotAsync(browser, email)).ExpectAsync(HttpStatusCode.Accepted);
        Assert.DoesNotContain(api.Mail.SentTo(email), message => message.Purpose == "password reset");

        await (await ForgotAsync(browser, email)).ExpectAsync(HttpStatusCode.Accepted);
        Assert.Single(api.Mail.SentTo(email), message => message.Purpose == "password reset");
    }

    [Fact]
    public async Task ResetPassword_ThenLogin_TheNewPasswordSignsInAndTheOldDoesNot()
    {
        using var browser = api.CreateBrowser();
        var userName = await SignedUpAsync(browser, "renewed");
        var email = $"{userName}@test.local";
        var link = await LinkForAsync(email, email);
        using var resetting = api.CreateBrowser();

        var reset = await ResetAsync(resetting, link, NewPassword);

        // Signs nobody in: the page offers the sign-in, which is the one way in.
        await reset.ExpectAsync(HttpStatusCode.NoContent);
        Assert.False(reset.Headers.TryGetValues("Set-Cookie", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await resetting.GetAsync("/api/auth/me")).StatusCode);

        await (await LoginAsync(resetting, email, Browsers.Password)).ExpectAsync(HttpStatusCode.Unauthorized);
        var login = await LoginAsync(resetting, userName, NewPassword);
        Assert.Equal(userName, (await login.ReadAsync<UserProfileDto>(HttpStatusCode.OK)).UserName);
    }

    [Fact]
    public async Task ResetPassword_TheLinkUsedTwice_IsRefusedTheSecondTime()
    {
        // The reset changes the security stamp, which every reset token carries: a link works once.
        using var browser = api.CreateBrowser();
        var userName = await SignedUpAsync(browser, "once");
        var email = $"{userName}@test.local";
        var link = await LinkForAsync(email, email);

        await (await ResetAsync(browser, link, NewPassword)).ExpectAsync(HttpStatusCode.NoContent);
        var again = await ResetAsync(browser, link, "another-password-3");

        var refusal = await again.ReadAsync<ResetLinkRefusedDto>(HttpStatusCode.BadRequest);
        Assert.True(refusal.InvalidLink);
        await (await LoginAsync(browser, email, NewPassword)).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ResetPassword_AWrongTokenOrAccount_IsOneRefusalAndChangesNothing()
    {
        using var browser = api.CreateBrowser();
        var userName = await SignedUpAsync(browser, "wrongtoken");
        var email = $"{userName}@test.local";
        var link = await LinkForAsync(email, email);

        var wrongToken = await ResetAsync(browser, link with { Token = "not-the-token" }, NewPassword);
        var wrongAccount = await ResetAsync(browser, link with { UserId = Guid.NewGuid().ToString() }, NewPassword);

        Assert.True((await wrongToken.ReadAsync<ResetLinkRefusedDto>(HttpStatusCode.BadRequest)).InvalidLink);
        await wrongAccount.ExpectAsync(HttpStatusCode.BadRequest);
        Assert.Equal(await wrongToken.Content.ReadAsStringAsync(), await wrongAccount.Content.ReadAsStringAsync());
        await (await LoginAsync(browser, email, Browsers.Password)).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ResetPassword_APasswordTheRulesRefuse_SaysWhyAndLeavesTheLinkWorking()
    {
        using var browser = api.CreateBrowser();
        var userName = await SignedUpAsync(browser, "weak");
        var email = $"{userName}@test.local";
        var link = await LinkForAsync(email, email);

        var weak = await ResetAsync(browser, link, "short");

        await weak.ExpectAsync(HttpStatusCode.BadRequest);
        var body = await weak.Content.ReadAsStringAsync();
        Assert.Contains("\"errors\":[", body);
        Assert.DoesNotContain("invalidLink", body);

        await (await ResetAsync(browser, link, NewPassword)).ExpectAsync(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task ResetPassword_AnUnconfirmedAccount_IsConfirmedByIt()
    {
        // The link went to the address and came back, which is what a confirmation proves. So somebody who
        // never confirmed and has lost the password they chose is let in by the one email.
        using var browser = api.CreateBrowser();
        var userName = Browsers.NewUserName("unconfirmed");
        var email = $"{userName}@test.local";
        var registered = await browser.PostAsJsonAsync("/api/auth/register", new RegisterDto(email, Browsers.Password, userName));
        await registered.ExpectAsync(HttpStatusCode.OK);

        // Asked for straight after signing up, while the confirmation's pace still holds: a pace of its own.
        var link = await LinkForAsync(userName, email);
        await (await ResetAsync(browser, link, NewPassword)).ExpectAsync(HttpStatusCode.NoContent);

        await (await LoginAsync(browser, email, NewPassword)).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ResetPassword_ALockedAccount_IsUnlockedByIt()
    {
        // Identity leaves the lockout where it was, so without this its owner would be told for fifteen
        // minutes that the password they had just chosen is wrong.
        using var browser = api.CreateBrowser();
        var userName = await SignedUpAsync(browser, "locked");
        var email = $"{userName}@test.local";
        using var guessing = api.CreateBrowser();
        for (var attempt = 0; attempt < 5; attempt++)
            await (await LoginAsync(guessing, email, "wrong-password-1")).ExpectAsync(HttpStatusCode.Unauthorized);
        await (await LoginAsync(guessing, email, Browsers.Password)).ExpectAsync(HttpStatusCode.Unauthorized);

        var link = await LinkForAsync(email, email);
        await (await ResetAsync(browser, link, NewPassword)).ExpectAsync(HttpStatusCode.NoContent);

        await (await LoginAsync(browser, email, NewPassword)).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ResetPassword_EndsEverySessionAtItsNextRequest_AndNotTheOneSignedInAfter()
    {
        using var before = api.CreateBrowser();
        var userName = await SignedUpAsync(before, "everywhere");
        var email = $"{userName}@test.local";
        await (await before.GetAsync("/api/user/stats")).ExpectAsync(HttpStatusCode.OK);

        var link = await LinkForAsync(email, email);
        using var after = api.CreateBrowser();
        await (await ResetAsync(after, link, NewPassword)).ExpectAsync(HttpStatusCode.NoContent);
        await (await LoginAsync(after, email, NewPassword)).ExpectAsync(HttpStatusCode.OK);

        // At once, not at Identity's check of the stamp half an hour on, and signed out as that check
        // signs a session out: the cookie and the signed-in flag go with it.
        var refused = await before.GetAsync("/api/user/stats");
        await refused.ExpectAsync(HttpStatusCode.Unauthorized);
        var cleared = refused.Headers.GetValues("Set-Cookie").ToList();
        Assert.Contains(cleared, cookie => cookie.StartsWith($".AspNetCore.{IdentityConstants.ApplicationScheme}=;", StringComparison.Ordinal));
        Assert.Contains(cleared, cookie => cookie.StartsWith($"{SignedInFlag.CookieName}=;", StringComparison.Ordinal));

        // The session begun since, very likely within the same second as the reset, is kept: it carries
        // the new stamp.
        await (await after.GetAsync("/api/user/stats")).ExpectAsync(HttpStatusCode.OK);

        await using var db = api.Database();
        var account = db.Users.Single(user => user.UserName == userName);
        Assert.NotNull(account.SessionsEndedAt);
    }
}
