using System.Net;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// Adding a game, moving it and taking it out, read back the two ways a user can: the lists, and
/// the event log as the export carries it (ADR 0018, 0019).
/// </summary>
public class ListFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task SetListEntry_AddedThenMoved_ListsTheGameWhereItEndedAndLogsEveryMoveInOrder()
    {
        const int gameId = 1942;
        await api.CacheGamesAsync(gameId);
        var igdb = api.Igdb.Calls.Count;

        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("player"));

        // Playing twice: a move to the status a game already holds is not a transition and must
        // record nothing (ADR 0018), however it arrives — a second tab, a retried request.
        foreach (var status in new[]
                 { ListStatusKeys.Backlog, ListStatusKeys.Playing, ListStatusKeys.Playing, ListStatusKeys.Finished })
        {
            var move = await browser.SendAsync(HttpMethod.Put, $"/api/lists/{gameId}", new SetListEntryDto(status));
            await move.ExpectAsync(HttpStatusCode.NoContent);
        }

        var lists = await browser.GetJsonAsync<ListsDto>("/api/lists");
        var listed = Assert.Single(lists.Lists[ListStatusKeys.Finished]);
        Assert.Equal(gameId, listed.Game.Id);
        Assert.Equal("Game 1942", listed.Game.Title);
        Assert.All(
            lists.Lists.Where(list => list.Key != ListStatusKeys.Finished),
            list => Assert.Empty(list.Value));

        var export = await browser.GetJsonAsync<UserDataExportDto>("/api/user/export");
        Assert.Equal(
            [
                (null, ListStatusKeys.Backlog),
                (ListStatusKeys.Backlog, ListStatusKeys.Playing),
                (ListStatusKeys.Playing, ListStatusKeys.Finished),
            ],
            export.Events.Select(e => (e.FromStatus, e.ToStatus)));
        Assert.All(export.Events, e => Assert.Equal(gameId, e.GameId));
        Assert.Equal(ListStatusKeys.Finished, Assert.Single(export.Entries).Status);

        // The list rendered from CachedGames and the export reads only our own tables, so neither
        // asked IGDB anything (ADR 0035, 0024).
        Assert.Empty(api.Igdb.CallsSince(igdb));
    }

    [Fact]
    public async Task RemoveListEntry_FromAScoredEntry_LogsTheDepartureAndKeepsTheScore()
    {
        const int gameId = 7346;
        await api.CacheGamesAsync(gameId);

        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("remover"));

        await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{gameId}",
            new SetListEntryDto(ListStatusKeys.Backlog))).ExpectAsync(HttpStatusCode.NoContent);
        await (await browser.SendAsync(HttpMethod.Put, $"/api/entries/{gameId}/score",
            new SetScoreDto(8))).ExpectAsync(HttpStatusCode.NoContent);

        var removal = await browser.SendAsync(HttpMethod.Delete, $"/api/lists/{gameId}");
        await removal.ExpectAsync(HttpStatusCode.NoContent);

        var lists = await browser.GetJsonAsync<ListsDto>("/api/lists");
        Assert.All(lists.Lists, list => Assert.Empty(list.Value));

        // Leaving every list is a move with no destination, and the entry outlives it with the
        // judgement on it intact (ADR 0019).
        var export = await browser.GetJsonAsync<UserDataExportDto>("/api/user/export");
        Assert.Equal(
            [(null, ListStatusKeys.Backlog), (ListStatusKeys.Backlog, null)],
            export.Events.Select(e => (e.FromStatus, e.ToStatus)));
        var entry = Assert.Single(export.Entries);
        Assert.Null(entry.Status);
        Assert.Equal(8, entry.Score);
    }

    [Fact]
    public async Task GetLists_WhileIgdbIsDown_RendersTheCachedCopyHoweverOld()
    {
        // The promise ADR 0035 exists for: a row past its refresh interval is asked about again,
        // IGDB does not answer, and the shelf is served from what was stored rather than failing.
        // Over a year old, so a cap on how stale a row may be served would fail this too.
        const int gameId = 26226;
        await api.CacheGamesAsync(gameId);

        await using (var db = api.Database())
        {
            await db.CachedGames
                .Where(game => game.GameId == gameId)
                .ExecuteUpdateAsync(set => set.SetProperty(
                    game => game.RefreshedAt, DateTimeOffset.UtcNow.AddDays(-400)));
        }

        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("stale"));
        await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{gameId}",
            new SetListEntryDto(ListStatusKeys.Playing))).ExpectAsync(HttpStatusCode.NoContent);

        var igdb = api.Igdb.Calls.Count;
        var lists = await browser.GetJsonAsync<ListsDto>("/api/lists");

        Assert.Equal("Game 26226", Assert.Single(lists.Lists[ListStatusKeys.Playing]).Game.Title);
        Assert.Equal(["GetGamesByIdsAsync"], api.Igdb.CallsSince(igdb));
    }
}
