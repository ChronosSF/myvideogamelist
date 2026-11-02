using System.Net;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using Npgsql;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// A reader reports, and an admin withdraws, through the API over PostgreSQL (ADR 0076): what the in-memory
/// provider cannot show, which is the two unique indexes, the check constraints and the two cascades that
/// take a report with what it reports, and the admin's acts end to end behind the application's own policy.
/// </summary>
public class ModerationFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    private const int GameId = 1960;

    /// <summary>A public profile with a display name, a bio and a public review of <see cref="GameId"/>, signed in.</summary>
    private async Task<(HttpClient Browser, UserProfileDto Account)> PublishedAsync(string prefix)
    {
        await api.CacheGamesAsync(GameId);
        var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName(prefix));

        await (await browser.SendAsync(HttpMethod.Put, "/api/user/privacy",
            new UpdateProfileVisibilityDto(ProfileVisibility.Public))).ExpectAsync(HttpStatusCode.OK);
        await (await browser.SendAsync(HttpMethod.Put, "/api/user/profile",
            new UpdateProfileDetailsDto("Shown Name", null, "A bio."))).ExpectAsync(HttpStatusCode.OK);
        await (await browser.SendAsync(HttpMethod.Put, $"/api/entries/{GameId}/review",
            new ReviewInputDto("Worth every hour.", false, ReviewVisibility.Public, null))).ExpectAsync(HttpStatusCode.OK);

        return (browser, account);
    }

    private async Task<HttpClient> ReaderAsync(string prefix)
    {
        var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName(prefix));
        return browser;
    }

    private static Task<HttpResponseMessage> ReportAsync(HttpClient reader, string userName, int? gameId, string reason = ReportReason.Spam) =>
        reader.SendAsync(HttpMethod.Post, "/api/reports", new ReportInputDto(userName, gameId, reason, null));

    private async Task<int> ReportsAboutAsync(string accountId)
    {
        await using var db = api.Database();
        return await db.ContentReports.AsNoTracking()
            .CountAsync(r => r.ProfileUserId == accountId || r.Review!.UserId == accountId);
    }

    [Fact]
    public async Task Report_TheSameThingTwice_IsOneReportWithTheSecondReason()
    {
        var (author, account) = await PublishedAsync("twice");
        using var _ = author;
        using var reader = await ReaderAsync("reader");

        await (await ReportAsync(reader, account.UserName, GameId)).ExpectAsync(HttpStatusCode.NoContent);
        await (await ReportAsync(reader, account.UserName, GameId, ReportReason.Abuse)).ExpectAsync(HttpStatusCode.NoContent);

        await using var db = api.Database();
        var report = await db.ContentReports.AsNoTracking().SingleAsync(r => r.Review!.UserId == account.Id);
        Assert.Equal(ReportReason.Abuse, report.Reason);
    }

    [Fact]
    public async Task Report_SignedOut_IsRefused()
    {
        var (author, account) = await PublishedAsync("anon");
        using var _ = author;
        using var nobody = api.CreateBrowser();

        await (await ReportAsync(nobody, account.UserName, null)).ExpectAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Report_WhatIsNotPublished_IsTheSameNotFoundAsAnUnclaimedName()
    {
        var (author, account) = await PublishedAsync("private");
        using var _ = author;
        await (await author.SendAsync(HttpMethod.Put, "/api/user/privacy",
            new UpdateProfileVisibilityDto(ProfileVisibility.Private))).ExpectAsync(HttpStatusCode.OK);
        using var reader = await ReaderAsync("reader");

        await (await ReportAsync(reader, account.UserName, null)).ExpectAsync(HttpStatusCode.NotFound);
        await (await ReportAsync(reader, account.UserName, GameId)).ExpectAsync(HttpStatusCode.NotFound);
        await (await ReportAsync(reader, "nobody_here", null)).ExpectAsync(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteReview_ThatWasReported_TakesItsReportsAndLeavesTheProfiles()
    {
        var (author, account) = await PublishedAsync("deletes");
        using var _ = author;
        using var reader = await ReaderAsync("reader");
        await (await ReportAsync(reader, account.UserName, GameId)).ExpectAsync(HttpStatusCode.NoContent);
        await (await ReportAsync(reader, account.UserName, null)).ExpectAsync(HttpStatusCode.NoContent);

        await (await author.SendAsync(HttpMethod.Delete, $"/api/entries/{GameId}/review")).ExpectAsync(HttpStatusCode.NoContent);

        // One DELETE of the review, and the foreign key does the rest.
        await using var db = api.Database();
        Assert.Equal([account.Id], await db.ContentReports.AsNoTracking()
            .Where(r => r.ProfileUserId == account.Id || r.ReviewId != null && r.Review!.UserId == account.Id)
            .Select(r => r.ProfileUserId)
            .ToListAsync());
    }

    [Fact]
    public async Task DeleteAccount_ThatWasReported_TakesEveryReportAboutIt()
    {
        var (author, account) = await PublishedAsync("reported");
        using var _ = author;
        using var reader = await ReaderAsync("reader");
        await (await ReportAsync(reader, account.UserName, GameId)).ExpectAsync(HttpStatusCode.NoContent);
        await (await ReportAsync(reader, account.UserName, null)).ExpectAsync(HttpStatusCode.NoContent);
        Assert.Equal(2, await ReportsAboutAsync(account.Id));

        await (await author.SendAsync(HttpMethod.Delete, "/api/user",
            new DeleteAccountDto(Browsers.Password))).ExpectAsync(HttpStatusCode.NoContent);

        Assert.Equal(0, await ReportsAboutAsync(account.Id));
    }

    public static TheoryData<string> WhatTheDatabaseRefuses() => ["both", "neither", "an unknown reason"];

    [Theory]
    [MemberData(nameof(WhatTheDatabaseRefuses))]
    public async Task ContentReports_AReportAboutTwoThingsNothingOrForNoReasonTheTermsGive_IsRefused(string what)
    {
        var (author, account) = await PublishedAsync("checked");
        using var _ = author;
        await using var db = api.Database();
        var reviewId = await db.Reviews.Where(r => r.UserId == account.Id).Select(r => r.Id).SingleAsync();

        db.ContentReports.Add(new ContentReport
        {
            UserId = account.Id,
            ReviewId = what == "neither" ? null : reviewId,
            ProfileUserId = what == "both" ? account.Id : null,
            Reason = what == "an unknown reason" ? "boring" : ReportReason.Spam,
            CreatedAt = DateTimeOffset.UtcNow,
        });

        var refused = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(PostgresErrorCodes.CheckViolation, Assert.IsType<PostgresException>(refused.InnerException).SqlState);
    }

    [Fact]
    public async Task Moderation_ByAnAccountNotNamed_IsRefused()
    {
        using var reader = await ReaderAsync("notadmin");

        await (await reader.GetAsync("/api/admin/moderation")).ExpectAsync(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task HideAndShowAgain_AReportedReview_LeavesBothPublicReadsAndComesBack()
    {
        var (author, account) = await PublishedAsync("hidden");
        using var _ = author;
        using var reader = await ReaderAsync("reader");
        await (await ReportAsync(reader, account.UserName, GameId, ReportReason.Abuse)).ExpectAsync(HttpStatusCode.NoContent);
        using var admin = api.CreateBrowser();
        api.NameAdmins((await admin.RegisterAsync(Browsers.NewUserName("admin"))).Id);

        var queue = await admin.GetJsonAsync<ModerationQueueDto>("/api/admin/moderation");
        var item = Assert.Single(queue.Reviews, r => r.UserName == account.UserName);
        Assert.Equal(("Worth every hour.", "Game 1960", ReportReason.Abuse),
            (item.Body, item.GameTitle, Assert.Single(item.Reports).Reason));

        var sent = api.Edge.Sent.Count;
        await (await admin.SendAsync(HttpMethod.Put, $"/api/admin/moderation/reviews/{item.ReviewId}/hidden"))
            .ExpectAsync(HttpStatusCode.NoContent);

        // Off the edge, off the profile and off the game page, with its reports answered.
        var invalidation = Assert.Single(api.Edge.SentSince(sent));
        Assert.Equal(("review hidden by an admin", $"/u/{account.UserName}*"), (invalidation.Reason, Assert.Single(invalidation.Paths)));
        Assert.Empty((await reader.GetJsonAsync<PublicReviewsDto>($"/api/users/{account.UserName}/reviews")).Reviews);
        Assert.Equal(0, (await reader.GetJsonAsync<GameReviewsDto>($"/api/games/{GameId}/reviews")).Reviews
            .Count(r => r.UserName == account.UserName));
        Assert.Equal(0, await ReportsAboutAsync(account.Id));

        // Still its author's, who is told.
        var own = await author.GetJsonAsync<EntryDetailDto>($"/api/entries/{GameId}");
        Assert.NotNull(own.Review?.HiddenAt);

        await (await admin.SendAsync(HttpMethod.Delete, $"/api/admin/moderation/reviews/{item.ReviewId}/hidden"))
            .ExpectAsync(HttpStatusCode.NoContent);

        Assert.Single((await reader.GetJsonAsync<PublicReviewsDto>($"/api/users/{account.UserName}/reviews")).Reviews);
    }

    [Fact]
    public async Task Clear_AReportedProfile_ClearsTheChosenFieldsAndTakesThePageOffTheEdge()
    {
        var (author, account) = await PublishedAsync("cleared");
        using var _ = author;
        using var reader = await ReaderAsync("reader");
        await (await ReportAsync(reader, account.UserName, null, ReportReason.Impersonation)).ExpectAsync(HttpStatusCode.NoContent);
        using var admin = api.CreateBrowser();
        api.NameAdmins((await admin.RegisterAsync(Browsers.NewUserName("admin"))).Id);

        var queue = await admin.GetJsonAsync<ModerationQueueDto>("/api/admin/moderation");
        var item = Assert.Single(queue.Profiles, p => p.UserName == account.UserName);
        Assert.Equal(("Shown Name", "A bio."), (item.DisplayName, item.Bio));

        var sent = api.Edge.Sent.Count;
        await (await admin.SendAsync(HttpMethod.Post, $"/api/admin/moderation/profiles/{item.AccountId}/clear",
            new ClearProfileDto(DisplayName: true, AvatarUrl: false, Bio: false))).ExpectAsync(HttpStatusCode.NoContent);

        var invalidation = Assert.Single(api.Edge.SentSince(sent));
        Assert.Equal(("profile details changed", $"/u/{account.UserName}*"), (invalidation.Reason, Assert.Single(invalidation.Paths)));
        var profile = await reader.GetJsonAsync<PublicProfileDto>($"/api/users/{account.UserName}");
        Assert.Equal((null, "A bio."), (profile.DisplayName, profile.Bio));
        Assert.Equal(0, await ReportsAboutAsync(account.Id));

        // The owner is still signed in, and sees the field empty.
        var me = await author.GetJsonAsync<UserProfileDto>("/api/auth/me");
        Assert.Null(me.DisplayName);
    }
}
