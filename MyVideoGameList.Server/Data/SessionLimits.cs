namespace MyVideoGameList.Server.Data;

/// <summary>
/// How long our sessions wait for a lock, and how long they may leave a transaction idle while
/// holding one (ADR 0079).
/// </summary>
/// <remarks>
/// <para>
/// <b>This file is compiled into the CDK app as well as the API</b>: <c>infra/src/Infra/Infra.csproj</c>
/// links it, because the migration task's connection string is written there and the integration
/// suite has to prove the string the deployment sends rather than a copy of it. So nothing in this
/// file may reach past the base class library; what needs Npgsql is in
/// <c>SessionLimits.Api.cs</c>, which only the API compiles.
/// </para>
/// <para>
/// Both go to PostgreSQL as the session's own settings, through the connection string's
/// <c>Options</c>, so they hold from the first statement and need no round trip of their own.
/// </para>
/// </remarks>
internal static partial class SessionLimits
{
    /// <summary>
    /// The longest the migration task waits for any one lock before PostgreSQL cancels the
    /// statement, which fails the migration and with it the release.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A DDL statement waiting for its lock holds a place in the table's queue, and every later
    /// read of that table waits behind it, so this is how long a migration can stall the site's
    /// readers of a table while somebody else's transaction is open on it. A release that fails is
    /// re-run; a site that stalls has already failed its readers.
    /// </para>
    /// <para>
    /// Five seconds is five times what the API's longest ordinary holders take: the export's
    /// snapshot at the size caps, about a second, and the cache refresh's batch, about a second at
    /// fifty ids. So an ordinary release never trips it, and it trips at once on what it is for: a
    /// transaction that has been open far longer than any of ours means to be. It is also short of
    /// the thirty seconds Npgsql's command timeout would otherwise give a blocked statement.
    /// </para>
    /// </remarks>
    public static readonly TimeSpan MigrationLockWait = TimeSpan.FromSeconds(5);

    /// <summary>
    /// The longest a session of the API's may sit idle inside a transaction before PostgreSQL ends
    /// the session, and the transaction and its locks with it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Idle means between statements: the application holds a transaction open and is doing
    /// something else. Our one transaction designed to do that is the cache refresh's, across its
    /// IGDB request, which it bounds itself at fifteen seconds (ADR 0052 §4); a minute is four times
    /// that. Everything else runs its statements back to back, and the export commits before its
    /// document is written to the response. What this catches is a transaction somebody forgot
    /// about: an await with no bound added inside one, which would otherwise hold its locks, and
    /// keep every migration of those tables failing, for as long as the process lives.
    /// </para>
    /// <para>
    /// A statement that is running is not idle, and this does not bound it; Npgsql's command
    /// timeout does.
    /// </para>
    /// </remarks>
    public static readonly TimeSpan IdleInTransaction = TimeSpan.FromMinutes(1);

    /// <summary>
    /// The migration task's connection string: the one it shares with the API, with
    /// <see cref="MigrationLockWait"/> as the session's <c>lock_timeout</c>.
    /// </summary>
    /// <param name="connectionString">A connection string with no <c>Options</c> of its own.</param>
    public static string ForMigration(string connectionString) =>
        $"{connectionString};Options='{Setting("lock_timeout", MigrationLockWait)}'";

    /// <summary>
    /// One <c>-c</c> option, in milliseconds, which PostgreSQL reads exactly and displays in the
    /// largest unit that divides it: <c>5000ms</c> shows as <c>5s</c>.
    /// </summary>
    private static string Setting(string name, TimeSpan value) =>
        $"-c {name}={(long)value.TotalMilliseconds}ms";
}
