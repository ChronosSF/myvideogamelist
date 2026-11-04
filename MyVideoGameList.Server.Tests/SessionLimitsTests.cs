using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Services;
using Npgsql;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The two limits our sessions carry, as strings and against the waits they are sized by (ADR 0079).
/// That PostgreSQL reads them, and what a migration does when it meets one, needs PostgreSQL:
/// <c>MigrationLockTests</c> in the integration suite.
/// </summary>
public class SessionLimitsTests
{
    [Fact]
    public void IdleInTransaction_AgainstTheRefreshWaitForIgdb_LeavesItRoomTwiceOver()
    {
        // The refresh is idle in its transaction for as long as IGDB takes, up to its own limit, and
        // then still has to notice, roll back and let go. Raise that limit past half of this one and
        // a slow IGDB starts ending the refresh's sessions under it.
        Assert.True(
            SessionLimits.IdleInTransaction >= GameCacheRefreshService.IgdbWaitLimit * 2,
            $"{SessionLimits.IdleInTransaction} is less than twice the refresh's {GameCacheRefreshService.IgdbWaitLimit}.");
    }

    [Fact]
    public void ForMigration_AsProgramReadsIt_CarriesTheLockWaitAndTheIdleLimitTogether()
    {
        var connection = new NpgsqlConnectionStringBuilder(
            SessionLimits.ForApi(SessionLimits.ForMigration("Host=db;Database=myvideogamelist;Username=mvgl")));

        Assert.Equal("db", connection.Host);
        Assert.Equal("-c lock_timeout=5000ms -c idle_in_transaction_session_timeout=60000ms", connection.Options);
    }

    [Fact]
    public void ForApi_AStringWithNoOptions_GainsTheIdleLimitAlone()
    {
        var connection = new NpgsqlConnectionStringBuilder(
            SessionLimits.ForApi("Host=localhost;Port=5432;Database=myvideogamelist;Username=mvgl;SSL Mode=Require"));

        Assert.Equal(SslMode.Require, connection.SslMode);
        Assert.Equal("-c idle_in_transaction_session_timeout=60000ms", connection.Options);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void ForApi_NoConnectionString_IsLeftToFailAsItWould(string? connectionString)
    {
        Assert.Equal(connectionString, SessionLimits.ForApi(connectionString));
    }
}
