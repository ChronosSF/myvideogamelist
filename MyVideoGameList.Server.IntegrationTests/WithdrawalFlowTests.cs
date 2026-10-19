using System.Net;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The two withdrawals whose review goes by PostgreSQL's cascade rather than by a delete of its
/// own: everything recorded about a game, and the account. In-memory, the cascade deletes nothing
/// the context is not tracking, so only here does the review's going show (ADR 0057, 0058).
/// </summary>
public class WithdrawalFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    private const int GameId = 1942;

    /// <summary>A public profile with a public review of <see cref="GameId"/>, signed in.</summary>
    private async Task<(HttpClient Browser, UserProfileDto Account)> PublicReviewerAsync(string prefix)
    {
        var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName(prefix));

        await (await browser.SendAsync(HttpMethod.Put, "/api/user/privacy",
            new UpdateProfileVisibilityDto(ProfileVisibility.Public))).ExpectAsync(HttpStatusCode.OK);
        await (await browser.SendAsync(HttpMethod.Put, $"/api/entries/{GameId}/review",
            new ReviewInputDto("Worth every hour.", false, ReviewVisibility.Public, null))).ExpectAsync(HttpStatusCode.OK);

        return (browser, account);
    }

    private async Task<int> StoredReviewsAsync(string accountId)
    {
        await using var db = api.Database();
        return await db.Reviews.AsNoTracking().CountAsync(r => r.UserId == accountId);
    }

    [Fact]
    public async Task DeleteEntry_WithAPublicReviewOnAPublicProfile_TakesTheReviewAndInvalidatesTheProfile()
    {
        var (browser, account) = await PublicReviewerAsync("deleter");
        using var _ = browser;
        var sent = api.Edge.Sent.Count;

        await (await browser.SendAsync(HttpMethod.Delete, $"/api/entries/{GameId}")).ExpectAsync(HttpStatusCode.NoContent);

        Assert.Equal(0, await StoredReviewsAsync(account.Id));
        var invalidation = Assert.Single(api.Edge.SentSince(sent));
        Assert.Equal("entry deleted", invalidation.Reason);
        Assert.Equal([$"/u/{account.UserName}*"], invalidation.Paths);
    }

    [Fact]
    public async Task DeleteAccount_WithAPublicReviewOnAPublicProfile_TakesTheReviewAndInvalidatesTheProfileAndSitemaps()
    {
        var (browser, account) = await PublicReviewerAsync("leaver");
        using var _ = browser;
        var sent = api.Edge.Sent.Count;

        await (await browser.SendAsync(HttpMethod.Delete, "/api/user",
            new DeleteAccountDto(Browsers.Password))).ExpectAsync(HttpStatusCode.NoContent);

        Assert.Equal(0, await StoredReviewsAsync(account.Id));
        var invalidation = Assert.Single(api.Edge.SentSince(sent));
        Assert.Equal("account deleted", invalidation.Reason);
        Assert.Equal([$"/u/{account.UserName}*", "/sitemaps/profiles-*"], invalidation.Paths);
    }
}
