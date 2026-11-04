using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using MyVideoGameList.Server.Data;
using Npgsql;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// What our sessions tell PostgreSQL about waiting (#261): the migration task gives up on a lock
/// rather than stall the site behind it, and the API's sessions end a transaction left idle.
/// </summary>
/// <remarks>
/// <para>
/// The migration's connection string is built by <see cref="SessionLimits.ForMigration"/>, the code
/// the CDK app links and deploys, and then by <see cref="SessionLimits.ForApi"/>, which is what
/// <c>Program.cs</c> does to it when the bundle builds the application's host to find its context.
/// So the string under test is the deployed one, not a copy. See <c>docs/decisions/0079-*</c>.
/// </para>
/// </remarks>
public class MigrationLockTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    /// <summary>
    /// The last migration before <see cref="Blocked"/>, which the database is brought to first.
    /// </summary>
    /// <remarks>
    /// Migrations are only ever added, so a past one stays put. If they are ever squashed, this and
    /// <see cref="Blocked"/> need a new pair: one that alters a table, and the one before it, which
    /// the test checks are adjacent before it relies on them.
    /// </remarks>
    private const string Before = "20261017145040_AddEntryTags";

    /// <summary>
    /// A migration that alters a table every list page reads: it adds a column to
    /// <c>UserGameEntries</c>, which takes the table's <c>ACCESS EXCLUSIVE</c> lock.
    /// </summary>
    private const string Blocked = "20261021071403_AddUserGameEntryScoredAt";

    [Fact]
    public async Task MigrateAsync_ATableHeldByAnOpenTransaction_GivesUpWithinTheLockWaitAndLetsLaterReadersThrough()
    {
        var connectionString = await PostgresServer.CreateDatabaseAsync($"migrate_{Guid.NewGuid():N}");

        await using (var db = Context(connectionString))
        {
            await db.GetService<IMigrator>().MigrateAsync(Before);

            // The run below migrates to the latest, as the bundle does, so the migration it meets
            // first has to be the one whose lock this test is about.
            Assert.Equal(Blocked, (await db.Database.GetPendingMigrationsAsync()).First());
        }

        // A transaction open on the table, as a request or an export is while it runs, and which
        // this test, unlike any of ours, does not end until it is done.
        await using var holder = await OpenAsync(connectionString);
        await using var held = await holder.BeginTransactionAsync();
        await CountEntriesAsync(holder, held);

        await using var migration = Context(SessionLimits.ForApi(SessionLimits.ForMigration(connectionString)));
        var clock = Stopwatch.StartNew();
        var migrating = migration.Database.MigrateAsync();

        await SessionsWaitingForALockAsync(connectionString, 1);

        // A reader that arrives while the migration waits, as the next page load would: it queues
        // behind the migration's request for the lock, not behind the transaction above.
        var reading = Task.Run(async () =>
        {
            await using var reader = await OpenAsync(connectionString);
            await CountEntriesAsync(reader, null);
        });

        await SessionsWaitingForALockAsync(connectionString, 2);
        Assert.False(reading.IsCompleted);

        var thrown = await Record.ExceptionAsync(() => migrating);
        var waited = clock.Elapsed;

        // Npgsql calls a lock timeout transient, so the execution strategy, which never retries
        // today, hands it on wrapped, saying so. The bundle exits non-zero on it either way.
        var wrapped = Assert.IsType<InvalidOperationException>(thrown);
        var refused = Assert.IsType<PostgresException>(wrapped.InnerException);
        Assert.Equal(PostgresErrorCodes.LockNotAvailable, refused.SqlState);

        // It waited the limit and then gave up: not at once, which would be some other failure, and
        // not at Npgsql's thirty-second command timeout, which is what a blocked statement met before.
        Assert.InRange(waited, SessionLimits.MigrationLockWait, SessionLimits.MigrationLockWait + TimeSpan.FromSeconds(10));

        // The reader that queued behind it is answered, while the first transaction is still open.
        await reading.WaitAsync(TimeSpan.FromSeconds(10));

        // The blocked migration rolled back whole. Each migration is a transaction of its own, so one
        // that had gone before it would have stayed applied; either way the run after it, once the
        // transaction has ended, is the whole of the fix.
        Assert.Equal(Before, await LastAppliedAsync(connectionString));

        await held.CommitAsync();

        await using (var rerun = Context(SessionLimits.ForApi(SessionLimits.ForMigration(connectionString))))
        {
            await rerun.Database.MigrateAsync();
            Assert.Empty(await rerun.Database.GetPendingMigrationsAsync());
        }
    }

    [Fact]
    public async Task ForMigration_ThroughTheApplicationsOwnBuilder_ReachesTheSessionWithBothLimits()
    {
        await using var db = Context(SessionLimits.ForApi(SessionLimits.ForMigration(api.ConnectionString)));

        Assert.Equal(SessionLimits.MigrationLockWait, await SettingAsync(db, "lock_timeout"));
        Assert.Equal(SessionLimits.IdleInTransaction, await SettingAsync(db, "idle_in_transaction_session_timeout"));
    }

    [Fact]
    public async Task ApplicationContext_AsProgramBuildsIt_CarriesTheIdleLimitAndNoLockWait()
    {
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        Assert.Equal(SessionLimits.IdleInTransaction, await SettingAsync(db, "idle_in_transaction_session_timeout"));

        // A request waits for a lock as long as it ever did: the limit on waiting is the migration's.
        Assert.Equal(TimeSpan.Zero, await SettingAsync(db, "lock_timeout"));
    }

    private static ApplicationDbContext Context(string? connectionString) =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>().UseNpgsql(connectionString).Options);

    private static async Task<NpgsqlConnection> OpenAsync(string connectionString)
    {
        // Not pooled, so each session here is the one its name says.
        var connection = new NpgsqlConnection(
            new NpgsqlConnectionStringBuilder(connectionString) { Pooling = false }.ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    private static async Task CountEntriesAsync(NpgsqlConnection connection, NpgsqlTransaction? transaction)
    {
        await using var count = new NpgsqlCommand("""SELECT count(*) FROM "UserGameEntries" """, connection, transaction);
        await count.ExecuteScalarAsync();
    }

    /// <summary>
    /// Returns once <paramref name="count"/> sessions on this database are waiting for a lock, so a
    /// step that has to happen while they wait does not race them to it.
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

        // Well inside the lock wait, which is what ends the waiting this looks for.
        var deadline = Stopwatch.StartNew();
        while ((long)(await waiting.ExecuteScalarAsync())! < count)
        {
            if (deadline.Elapsed > SessionLimits.MigrationLockWait / 2)
                throw new TimeoutException($"Fewer than {count} session(s) were waiting for a lock.");

            await Task.Delay(20);
        }
    }

    private static async Task<string> LastAppliedAsync(string connectionString)
    {
        await using var db = Context(connectionString);
        return (await db.Database.GetAppliedMigrationsAsync()).Last();
    }

    /// <summary>
    /// A setting of this context's session, from <c>pg_settings</c>, whose unit for both of these is
    /// the millisecond.
    /// </summary>
    private static async Task<TimeSpan> SettingAsync(ApplicationDbContext db, string name)
    {
        var milliseconds = await db.Database
            .SqlQuery<long>($"""SELECT setting::bigint AS "Value" FROM pg_settings WHERE name = {name} AND unit = 'ms'""")
            .SingleAsync();

        return TimeSpan.FromMilliseconds(milliseconds);
    }
}
