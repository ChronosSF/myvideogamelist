using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// Adding a game, moving it and taking it out, read back the two ways a user can: the lists, and
/// the event log as the export carries it (ADR 0018, 0019). And a move of several games at once,
/// saved when a row it was about to write is deleted underneath it (ADR 0055).
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
            await move.ExpectAsync(HttpStatusCode.OK);
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
            new SetListEntryDto(ListStatusKeys.Backlog))).ExpectAsync(HttpStatusCode.OK);
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
            new SetListEntryDto(ListStatusKeys.Playing))).ExpectAsync(HttpStatusCode.OK);

        var igdb = api.Igdb.Calls.Count;
        var lists = await browser.GetJsonAsync<ListsDto>("/api/lists");

        Assert.Equal("Game 26226", Assert.Single(lists.Lists[ListStatusKeys.Playing]).Game.Title);
        Assert.Equal(["GetGamesByIdsAsync"], api.Igdb.CallsSince(igdb));
    }

    /// <remarks>
    /// The unit suite can only imitate this race: the in-memory provider has no transaction to roll
    /// back and keeps the inserts of a save that failed, so a retry there would meet the first
    /// attempt's events. Here the first save is undone whole, which is what lets the retry record each
    /// move once.
    /// </remarks>
    [Fact]
    public async Task SetStatusesAsync_ARowDeletedBetweenItsReadAndItsSave_AnswersItMissingAndMovesTheRestOnce()
    {
        int[] games = [5501, 5502, 5503];
        await api.CacheGamesAsync(games);

        using var browser = api.CreateBrowser();
        var user = await browser.RegisterAsync(Browsers.NewUserName("batcher"));
        foreach (var game in games)
        {
            await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{game}",
                new SetListEntryDto(ListStatusKeys.Backlog))).ExpectAsync(HttpStatusCode.OK);
        }

        // One game's row, deleted through another connection once the batch has read it and is about
        // to save, as "delete my data" in another tab would take it. The save sends the other two
        // changes and all three events inside its transaction before it learns that this row is gone.
        var deleted = games[1];
        int? eventsWhenTheRetryBegan = null;
        var saves = new BeforeEachSave(async save =>
        {
            await using var other = api.Database();

            if (save == 1)
            {
                await other.UserGameEntries
                    .Where(entry => entry.UserId == user.Id && entry.GameId == deleted)
                    .ExecuteDeleteAsync();
            }
            else
            {
                eventsWhenTheRetryBegan = await other.UserGameEvents.CountAsync(e => e.UserId == user.Id);
            }
        });

        await using var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseNpgsql(api.ConnectionString)
            .AddInterceptors(saves)
            .Options);

        // The application's own service and collaborators, over the context that lets the row go.
        await using var scope = api.Services.CreateAsyncScope();
        var listService = ActivatorUtilities.CreateInstance<ListService>(scope.ServiceProvider, db);

        var results = await listService.SetStatusesAsync(user.Id, games, ListStatusKeys.Finished);

        Assert.Equal(
            [
                (games[0], StatusChangeOutcomes.Moved),
                (deleted, StatusChangeOutcomes.Missing),
                (games[2], StatusChangeOutcomes.Moved),
            ],
            results.Select(result => (result.GameId, result.Outcome)));
        Assert.Equal(2, saves.Saves);

        // The first save was rolled back whole: when the second began, the log held the three arrivals
        // in the backlog and nothing of it, so each move to Finished below is the retry's.
        Assert.Equal(3, eventsWhenTheRetryBegan);

        // One move for each game that moved, none twice, and none for the game whose row went. Its
        // arrival stays, since an event holds no key to the entry it was about.
        var export = await browser.GetJsonAsync<UserDataExportDto>("/api/user/export");
        Assert.Equal(
            [(games[0], ListStatusKeys.Finished), (games[2], ListStatusKeys.Finished)],
            export.Entries.OrderBy(entry => entry.GameId).Select(entry => (entry.GameId, entry.Status)));
        Assert.Equal(
            [
                (games[0], null, ListStatusKeys.Backlog),
                (games[0], ListStatusKeys.Backlog, ListStatusKeys.Finished),
                (deleted, null, ListStatusKeys.Backlog),
                (games[2], null, ListStatusKeys.Backlog),
                (games[2], ListStatusKeys.Backlog, ListStatusKeys.Finished),
            ],
            export.Events.OrderBy(e => e.GameId).Select(e => (e.GameId, e.FromStatus, e.ToStatus)));
    }
}
