using System.Net;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// What a public profile counts and whether the sitemap lists it, written through the API and read
/// back from PostgreSQL, which runs <c>PublicProfileContent</c>'s subqueries as InMemory cannot (#346).
/// </summary>
/// <remarks>
/// One account, whose games each hold one thing only their owner sees, and then one thing the page
/// shows at a time: each branch of the query is then the one that moves the count. That each kind
/// counts, or does not, on its own is <c>PublicProfileContentTests</c>'.
/// </remarks>
public class PublicFiguresFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    private const int Noted = 2201;
    private const int Owned = 2202;
    private const int Tagged = 2203;
    private const int Reviewed = 2204;

    [Fact]
    public async Task PublicProfileAndSitemap_PrivateFieldsThenShownOnes_CountAndListOnlyWhatThePageShows()
    {
        await api.CacheGamesAsync(Noted, Owned, Tagged, Reviewed);
        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("keeper"));

        async Task Write(HttpMethod method, string path, object? body = null)
        {
            var response = await browser.SendAsync(method, path, body);
            if (response.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.NoContent or HttpStatusCode.Created))
                await response.ExpectAsync(HttpStatusCode.OK);
        }

        await Write(HttpMethod.Put, "/api/user/privacy", new UpdateProfileVisibilityDto(ProfileVisibility.Public));

        // Four games, each holding one thing nobody but its owner sees.
        await Write(HttpMethod.Put, $"/api/entries/{Noted}/notes", new SetNotesDto("Lent to Sam."));
        await Write(HttpMethod.Put, $"/api/entries/{Owned}/ownership", new SetOwnershipDto(OwnershipKinds.Owned));
        var tag = await (await browser.SendAsync(HttpMethod.Post, "/api/tags", new TagNameDto("co-op")))
            .ReadAsync<TagDto>(HttpStatusCode.Created);
        await Write(HttpMethod.Put, $"/api/entries/{Tagged}/tags", new SetEntryTagsDto([tag.Id]));
        await Write(HttpMethod.Put, $"/api/entries/{Reviewed}/review",
            new ReviewInputDto("For me.", false, ReviewVisibility.Private, null));

        using var stranger = api.CreateBrowser();

        async Task<(int Recorded, bool Listed, bool InSitemap)> PublishedAsync()
        {
            var profile = await stranger.GetJsonAsync<PublicProfileDto>($"/api/users/{account.PublicId}");
            var sitemap = await stranger.GetJsonAsync<List<SitemapProfileDto>>("/api/sitemap/profiles");
            return (profile.Library.Recorded, profile.Listed, sitemap.Any(p => p.PublicId == account.PublicId));
        }

        // Nothing on the page, and nothing in the sitemap: four private acts moved no public figure.
        Assert.Equal((0, false, false), await PublishedAsync());

        // The owner's own page still counts all four.
        var stats = await browser.GetJsonAsync<UserStatsDto>("/api/user/stats");
        Assert.Equal(4, stats.Library.Recorded);

        // Each thing the page shows counts its game, one branch of the query at a time.
        await Write(HttpMethod.Put, $"/api/entries/{Noted}/score", new SetScoreDto(7));
        Assert.Equal((1, true, true), await PublishedAsync());

        await Write(HttpMethod.Post, $"/api/entries/{Owned}/playthroughs",
            new PlaythroughInputDto(null, null, null, null, null, null));
        Assert.Equal((2, true, true), await PublishedAsync());

        await Write(HttpMethod.Put, $"/api/lists/{Tagged}", new SetListEntryDto(ListStatusKeys.Backlog));
        Assert.Equal((3, true, true), await PublishedAsync());

        await Write(HttpMethod.Put, $"/api/entries/{Reviewed}/review",
            new ReviewInputDto("For everyone.", false, ReviewVisibility.Public, null));
        Assert.Equal((4, true, true), await PublishedAsync());

        // An admin hides the review: it is published nowhere, so its game holds nothing shown again
        // (ADR 0076). Written straight to the row, since the moderation flow is not what is under test.
        await using (var db = api.Database())
        {
            await db.Reviews
                .Where(r => r.UserId == account.Id)
                .ExecuteUpdateAsync(set => set.SetProperty(r => r.HiddenAt, DateTimeOffset.UtcNow));
        }

        Assert.Equal((3, true, true), await PublishedAsync());
    }
}
