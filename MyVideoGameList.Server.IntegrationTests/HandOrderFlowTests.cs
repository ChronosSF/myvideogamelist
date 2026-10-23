using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using Npgsql;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The backlog's hand-arranged order (ADR 0054): written through the API and read back the two ways a
/// user can, held to its range by the database itself, and saved when a row it was about to write is
/// deleted underneath it.
/// </summary>
/// <remarks>
/// The unit suite runs the same rules on the in-memory provider, which checks no constraint and has no
/// transaction to roll back, so the last two are seen holding only here.
/// </remarks>
public class HandOrderFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task SetPositions_OnTheBacklog_ListsAndExportsThemAndPassesOverAGameInAnotherList()
    {
        const int first = 3301, second = 3302, elsewhere = 3303;
        await api.CacheGamesAsync(first, second, elsewhere);

        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("arranger"));
        await PutAsync(browser, first, ListStatusKeys.Backlog);
        await PutAsync(browser, second, ListStatusKeys.Backlog);
        await PutAsync(browser, elsewhere, ListStatusKeys.Playing);

        // The game added second goes first: a place is the number the client chose, stored as sent.
        // The third is not in the backlog, so it is passed over rather than placed or refused — it was
        // there when the client last looked, and has moved since.
        await (await PlaceAsync(browser, ListStatusKeys.Backlog, (second, 1024), (first, 2048), (elsewhere, 3072)))
            .ExpectAsync(HttpStatusCode.NoContent);

        var lists = await browser.GetJsonAsync<ListsDto>("/api/lists");
        Assert.Equal(
            [(first, 2048), (second, 1024)],
            lists.Lists[ListStatusKeys.Backlog]
                .OrderBy(entry => entry.Game.Id)
                .Select(entry => (entry.Game.Id, entry.Position)));
        Assert.Null(Assert.Single(lists.Lists[ListStatusKeys.Playing]).Position);

        // The export carries the number as stored, a game never placed as null (ADR 0024).
        var export = await browser.GetJsonAsync<UserDataExportDto>("/api/user/export");
        Assert.Equal(
            [(first, 2048), (second, 1024), (elsewhere, null)],
            export.Entries.OrderBy(entry => entry.GameId).Select(entry => (entry.GameId, entry.Position)));
    }

    [Fact]
    public async Task SetListEntry_APlacedGameMovedOutAndBack_ComesBackUnplaced()
    {
        const int leaving = 3311, staying = 3312;
        await api.CacheGamesAsync(leaving, staying);

        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("wanderer"));
        await PutAsync(browser, leaving, ListStatusKeys.Backlog);
        await PutAsync(browser, staying, ListStatusKeys.Backlog);
        await (await PlaceAsync(browser, ListStatusKeys.Backlog, (leaving, 1024), (staying, 2048)))
            .ExpectAsync(HttpStatusCode.NoContent);

        // A place belongs to the list the game is in now, so the move out clears it, and the move back
        // does not restore it.
        await PutAsync(browser, leaving, ListStatusKeys.Playing);
        var playing = (await browser.GetJsonAsync<ListsDto>("/api/lists")).Lists[ListStatusKeys.Playing];
        Assert.Null(Assert.Single(playing).Position);

        await PutAsync(browser, leaving, ListStatusKeys.Backlog);
        var backlog = (await browser.GetJsonAsync<ListsDto>("/api/lists")).Lists[ListStatusKeys.Backlog];
        Assert.Equal(
            [(leaving, null), (staying, 2048)],
            backlog.OrderBy(entry => entry.Game.Id).Select(entry => (entry.Game.Id, entry.Position)));
    }

    /// <remarks>
    /// In order: a list that is not one of the five, refused by the route; a position one past
    /// <see cref="HandOrder.MaxPosition"/>; a write of nothing; and a null among the positions, which
    /// reached the store as a 500 until the DTO refused it. The last is refused by
    /// <see cref="SetPositionsDto"/>'s <c>Validate</c>, and whether a request reaches that depends on
    /// how MVC validates a body, which the unit test's <c>Validator</c> only imitates.
    /// </remarks>
    [Theory]
    [InlineData("wishlist", """{"positions":[{"gameId":3321,"position":1024}]}""")]
    [InlineData(ListStatusKeys.Backlog, """{"positions":[{"gameId":3321,"position":1000000001}]}""")]
    [InlineData(ListStatusKeys.Backlog, """{"positions":[]}""")]
    [InlineData(ListStatusKeys.Backlog, """{"positions":[null]}""")]
    public async Task SetPositions_ARequestOutsideTheContract_IsA400AndPlacesNothing(string list, string body)
    {
        const int gameId = 3321;
        await api.CacheGamesAsync(gameId);

        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("refused"));
        await PutAsync(browser, gameId, ListStatusKeys.Backlog);

        using var request = new HttpRequestMessage(HttpMethod.Patch, $"/api/lists/{list}/positions")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        await (await browser.SendAsync(request)).ExpectAsync(HttpStatusCode.BadRequest);

        var backlog = (await browser.GetJsonAsync<ListsDto>("/api/lists")).Lists[ListStatusKeys.Backlog];
        Assert.Null(Assert.Single(backlog).Position);
    }

    /// <remarks>
    /// Behind the API's back, as any writer but the endpoint would be: the DTO refuses these before
    /// the database sees them, and the constraint is what holds every other path to the same bounds,
    /// which keep the sum or difference of any two stored positions inside an <c>int</c>.
    /// </remarks>
    [Theory]
    [InlineData(HandOrder.MaxPosition + 1)]
    [InlineData(HandOrder.MinPosition - 1)]
    public async Task CheckConstraint_APositionPastEitherBound_IsRefusedByTheDatabase(int position)
    {
        const int gameId = 3331;
        var userId = await OneGameInTheBacklogAsync(gameId);

        await using var db = api.Database();
        var entry = db.UserGameEntries.Where(e => e.UserId == userId && e.GameId == gameId);

        var refused = await Assert.ThrowsAsync<PostgresException>(() =>
            entry.ExecuteUpdateAsync(set => set.SetProperty(e => e.Position, position)));
        Assert.Equal(PostgresErrorCodes.CheckViolation, refused.SqlState);
        Assert.Equal("CK_UserGameEntries_Position_Range", refused.ConstraintName);
        Assert.Null(await entry.Select(e => e.Position).SingleAsync());
    }

    [Theory]
    [InlineData(HandOrder.MinPosition)]
    [InlineData(HandOrder.MaxPosition)]
    [InlineData(null)]
    public async Task CheckConstraint_APositionAtEitherBoundOrNone_IsStored(int? position)
    {
        const int gameId = 3332;
        var userId = await OneGameInTheBacklogAsync(gameId);

        await using var db = api.Database();
        var entry = db.UserGameEntries.Where(e => e.UserId == userId && e.GameId == gameId);

        // From a number, so the null case is a write that clears rather than one that never happened.
        await entry.ExecuteUpdateAsync(set => set.SetProperty(e => e.Position, HandOrder.Step));
        await entry.ExecuteUpdateAsync(set => set.SetProperty(e => e.Position, position));

        Assert.Equal(position, await entry.Select(e => e.Position).SingleAsync());
    }

    [Fact]
    public async Task WriteAsync_ARowDeletedBetweenItsReadAndItsSave_RollsTheSaveBackAndRetriesWithoutIt()
    {
        int[] games = [3341, 3342, 3343];
        await api.CacheGamesAsync(games);

        using var browser = api.CreateBrowser();
        var user = await browser.RegisterAsync(Browsers.NewUserName("racer"));
        foreach (var game in games) await PutAsync(browser, game, ListStatusKeys.Backlog);

        // One game's row, deleted through another connection once the store has read it and is about
        // to save, as an account deleted mid-request would take it. The save's other two UPDATEs are
        // made inside its transaction before it learns that this one found nothing.
        var deleted = games[^1];
        IReadOnlyList<int?>? whenTheRetryBegan = null;
        var saves = new BeforeEachSave(async save =>
        {
            await using var other = api.Database();
            var mine = other.UserGameEntries.Where(entry => entry.UserId == user.Id);

            if (save == 1)
                await mine.Where(entry => entry.GameId == deleted).ExecuteDeleteAsync();
            else
                whenTheRetryBegan = await mine.OrderBy(entry => entry.GameId).Select(entry => entry.Position).ToListAsync();
        });

        await using var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseNpgsql(api.ConnectionString)
            .AddInterceptors(saves)
            .Options);

        var backlog = await db.ListStatuses
            .Where(status => status.Key == ListStatusKeys.Backlog)
            .Select(status => status.Id)
            .SingleAsync();

        var written = await HandOrderStore.WriteAsync(
            db,
            db.UserGameEntries.Where(entry => entry.StatusId == backlog),
            user.Id,
            [new PositionDto(games[0], 1024), new PositionDto(games[1], 2048), new PositionDto(deleted, 3072)],
            CancellationToken.None);

        Assert.Equal(2, written);
        Assert.Equal(2, saves.Saves);

        // The first save was rolled back whole: the two rows it had updated were still unplaced when
        // the second began, so it is the retry that placed them.
        Assert.Equal([null, null], whenTheRetryBegan);

        await using var after = api.Database();
        var stored = await after.UserGameEntries
            .Where(entry => entry.UserId == user.Id)
            .OrderBy(entry => entry.GameId)
            .Select(entry => new { entry.GameId, entry.Position })
            .ToListAsync();
        Assert.Equal([(games[0], 1024), (games[1], 2048)], stored.Select(entry => (entry.GameId, entry.Position)));
    }

    private static async Task PutAsync(HttpClient browser, int gameId, string status) =>
        await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{gameId}", new SetListEntryDto(status)))
            .ExpectAsync(HttpStatusCode.OK);

    private static Task<HttpResponseMessage> PlaceAsync(
        HttpClient browser, string list, params (int GameId, int Position)[] positions) =>
        browser.SendAsync(
            HttpMethod.Patch,
            $"/api/lists/{list}/positions",
            new SetPositionsDto([.. positions.Select(place => new PositionDto(place.GameId, place.Position))]));

    /// <summary>A new account with one game in its backlog, never placed; returns the account's id.</summary>
    private async Task<string> OneGameInTheBacklogAsync(int gameId)
    {
        await api.CacheGamesAsync(gameId);

        using var browser = api.CreateBrowser();
        var user = await browser.RegisterAsync(Browsers.NewUserName("bounded"));
        await PutAsync(browser, gameId, ListStatusKeys.Backlog);
        return user.Id;
    }
}
