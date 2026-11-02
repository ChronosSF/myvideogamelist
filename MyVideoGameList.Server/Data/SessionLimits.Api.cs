using Npgsql;

namespace MyVideoGameList.Server.Data;

/// <summary>
/// The half of <see cref="SessionLimits"/> that needs Npgsql, and so is not linked into the CDK app.
/// </summary>
internal static partial class SessionLimits
{
    /// <summary>
    /// The application's connection string, with <see cref="IdleInTransaction"/> as every session's
    /// <c>idle_in_transaction_session_timeout</c>, beside whatever options it already carries.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Applied here rather than in the deployment, so that it holds in local development and in the
    /// integration suite as well, and a transaction left idle past it fails where it is written
    /// rather than first in production.
    /// </para>
    /// <para>
    /// Merged into <c>Options</c> rather than appended as a second one, because the migration bundle
    /// builds its context through <c>Program.cs</c> too, from a string that already carries
    /// <see cref="ForMigration"/>'s <c>lock_timeout</c>, and of two <c>Options</c> keys the later
    /// would replace the earlier.
    /// </para>
    /// </remarks>
    /// <returns>
    /// <paramref name="connectionString"/> unchanged when it is null or empty: <c>appsettings.json</c>
    /// leaves it empty on purpose, so that an environment that supplies none fails loudly at its
    /// first query, and an <c>Options</c> key on its own would only change how.
    /// </returns>
    public static string? ForApi(string? connectionString)
    {
        if (string.IsNullOrEmpty(connectionString)) return connectionString;

        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        var idle = Setting("idle_in_transaction_session_timeout", IdleInTransaction);

        builder.Options = string.IsNullOrWhiteSpace(builder.Options) ? idle : $"{builder.Options} {idle}";
        return builder.ConnectionString;
    }
}
