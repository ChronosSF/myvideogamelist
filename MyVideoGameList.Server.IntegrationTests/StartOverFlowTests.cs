using System.Net;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// Start over through the API, against PostgreSQL: what the password guards, what a pending import's
/// review looks like afterwards, and what the edge is told (ADR 0095). Its set-based deletes and the
/// cascades they lean on cannot run in memory at all. That every user-owned table is emptied or kept
/// as the service says is <c>OwnershipCascadeTests</c>'.
/// </summary>
public class StartOverFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    private const int Held = 2101;
    private const int Fresh = 2102;
    private const int Declined = 2103;
    private const int Timed = 2104;

    private static Task<HttpResponseMessage> StartOverAsync(HttpClient browser, string password = Browsers.Password) =>
        browser.SendAsync(HttpMethod.Delete, "/api/user/library", new PasswordConfirmationDto(password));

    private async Task<int> StoredEntriesAsync(string accountId)
    {
        await using var db = api.Database();
        return await db.UserGameEntries.AsNoTracking().CountAsync(e => e.UserId == accountId);
    }

    [Fact]
    public async Task StartOver_WithTheWrongPassword_IsA401AndEmptiesNothing()
    {
        await api.CacheGamesAsync(Held);
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("guesser"));
        await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{Held}",
            new SetListEntryDto(ListStatusKeys.Playing))).ExpectAsync(HttpStatusCode.NoContent);

        await (await StartOverAsync(browser, "not-the-password")).ExpectAsync(HttpStatusCode.Unauthorized);

        Assert.Equal(1, await StoredEntriesAsync(account.Id));
    }

    [Fact]
    public async Task StartOver_AfterFiveWrongPasswords_RefusesTheRightOneAndEmptiesNothing()
    {
        // Each wrong guess counts towards Identity's lockout, as at sign-in, so a session that is not its
        // owner's cannot guess the password here without limit (ADR 0095).
        await api.CacheGamesAsync(Held);
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("locked"));
        await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{Held}",
            new SetListEntryDto(ListStatusKeys.Playing))).ExpectAsync(HttpStatusCode.NoContent);

        for (var guess = 0; guess < 5; guess++)
            await (await StartOverAsync(browser, $"guess-{guess}")).ExpectAsync(HttpStatusCode.Unauthorized);

        await (await StartOverAsync(browser)).ExpectAsync(HttpStatusCode.Unauthorized);

        Assert.Equal(1, await StoredEntriesAsync(account.Id));
    }

    [Fact]
    public async Task StartOver_DropsTheCachedCommunityTimesOfTheGamesItEmptied()
    {
        // The runs go by a cascade, which the playthrough service never hears about, so the medians it
        // cached for the game would otherwise go on counting them until they expire.
        await api.CacheGamesAsync(Timed);
        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("timer"));
        await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{Timed}",
            new SetListEntryDto(ListStatusKeys.Finished))).ExpectAsync(HttpStatusCode.NoContent);
        await (await browser.SendAsync(HttpMethod.Post, $"/api/entries/{Timed}/playthroughs",
            new PlaythroughInputDto(PlaythroughTypeKeys.Normally, 6, 600,
                new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 20), null))).ExpectAsync(HttpStatusCode.Created);

        int Normally(CommunityTimesDto times) => times.Buckets.Single(b => b.Type == PlaythroughTypeKeys.Normally).Samples;
        var before = await browser.GetJsonAsync<CommunityTimesDto>($"/api/games/{Timed}/community-times");
        Assert.Equal(1, Normally(before));

        await (await StartOverAsync(browser)).ExpectAsync(HttpStatusCode.OK);

        var after = await browser.GetJsonAsync<CommunityTimesDto>($"/api/games/{Timed}/community-times");
        Assert.Equal(0, Normally(after));
    }

    [Fact]
    public async Task StartOver_EmptiesTheHistoryBehindTheStatistics()
    {
        // The event log goes with the library, or the history page would go on listing moves of games
        // the account no longer holds.
        await api.CacheGamesAsync(Held);
        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("historian"));
        await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{Held}",
            new SetListEntryDto(ListStatusKeys.Playing))).ExpectAsync(HttpStatusCode.NoContent);
        await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{Held}",
            new SetListEntryDto(ListStatusKeys.Finished))).ExpectAsync(HttpStatusCode.NoContent);
        Assert.NotEmpty((await browser.GetJsonAsync<HistoryPageDto>("/api/user/history")).Items);

        var counts = await (await StartOverAsync(browser)).ReadAsync<StartOverResultDto>(HttpStatusCode.OK);

        Assert.Equal(1, counts.Games);
        Assert.Empty((await browser.GetJsonAsync<HistoryPageDto>("/api/user/history")).Items);
    }

    [Fact]
    public async Task StartOver_WithAPendingImport_SelectsAgainTheRowsSkippedForTheLibraryAndNoOthers()
    {
        await api.CacheGamesAsync(Held, Fresh, Declined);
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("reimporter"));
        await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{Held}",
            new SetListEntryDto(ListStatusKeys.Finished))).ExpectAsync(HttpStatusCode.NoContent);

        // The upload skips the game already held, and its owner then declines one they do not hold.
        var job = await browser.UploadGrouveeAsync(Held, Fresh, Declined);
        var before = await browser.GetJsonAsync<ImportReviewDto>($"/api/import/jobs/{job.Id}");
        Assert.Equal(ImportDecisions.Skip, Row(before, Held).Decision);
        await (await browser.SendAsync(HttpMethod.Patch, $"/api/import/jobs/{job.Id}/rows",
            new ImportDecisionsDto([new ImportRowDecisionDto(Row(before, Declined).Id, ImportDecisions.Skip, null, null)])))
            .ExpectAsync(HttpStatusCode.NoContent);

        var stampedBefore = await JobUpdatedAtAsync(job.Id);

        var counts = await (await StartOverAsync(browser)).ReadAsync<StartOverResultDto>(HttpStatusCode.OK);

        Assert.Equal(1, counts.ImportRowsReselected);
        var after = await browser.GetJsonAsync<ImportReviewDto>($"/api/import/jobs/{job.Id}");
        Assert.Empty(after.TrackedGameIds);
        Assert.Equal(ImportDecisions.Import, Row(after, Held).Decision);
        Assert.Equal(ImportDecisions.Import, Row(after, Fresh).Decision);
        Assert.Equal(ImportDecisions.Skip, Row(after, Declined).Decision);

        // A decision saved on the job's behalf, so its pending window counts from it (ADR 0038).
        Assert.True(await JobUpdatedAtAsync(job.Id) > stampedBefore);

        // And it commits: the game comes back, from the file this time.
        await (await browser.SendAsync(HttpMethod.Post, $"/api/import/jobs/{job.Id}/commit"))
            .ExpectAsync(HttpStatusCode.OK);
        Assert.Equal(2, await StoredEntriesAsync(account.Id));
    }

    [Fact]
    public async Task StartOver_OnAPublicProfileWithAPublicReview_TakesTheReviewAndInvalidatesTheProfileAtThePace()
    {
        await api.CacheGamesAsync(Held);
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("withdrawer"));
        await (await browser.SendAsync(HttpMethod.Put, "/api/user/privacy",
            new UpdateProfileVisibilityDto(ProfileVisibility.Public))).ExpectAsync(HttpStatusCode.OK);
        await (await browser.SendAsync(HttpMethod.Put, $"/api/entries/{Held}/review",
            new ReviewInputDto("Worth every hour.", false, ReviewVisibility.Public, null))).ExpectAsync(HttpStatusCode.OK);
        var sent = api.Edge.Sent.Count;

        await (await StartOverAsync(browser)).ExpectAsync(HttpStatusCode.OK);

        await using (var db = api.Database())
            Assert.False(await db.Reviews.AnyAsync(r => r.UserId == account.Id));

        // The profile alone: it is still public, so the sitemap files keep listing it until their
        // window runs out, as they do a profile emptied a game at a time.
        var invalidation = Assert.Single(api.Edge.SentSince(sent));
        Assert.Equal("library emptied", invalidation.Reason);
        Assert.Equal([$"/u/{account.UserName}*"], invalidation.Paths);
        Assert.Equal(account.Id, invalidation.Account);
        Assert.False(invalidation.AtOnce);
    }

    [Fact]
    public async Task StartOver_OfALibraryAlreadyEmpty_SucceedsAndInvalidatesNothing()
    {
        // No game went, so no review could have: the DELETE's own count says so, and nothing can
        // overtake it.
        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("tidy"));
        await (await browser.SendAsync(HttpMethod.Put, "/api/user/privacy",
            new UpdateProfileVisibilityDto(ProfileVisibility.Public))).ExpectAsync(HttpStatusCode.OK);
        var sent = api.Edge.Sent.Count;

        var counts = await (await StartOverAsync(browser)).ReadAsync<StartOverResultDto>(HttpStatusCode.OK);

        Assert.Equal(new StartOverResultDto(0, 0, 0, 0), counts);
        Assert.Empty(api.Edge.SentSince(sent));
    }

    private static ImportReviewRowDto Row(ImportReviewDto review, int gameId) =>
        review.Rows.Single(row => row.GameId == gameId);

    private async Task<DateTimeOffset> JobUpdatedAtAsync(Guid jobId)
    {
        await using var db = api.Database();
        return await db.ImportJobs.AsNoTracking().Where(j => j.Id == jobId).Select(j => j.UpdatedAt).SingleAsync();
    }
}
