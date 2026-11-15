using System.Diagnostics;
using System.Net;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using Npgsql;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The yes to a move's question, against PostgreSQL: a start makes no second unfinished run however
/// many arrive at once, and a finish finishes one run once (ADR 0097).
/// </summary>
/// <remarks>
/// The guard is a row lock on the game's entry, which the in-memory provider has no notion of, so the
/// unit tests run the decisions and this runs the waiting. The first test holds the lock from a session
/// of its own and shows the start queue behind it and then see what that session committed, which is
/// the whole of the guarantee and does not depend on two requests happening to overlap.
/// </remarks>
public class PlaythroughStartFlowTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    private static readonly DateOnly Day = new(2026, 11, 15);

    [Fact]
    public async Task StartPlaythrough_WhileAnotherSessionHoldsTheEntryAndStartsARun_WaitsAndThenStartsNothing()
    {
        const int gameId = 3101;
        await api.CacheGamesAsync(gameId);

        using var browser = api.CreateBrowser();
        var account = await browser.RegisterAsync(Browsers.NewUserName("waiter"));

        var move = await browser.SendAsync(HttpMethod.Put, $"/api/lists/{gameId}", new SetListEntryDto(ListStatusKeys.Playing));
        var answer = await move.ReadAsync<ListMoveDto>(HttpStatusCode.OK);
        Assert.True(answer.Moved);
        Assert.Null(answer.UnfinishedPlaythrough);

        // Another request's transaction, holding the entry as a start does, which this test ends itself.
        await using var holder = await OpenAsync(api.ConnectionString);
        await using var held = await holder.BeginTransactionAsync();
        await using (var lockEntry = new NpgsqlCommand(
            """SELECT 1 FROM "UserGameEntries" WHERE "UserId" = @user AND "GameId" = @game FOR UPDATE""",
            holder, held))
        {
            lockEntry.Parameters.AddWithValue("user", account.Id);
            lockEntry.Parameters.AddWithValue("game", gameId);
            await lockEntry.ExecuteNonQueryAsync();
        }

        var starting = browser.SendAsync(
            HttpMethod.Post, $"/api/entries/{gameId}/playthroughs/start", new StartPlaythroughDto(Day));

        // It waits on the lock rather than checking and writing beside the holder.
        await SessionsWaitingForALockAsync(api.ConnectionString, 1);
        Assert.False(starting.IsCompleted);

        // The holder starts its own run and commits, as a start that got there first would.
        await using (var insert = new NpgsqlCommand(
            """
            INSERT INTO "UserGamePlaythroughs" ("UserId", "UserGameEntryId", "StartedOn", "CreatedAt", "UpdatedAt")
            SELECT "UserId", "Id", @day, now(), now() FROM "UserGameEntries" WHERE "UserId" = @user AND "GameId" = @game
            """,
            holder, held))
        {
            insert.Parameters.AddWithValue("day", Day);
            insert.Parameters.AddWithValue("user", account.Id);
            insert.Parameters.AddWithValue("game", gameId);
            Assert.Equal(1, await insert.ExecuteNonQueryAsync());
        }

        await held.CommitAsync();

        // The waiting start reads after the commit, finds that run, and starts none.
        await (await starting.WaitAsync(TimeSpan.FromSeconds(10))).ExpectAsync(HttpStatusCode.Conflict);

        var runs = await browser.GetJsonAsync<List<PlaythroughDto>>($"/api/entries/{gameId}/playthroughs");
        Assert.Null(Assert.Single(runs).FinishedOn);
    }

    [Fact]
    public async Task StartPlaythrough_SixAtOnce_StartsOneRunAndRefusesTheRest()
    {
        const int gameId = 3102;
        await api.CacheGamesAsync(gameId);

        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("eager"));
        await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{gameId}",
            new SetListEntryDto(ListStatusKeys.Playing))).ExpectAsync(HttpStatusCode.OK);

        // Six tabs answering yes to the same question in the same moment.
        var answers = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => browser.SendAsync(
            HttpMethod.Post, $"/api/entries/{gameId}/playthroughs/start", new StartPlaythroughDto(Day))));

        Assert.Equal(1, answers.Count(a => a.StatusCode == HttpStatusCode.Created));
        Assert.Equal(5, answers.Count(a => a.StatusCode == HttpStatusCode.Conflict));

        var run = Assert.Single(await browser.GetJsonAsync<List<PlaythroughDto>>($"/api/entries/{gameId}/playthroughs"));
        Assert.Equal(Day, run.StartedOn);
        Assert.Null(run.Type);
    }

    [Fact]
    public async Task FinishPlaythrough_AfterAMoveToFinished_FinishesTheRunTheMoveNamedOnce()
    {
        const int gameId = 3103;
        await api.CacheGamesAsync(gameId);

        using var browser = api.CreateBrowser();
        await browser.RegisterAsync(Browsers.NewUserName("finisher"));
        await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{gameId}",
            new SetListEntryDto(ListStatusKeys.Playing))).ExpectAsync(HttpStatusCode.OK);

        var started = await (await browser.SendAsync(HttpMethod.Post, $"/api/entries/{gameId}/playthroughs/start",
            new StartPlaythroughDto(new DateOnly(2026, 8, 2)))).ReadAsync<PlaythroughDto>(HttpStatusCode.Created);

        // The move to Finished names the run it would finish, and when it started.
        var answer = await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{gameId}",
            new SetListEntryDto(ListStatusKeys.Finished))).ReadAsync<ListMoveDto>(HttpStatusCode.OK);
        Assert.True(answer.Moved);
        Assert.Equal(new UnfinishedPlaythroughDto(started.Id, new DateOnly(2026, 8, 2)), answer.UnfinishedPlaythrough);

        // Two tabs say yes at once: one finishes it, and the other finds it finished.
        var finishes = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => browser.SendAsync(
            HttpMethod.Post, $"/api/entries/{gameId}/playthroughs/{started.Id}/finish", new FinishPlaythroughDto(Day))));
        Assert.Equal(1, finishes.Count(f => f.StatusCode == HttpStatusCode.OK));
        Assert.Equal(1, finishes.Count(f => f.StatusCode == HttpStatusCode.Conflict));

        var run = Assert.Single(await browser.GetJsonAsync<List<PlaythroughDto>>($"/api/entries/{gameId}/playthroughs"));
        Assert.Equal(Day, run.FinishedOn);

        // Back to Playing is a replay: nothing is unfinished, so the client asks to start another.
        var replay = await (await browser.SendAsync(HttpMethod.Put, $"/api/lists/{gameId}",
            new SetListEntryDto(ListStatusKeys.Playing))).ReadAsync<ListMoveDto>(HttpStatusCode.OK);
        Assert.True(replay.Moved);
        Assert.Null(replay.UnfinishedPlaythrough);

        // A run of another game, or nobody's, is not found under this one.
        await (await browser.SendAsync(HttpMethod.Post, $"/api/entries/{gameId}/playthroughs/{started.Id + 1000}/finish",
            new FinishPlaythroughDto(Day))).ExpectAsync(HttpStatusCode.NotFound);

        // The moves recorded their events and nothing else: the runs wrote none (ADR 0025 §4).
        var export = await browser.GetJsonAsync<UserDataExportDto>("/api/user/export");
        Assert.Equal(
            [
                (null, ListStatusKeys.Playing),
                (ListStatusKeys.Playing, ListStatusKeys.Finished),
                (ListStatusKeys.Finished, ListStatusKeys.Playing),
            ],
            export.Events.Select(e => (e.FromStatus, e.ToStatus)));
    }

    private static async Task<NpgsqlConnection> OpenAsync(string connectionString)
    {
        // Not pooled, so the session is this test's alone.
        var connection = new NpgsqlConnection(
            new NpgsqlConnectionStringBuilder(connectionString) { Pooling = false }.ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    /// <summary>
    /// Returns once <paramref name="count"/> sessions on this database are waiting for a lock, as
    /// <c>MigrationLockTests</c> waits, so the step that has to happen while they wait does not race them.
    /// </summary>
    private static async Task SessionsWaitingForALockAsync(string connectionString, int count)
    {
        await using var watcher = await OpenAsync(connectionString);
        await using var waiting = new NpgsqlCommand(
            """
            SELECT count(*) FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
            """,
            watcher);

        var deadline = Stopwatch.StartNew();
        while ((long)(await waiting.ExecuteScalarAsync())! < count)
        {
            if (deadline.Elapsed > TimeSpan.FromSeconds(10))
                throw new TimeoutException($"Fewer than {count} session(s) were waiting for a lock.");

            await Task.Delay(20);
        }
    }
}
