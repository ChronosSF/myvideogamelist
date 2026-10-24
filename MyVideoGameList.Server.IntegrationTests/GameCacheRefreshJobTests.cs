using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The background refresh of <c>CachedGames</c>, a tick at a time, against PostgreSQL: the advisory
/// lock, the commit that keeps an answer a shutdown arrived after, and a write the database refuses
/// — what the in-memory provider cannot run, so ADR 0052 could first only verify it by hand.
/// </summary>
/// <remarks>
/// <para>
/// Through <c>RunOnceAsync</c>, the tick the host's loop runs, over a context configured as
/// <c>Program.cs</c> configures one. IGDB is <see cref="AnsweringIgdb"/>. The factory removes the
/// application's own refresh, so nothing else writes these rows, and the class's one database is
/// emptied of cached games before each test.
/// </para>
/// <para>
/// Not covered, as for the sweep: the execution strategy, which never retries until
/// <c>Program.cs</c> configures one that does, and the hourly warning, which a task gives only after
/// two hours of running.
/// </para>
/// </remarks>
public sealed class GameCacheRefreshJobTests(ApiFactory api) : IClassFixture<ApiFactory>, IAsyncLifetime
{
    private readonly ServiceProvider scopes = new ServiceCollection()
        .AddDbContext<ApplicationDbContext>(options => options.UseNpgsql(api.ConnectionString))
        .BuildServiceProvider();

    private readonly RecordingLogger<GameCacheRefreshService> log = new();

    public async Task InitializeAsync()
    {
        await using var db = api.Database();
        await db.CachedGames.ExecuteDeleteAsync();
    }

    public async Task DisposeAsync() => await scopes.DisposeAsync();

    [Fact]
    public async Task Tick_WhileAnotherSessionHoldsItsLock_AsksIgdbNothingUntilItIsReleased()
    {
        // ADR 0052 §4: the lock is what stops two tasks paying IGDB for the same rows. Held here from
        // a session of its own, as another task's tick would hold it.
        await SeedAsync(Row(1, "Hades", age: TimeSpan.FromDays(2)));
        var igdb = new AnsweringIgdb(ids => ids.Select(id => ApiFactory.Game(id) with { Title = "Hades II" }).ToList());
        var refresh = NewRefresh(igdb);

        await using (await AdvisoryLockHolder.TakeAsync(api.ConnectionString, GameCacheRefreshService.LockKey))
        {
            await refresh.RunOnceAsync(CancellationToken.None);

            Assert.Equal(0, igdb.Calls);
            Assert.Equal("Hades", await TitleOfAsync(1));
            Assert.Contains(log.Entries, entry => entry.Message.Contains("skipped a tick"));
        }

        // Released before the block ends, as another task's is by the time its commit returns.
        await refresh.RunOnceAsync(CancellationToken.None);

        Assert.Equal(1, igdb.Calls);
        Assert.Equal("Hades II", await TitleOfAsync(1));
        Assert.DoesNotContain(log.Entries, entry => entry.Level >= LogLevel.Warning);
    }

    [Fact]
    public async Task Tick_StoppedTheMomentIgdbAnswers_StillCommitsTheAnswer()
    {
        // #96's rule, ADR 0052 §5: once IGDB has answered, the save and the commit run on
        // CancellationToken.None. On the stopping token Npgsql refuses to send the COMMIT, as
        // ImportRetentionSweepTests found for the sweep, and the answer already paid for would roll
        // back to be asked for again.
        await SeedAsync(Row(1, "Hades", age: TimeSpan.FromDays(2)));
        using var stopping = new CancellationTokenSource();
        var igdb = new AnsweringIgdb(_ =>
        {
            stopping.Cancel();
            return [ApiFactory.Game(1) with { Title = "Hades II" }];
        });

        try
        {
            await NewRefresh(igdb).RunOnceAsync(stopping.Token);
        }
        catch (OperationCanceledException)
        {
            // What runs after the commit — the count of what is overdue — stops on the token, and the
            // tick with it. That is the host stopping, not the batch failing.
        }

        Assert.Equal("Hades II", await TitleOfAsync(1));
        Assert.DoesNotContain(log.Entries, entry => entry.Level >= LogLevel.Warning);
    }

    [Fact]
    public async Task Tick_ABatchTheDatabaseRefuses_IsHeldBackAndTheNextBatchRefreshes()
    {
        // Copilot's review of #256: a title longer than CachedGames.Title's 512 characters passes the
        // mapping and fails the save. The transaction rolls back unwritten, so without the hold-back
        // that batch would be the oldest thing due on every tick, failing each time, and nothing
        // behind it would ever be refreshed.
        await SeedAsync(
            Row(1, "Too long", age: TimeSpan.FromDays(3)),
            Row(2, "Hades", age: TimeSpan.FromDays(2)));
        var igdb = new AnsweringIgdb(ids => ids
            .Select(id => ApiFactory.Game(id) with { Title = id == 1 ? new string('x', 513) : "Hades II" })
            .ToList());
        var refresh = NewRefresh(igdb, batchSize: 1);

        await refresh.RunOnceAsync(CancellationToken.None);
        await refresh.RunOnceAsync(CancellationToken.None);

        Assert.Equal("Too long", await TitleOfAsync(1));
        Assert.Equal("Hades II", await TitleOfAsync(2));
        Assert.Contains(log.Entries, entry => entry.Level == LogLevel.Error
            && entry.Message.StartsWith("The database refused", StringComparison.Ordinal)
            && entry.Message.EndsWith(": 1.", StringComparison.Ordinal));
    }

    private GameCacheRefreshService NewRefresh(AnsweringIgdb igdb, int batchSize = 50) =>
        new(
            scopes.GetRequiredService<IServiceScopeFactory>(),
            igdb.Service,
            Options.Create(new GameCacheRefreshOptions { BatchSize = batchSize }),
            TimeProvider.System,
            log);

    /// <summary>A cached game last refreshed <paramref name="age"/> ago, so already due.</summary>
    private static CachedGame Row(int id, string title, TimeSpan age) =>
        new()
        {
            GameId = id,
            Payload = $"{{\"id\":{id},\"title\":\"{title}\"}}",
            Title = title,
            RefreshedAt = DateTimeOffset.UtcNow - age
        };

    private async Task SeedAsync(params CachedGame[] rows)
    {
        await using var db = api.Database();
        db.CachedGames.AddRange(rows);
        await db.SaveChangesAsync();
    }

    private async Task<string?> TitleOfAsync(int id)
    {
        await using var db = api.Database();
        return (await db.CachedGames.SingleAsync(game => game.GameId == id)).Title;
    }
}
