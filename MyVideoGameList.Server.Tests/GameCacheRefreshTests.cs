using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The background refresh of <c>CachedGames</c>: which rows it takes and how many, what it writes
/// onto them, what it says when it falls behind, and that a failing tick never reaches the host.
/// </summary>
/// <remarks>
/// <para>
/// The selection runs here as a query, exactly as the job runs it, rather than being restated as a
/// function of two dates — the reason <see cref="GameCacheRefresh"/>'s predicates are expressions,
/// as <c>ImportRetentionTests</c> explains for the sweep's.
/// </para>
/// <para>
/// What is deliberately <em>not</em> covered is the advisory lock and the commit around a batch:
/// <c>SqlQuery</c> and a real transaction need a relational provider, and these tests run on EF
/// InMemory. Everything inside them is <see cref="GameCacheRefreshService.RefreshDueAsync"/>, which
/// is covered; the lock was verified by hand against PostgreSQL, as the retention sweep's was
/// (ADR 0052).
/// </para>
/// </remarks>
public class GameCacheRefreshTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 15, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    /// <summary>Every line the service logs, so a test can say what it said.</summary>
    private sealed class ListLogger : ILogger<GameCacheRefreshService>
    {
        private readonly List<(LogLevel Level, string Message)> _entries = [];

        public IReadOnlyList<(LogLevel Level, string Message)> Entries
        {
            get { lock (_entries) return _entries.ToList(); }
        }

        public IReadOnlyList<string> At(LogLevel level) =>
            Entries.Where(entry => entry.Level == level).Select(entry => entry.Message).ToList();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            lock (_entries) _entries.Add((logLevel, formatter(state, exception)));
        }
    }

    private static ApplicationDbContext NewDb(string? name = null)
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(name ?? Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    /// <summary>
    /// A cached game last refreshed <paramref name="age"/> before <see cref="Now"/>; a null title
    /// makes it a tombstone.
    /// </summary>
    private static CachedGame Row(int id, TimeSpan age, string? title = "Game") =>
        new()
        {
            GameId = id,
            Payload = title is null ? null : $"{{\"id\":{id},\"title\":\"{title}\"}}",
            Title = title,
            RefreshedAt = Now - age
        };

    private static ApplicationDbContext WithRows(params CachedGame[] rows)
    {
        var db = NewDb();
        db.CachedGames.AddRange(rows);
        db.SaveChanges();
        db.ChangeTracker.Clear();
        return db;
    }

    private static GameDto Game(int id, string title) =>
        new(id, title, null, new DateOnly(2020, 1, 1), "cover.jpg", null, null, null, null,
            null, null, null, null,
            Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    /// <summary>An IGDB that knows exactly these games, and answers for any of them asked about.</summary>
    private static IIgdbService IgdbKnowing(params GameDto[] games)
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetGamesByIdsUncachedAsync(Arg.Any<IReadOnlyCollection<int>>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                var wanted = call.Arg<IReadOnlyCollection<int>>().ToHashSet();
                return Task.FromResult<IReadOnlyList<GameDto>>(games.Where(g => wanted.Contains(g.Id)).ToList());
            });
        return igdb;
    }

    private static GameCacheRefreshService NewService(
        IIgdbService? igdb = null,
        int batchSize = 50,
        TimeProvider? clock = null,
        ListLogger? logger = null,
        IServiceScopeFactory? scopes = null) =>
        new(
            scopes ?? Substitute.For<IServiceScopeFactory>(),
            igdb ?? IgdbKnowing(),
            Options.Create(new GameCacheRefreshOptions { BatchSize = batchSize }),
            clock ?? new FixedClock(Now),
            logger ?? new ListLogger());

    /// <summary>The ids the job would refresh now, in id order.</summary>
    private static List<int> Due(ApplicationDbContext db) =>
        db.CachedGames
            .Where(GameCacheRefresh.DueAt(Now))
            .Select(game => game.GameId)
            .OrderBy(id => id)
            .ToList();

    private static List<int> NextBatch(ApplicationDbContext db, int batchSize) =>
        GameCacheRefresh.NextBatch(db.CachedGames, Now, batchSize).Select(game => game.GameId).ToList();

    private static readonly TimeSpan Minute = TimeSpan.FromMinutes(1);

    // ── Which rows ────────────────────────────────────────────────────────────────────

    [Fact]
    public void DueAt_ARowPastTheLead_IsSelected()
    {
        using var db = WithRows(Row(1, GameCacheRefresh.DueAfter + Minute));

        Assert.Equal([1], Due(db));
    }

    [Fact]
    public void DueAt_ARowNotYetDue_IsLeftAlone()
    {
        using var db = WithRows(Row(1, GameCacheRefresh.DueAfter - Minute));

        Assert.Empty(Due(db));
    }

    [Fact]
    public void DueAt_ARowExactlyDue_IsSelected()
    {
        // "At or past", as the reader's own refresh reads its interval, so that the two thresholds
        // differ by the lead and nothing else.
        using var db = WithRows(Row(1, GameCacheRefresh.DueAfter));

        Assert.Equal([1], Due(db));
    }

    [Fact]
    public void DueAt_ATombstone_IsSelectedLikeAnyOtherRow()
    {
        // ADR 0035: a tombstone is a row too. "IGDB had no such game" is as perishable as any other
        // answer, and a game restored to IGDB comes back only by being asked about again.
        using var db = WithRows(Row(1, TimeSpan.FromDays(3), title: null));

        Assert.Equal([1], Due(db));
    }

    [Fact]
    public void DueAfter_IsBeforeAReaderWouldRefreshTheRow()
    {
        // The whole point of the job. A threshold at or past the reader's own would leave every
        // row to whoever arrived first after it, which is the round trip this exists to take off
        // them.
        Assert.True(GameCacheRefresh.DueAfter < GameCacheService.RefreshAfter);
        Assert.Equal(GameCacheService.RefreshAfter, GameCacheRefresh.DueAfter + GameCacheRefresh.Lead);
    }

    [Fact]
    public void OverdueAfter_IsAfterAReaderWouldRefreshTheRow()
    {
        // A row past the reader's own threshold is what a burst leaves for a while. Only one well past
        // it means the job is not reaching rows — the thing worth a warning.
        Assert.True(GameCacheRefresh.OverdueAfter > GameCacheService.RefreshAfter);
    }

    // ── How many, in what order ───────────────────────────────────────────────────────

    [Fact]
    public void NextBatch_TakesNoMoreThanTheBatchSize()
    {
        using var db = WithRows(
            Enumerable.Range(1, 60).Select(id => Row(id, TimeSpan.FromDays(2))).ToArray());

        Assert.Equal(50, NextBatch(db, 50).Count);
    }

    [Fact]
    public void NextBatch_TakesTheLongestWaitingFirst()
    {
        using var db = WithRows(
            Row(1, TimeSpan.FromHours(30)),
            Row(2, TimeSpan.FromHours(25)),
            Row(3, TimeSpan.FromHours(40)));

        Assert.Equal([3, 1, 2], NextBatch(db, 50));
    }

    [Fact]
    public void NextBatch_BreaksTiesOnTheId()
    {
        // Every row one request wrote shares one RefreshedAt, so without a tie-break Take would be
        // taking from an order the database is free to choose differently each time.
        using var db = WithRows(
            Row(9, TimeSpan.FromDays(2)),
            Row(3, TimeSpan.FromDays(2)),
            Row(6, TimeSpan.FromDays(2)));

        Assert.Equal([3, 6], NextBatch(db, 2));
    }

    [Fact]
    public void NextBatch_LeavesOutRowsThatAreNotDue()
    {
        using var db = WithRows(
            Row(1, TimeSpan.FromDays(2)),
            Row(2, TimeSpan.FromHours(1)),
            Row(3, GameCacheRefresh.DueAfter));

        Assert.Equal([1, 3], NextBatch(db, 50));
    }

    // ── What a batch writes ───────────────────────────────────────────────────────────

    [Fact]
    public async Task RefreshDueAsync_RewritesEachDueRowWithIgdbsAnswer()
    {
        using var db = WithRows(
            Row(1, TimeSpan.FromDays(2), "Hades"),
            Row(2, TimeSpan.FromHours(1), "Celeste"));
        var igdb = IgdbKnowing(Game(1, "Hades II"), Game(2, "Celeste (renamed)"));

        var batch = await NewService(igdb).RefreshDueAsync(db, Now, CancellationToken.None);

        var rows = await db.CachedGames.AsNoTracking().OrderBy(g => g.GameId).ToListAsync();

        // The due row carries the new answer and the time it arrived; the other was not asked about.
        Assert.Equal("Hades II", rows[0].Title);
        Assert.Contains("Hades II", rows[0].Payload);
        Assert.Equal(Now, rows[0].RefreshedAt);

        Assert.Equal("Celeste", rows[1].Title);
        Assert.Equal(Now - TimeSpan.FromHours(1), rows[1].RefreshedAt);

        Assert.Equal(1, batch.Asked);
        Assert.True(batch.Answered);
        Assert.Equal(0, batch.Tombstones);
    }

    [Fact]
    public async Task RefreshDueAsync_AGameIgdbNoLongerHas_BecomesATombstone()
    {
        using var db = WithRows(Row(1, TimeSpan.FromDays(2), "Withdrawn"));

        var batch = await NewService(IgdbKnowing()).RefreshDueAsync(db, Now, CancellationToken.None);

        var row = await db.CachedGames.AsNoTracking().SingleAsync();
        Assert.Null(row.Payload);
        Assert.Null(row.Title);
        Assert.Equal(Now, row.RefreshedAt);
        Assert.Equal(1, batch.Tombstones);
    }

    [Fact]
    public async Task RefreshDueAsync_ATombstoneIgdbAnswersAgain_ComesBackToLife()
    {
        using var db = WithRows(Row(1, TimeSpan.FromDays(2), title: null));

        await NewService(IgdbKnowing(Game(1, "Restored"))).RefreshDueAsync(db, Now, CancellationToken.None);

        var row = await db.CachedGames.AsNoTracking().SingleAsync();
        Assert.Equal("Restored", row.Title);
        Assert.NotNull(row.Payload);
    }

    [Fact]
    public async Task RefreshDueAsync_AsksIgdbOnceForTheOldestBatch()
    {
        // The batch is the pace: one request carrying at most the batch size, whatever is waiting.
        using var db = WithRows(
            Enumerable.Range(1, 60).Select(id => Row(id, TimeSpan.FromHours(24 + id))).ToArray());
        var igdb = IgdbKnowing();

        await NewService(igdb, batchSize: 50).RefreshDueAsync(db, Now, CancellationToken.None);

        var oldest = Enumerable.Range(11, 50).ToHashSet();
        await igdb.Received(1).GetGamesByIdsUncachedAsync(
            Arg.Is<IReadOnlyCollection<int>>(ids => ids.Count == 50 && ids.ToHashSet().SetEquals(oldest)),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task RefreshDueAsync_WithNothingDue_AsksIgdbNothing()
    {
        using var db = WithRows(Row(1, TimeSpan.FromHours(2)));
        var igdb = IgdbKnowing();

        var batch = await NewService(igdb).RefreshDueAsync(db, Now, CancellationToken.None);

        Assert.Equal(0, batch.Asked);
        await igdb.DidNotReceiveWithAnyArgs().GetGamesByIdsUncachedAsync(default!, default);
    }

    [Fact]
    public async Task RefreshDueAsync_WhenIgdbFails_WritesNothing()
    {
        // The rows keep the answer they had and stay first in line, rather than being stamped as
        // refreshed with nothing — which would hide them from the next tick for a day.
        using var db = WithRows(Row(1, TimeSpan.FromDays(2), "Hades"));
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetGamesByIdsUncachedAsync(Arg.Any<IReadOnlyCollection<int>>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down."));
        var logger = new ListLogger();

        var batch = await NewService(igdb, logger: logger).RefreshDueAsync(db, Now, CancellationToken.None);

        var row = await db.CachedGames.AsNoTracking().SingleAsync();
        Assert.Equal("Hades", row.Title);
        Assert.Equal(Now - TimeSpan.FromDays(2), row.RefreshedAt);
        Assert.False(batch.Answered);
        Assert.Single(logger.At(LogLevel.Warning));
    }

    [Fact]
    public async Task RefreshDueAsync_WhenIgdbTimesOutWithoutAShutdown_TreatsItAsIgdbFailing()
    {
        // An HttpClient timeout is a TaskCanceledException too. Filtering on the type would let a
        // slow IGDB out of the batch as though the host were stopping; filtering on the token keeps
        // it what it is — IGDB not answering.
        using var db = WithRows(Row(1, TimeSpan.FromDays(2)));
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetGamesByIdsUncachedAsync(Arg.Any<IReadOnlyCollection<int>>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new TaskCanceledException("The request was canceled due to the configured timeout."));

        var batch = await NewService(igdb).RefreshDueAsync(db, Now, CancellationToken.None);

        Assert.False(batch.Answered);
    }

    [Fact]
    public async Task RefreshDueAsync_WhenShutdownArrivesBeforeIgdbAnswers_StopsWithNothingWritten()
    {
        using var db = WithRows(Row(1, TimeSpan.FromDays(2), "Hades"));
        using var stopping = new CancellationTokenSource();
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetGamesByIdsUncachedAsync(Arg.Any<IReadOnlyCollection<int>>(), Arg.Any<CancellationToken>())
            .Returns<Task<IReadOnlyList<GameDto>>>(_ =>
            {
                stopping.Cancel();
                throw new OperationCanceledException(stopping.Token);
            });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => NewService(igdb).RefreshDueAsync(db, Now, stopping.Token));

        Assert.Equal("Hades", (await db.CachedGames.AsNoTracking().SingleAsync()).Title);
    }

    [Fact]
    public async Task RefreshDueAsync_WhenShutdownArrivesAfterIgdbAnswers_StillSavesTheAnswer()
    {
        // Issue #96's rule: the stopping token bounds the work, not the write. The request has been
        // paid for by the time IGDB answers, and cancelling the save would throw that answer away
        // to be asked for again on another task a minute later.
        var name = Guid.NewGuid().ToString();
        using var db = NewDb(name);
        db.CachedGames.Add(Row(1, TimeSpan.FromDays(2), "Hades"));
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        using var stopping = new CancellationTokenSource();
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetGamesByIdsUncachedAsync(Arg.Any<IReadOnlyCollection<int>>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                stopping.Cancel();
                return Task.FromResult<IReadOnlyList<GameDto>>([Game(1, "Hades II")]);
            });

        await NewService(igdb).RefreshDueAsync(db, Now, stopping.Token);

        using var reread = NewDb(name);
        Assert.Equal("Hades II", (await reread.CachedGames.SingleAsync()).Title);
    }

    // ── Saying when it is behind ──────────────────────────────────────────────────────

    [Fact]
    public async Task NoteLagAsync_WithRowsDueButNoneOverdue_SaysNothing()
    {
        // Rows fall due all day and are taken a batch at a time; due is the job's ordinary state.
        using var db = WithRows(Row(1, GameCacheService.RefreshAfter));
        var logger = new ListLogger();

        await NewService(logger: logger).NoteLagAsync(db, Now, lockedOut: false, CancellationToken.None);

        Assert.Empty(logger.At(LogLevel.Warning));
    }

    [Fact]
    public async Task NoteLagAsync_WithARowOverdue_Warns()
    {
        using var db = WithRows(
            Row(1, GameCacheRefresh.OverdueAfter + Minute),
            Row(2, GameCacheRefresh.OverdueAfter + TimeSpan.FromHours(3)),
            Row(3, TimeSpan.FromHours(1)));
        var logger = new ListLogger();

        await NewService(logger: logger).NoteLagAsync(db, Now, lockedOut: false, CancellationToken.None);

        var warning = Assert.Single(logger.At(LogLevel.Warning));
        Assert.Contains("2 cached game(s)", warning);
    }

    [Fact]
    public async Task NoteLagAsync_WhenLockedOut_SaysTheLockMayBeHeldBySomethingElse()
    {
        // pg_try_advisory_xact_lock is false whenever any session holds the key. Every task skipping
        // while rows go overdue is what a lock taken by hand looks like, and the warning names it.
        using var db = WithRows(Row(1, GameCacheRefresh.OverdueAfter + Minute));
        var logger = new ListLogger();

        await NewService(logger: logger).NoteLagAsync(db, Now, lockedOut: true, CancellationToken.None);

        Assert.Contains("advisory lock", Assert.Single(logger.At(LogLevel.Warning)));
    }

    [Fact]
    public async Task NoteLagAsync_StillBehind_WarnsAgainOnlyAfterAnHour()
    {
        // A tick is a minute, and a warning a minute through an afternoon's outage teaches people
        // to stop reading the log.
        using var db = WithRows(Row(1, TimeSpan.FromDays(3)));
        var logger = new ListLogger();
        var service = NewService(logger: logger);

        await service.NoteLagAsync(db, Now, lockedOut: false, CancellationToken.None);
        await service.NoteLagAsync(db, Now + TimeSpan.FromMinutes(59), lockedOut: false, CancellationToken.None);
        Assert.Single(logger.At(LogLevel.Warning));

        await service.NoteLagAsync(db, Now + TimeSpan.FromMinutes(60), lockedOut: false, CancellationToken.None);
        Assert.Equal(2, logger.At(LogLevel.Warning).Count);
    }

    [Fact]
    public async Task NoteLagAsync_OnceCaughtUp_SaysSoOnce()
    {
        using var db = WithRows(Row(1, TimeSpan.FromDays(3)));
        var logger = new ListLogger();
        var service = NewService(logger: logger);
        await service.NoteLagAsync(db, Now, lockedOut: false, CancellationToken.None);

        var row = await db.CachedGames.SingleAsync();
        row.RefreshedAt = Now;
        await db.SaveChangesAsync();

        await service.NoteLagAsync(db, Now + Minute, lockedOut: false, CancellationToken.None);
        await service.NoteLagAsync(db, Now + 2 * Minute, lockedOut: false, CancellationToken.None);

        Assert.Single(logger.At(LogLevel.Information), message => message.Contains("caught up"));
    }

    // ── Never stopping the host ───────────────────────────────────────────────────────

    /// <summary>A scope factory whose every scope fails the way <paramref name="failure"/> says.</summary>
    private static IServiceScopeFactory FailingScopes(Exception failure)
    {
        var scopes = Substitute.For<IServiceScopeFactory>();
        scopes.CreateScope().Throws(failure);
        return scopes;
    }

    [Fact]
    public async Task RunOnceAsync_WhenTheTickFails_LogsItAndCarriesOn()
    {
        // ADR 0038: an exception escaping ExecuteAsync stops the host, and a cache that is only
        // slower without this job is not worth the API.
        var logger = new ListLogger();
        var service = NewService(logger: logger, scopes: FailingScopes(new InvalidOperationException("The database is gone.")));

        await service.RunOnceAsync(CancellationToken.None);

        Assert.Single(logger.At(LogLevel.Error));
    }

    [Fact]
    public async Task RunOnceAsync_WhenTheHostIsStopping_LetsTheCancellationThrough()
    {
        using var stopping = new CancellationTokenSource();
        await stopping.CancelAsync();
        var service = NewService(scopes: FailingScopes(new OperationCanceledException(stopping.Token)));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.RunOnceAsync(stopping.Token));
    }

    [Fact]
    public async Task RunOnceAsync_ACancellationThatIsNotTheHostStopping_IsAFailedTick()
    {
        // Only the stopping token's own cancellation means "stop". Anything else cancelled — a
        // timeout surfacing as TaskCanceledException — is a tick that failed, and rethrowing it
        // would take the host down over it.
        var logger = new ListLogger();
        var service = NewService(logger: logger, scopes: FailingScopes(new TaskCanceledException("Timed out.")));

        await service.RunOnceAsync(CancellationToken.None);

        Assert.Single(logger.At(LogLevel.Error));
    }

    [Fact]
    public async Task ExecuteAsync_AfterAFailedTick_KeepsRunningUntilStopped()
    {
        // The loop as the host runs it, rather than one tick: the first tick fails at startup, and
        // the service is still waiting for the next one afterwards instead of having ended — which
        // under StopHost would have ended the process.
        var logger = new ListLogger();
        var service = NewService(
            clock: TimeProvider.System,
            logger: logger,
            scopes: FailingScopes(new InvalidOperationException("The database is gone.")));

        await service.StartAsync(CancellationToken.None);

        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (logger.At(LogLevel.Error).Count == 0 && DateTime.UtcNow < deadline)
            await Task.Delay(10);

        Assert.Single(logger.At(LogLevel.Error));
        Assert.False(service.ExecuteTask!.IsCompleted);

        await service.StopAsync(CancellationToken.None);

        Assert.True(service.ExecuteTask.IsCompleted);
        Assert.False(service.ExecuteTask.IsFaulted);
    }

    // ── Registration and configuration ────────────────────────────────────────────────

    [Fact]
    public void AddScheduledWork_RegistersTheGameCacheRefresh()
    {
        Assert.Contains(
            new ServiceCollection().AddScheduledWork(),
            service => service.ServiceType == typeof(IHostedService)
                && service.ImplementationType == typeof(GameCacheRefreshService));
    }

    /// <summary>The options as the application's own registration binds and checks them.</summary>
    private static GameCacheRefreshOptions Configured(params (string Key, string Value)[] settings)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(settings.ToDictionary(
                setting => $"{GameCacheRefreshOptions.SectionName}:{setting.Key}",
                setting => (string?)setting.Value))
            .Build();

        using var services = new ServiceCollection()
            .AddSingleton<IConfiguration>(configuration)
            .AddScheduledWork()
            .BuildServiceProvider();

        return services.GetRequiredService<IOptions<GameCacheRefreshOptions>>().Value;
    }

    [Fact]
    public void AddScheduledWork_WithNothingConfigured_PacesAtTheDefaults()
    {
        // ADR 0052: fifty ids a request, a request a minute.
        var options = Configured();

        Assert.Equal(50, options.BatchSize);
        Assert.Equal(TimeSpan.FromMinutes(1), options.Interval);
    }

    [Fact]
    public void AddScheduledWork_WithAPaceInsideTheBounds_TakesIt()
    {
        var options = Configured(("BatchSize", "500"), ("Interval", "01:00:00"));

        Assert.Equal(500, options.BatchSize);
        Assert.Equal(GameCacheRefresh.Lead, options.Interval);
    }

    [Theory]
    [InlineData("BatchSize", "0")]
    [InlineData("BatchSize", "501")] // more than IGDB answers in one request
    [InlineData("Interval", "00:00:05")] // a schedule rather than a pace
    [InlineData("Interval", "01:00:01")] // longer than the lead, so rows reach readers between ticks
    public void AddScheduledWork_WithAPaceTheJobCannotHonour_RefusesIt(string key, string value)
    {
        Assert.Throws<OptionsValidationException>(() => Configured((key, value)));
    }
}
