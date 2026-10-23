using Npgsql;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// An advisory lock held by a session of its own, as another task's tick or sweep would hold it, and let
/// go of before disposing it returns.
/// </summary>
/// <remarks>
/// Released with <c>pg_advisory_unlock</c>, never by closing the session. Closing returns as soon as the
/// client has said goodbye, and the server lets go of the session's locks as its backend exits, a moment
/// later — so a tick run straight after can still find the lock taken and step aside. That is how the
/// refresh's test failed on CI once: the lock "released", the next tick skipped, and IGDB asked nothing.
/// Another task's lock is transaction-scoped and goes with its commit, which has finished by the time the
/// commit returns; an explicit unlock is the same.
/// </remarks>
internal sealed class AdvisoryLockHolder : IAsyncDisposable
{
    private readonly NpgsqlConnection session;
    private readonly long key;

    private AdvisoryLockHolder(NpgsqlConnection session, long key)
    {
        this.session = session;
        this.key = key;
    }

    /// <summary>Takes <paramref name="key"/>, waiting for it if another session holds it.</summary>
    public static async Task<AdvisoryLockHolder> TakeAsync(string connectionString, long key)
    {
        // Not pooled, so the session is this holder's alone and nothing else runs on it.
        var session = new NpgsqlConnection(
            new NpgsqlConnectionStringBuilder(connectionString) { Pooling = false }.ConnectionString);
        await session.OpenAsync();

        await using var take = new NpgsqlCommand("SELECT pg_advisory_lock(@key)", session);
        take.Parameters.AddWithValue("key", key);
        await take.ExecuteNonQueryAsync();

        return new AdvisoryLockHolder(session, key);
    }

    public async ValueTask DisposeAsync()
    {
        await using (var release = new NpgsqlCommand("SELECT pg_advisory_unlock(@key)", session))
        {
            release.Parameters.AddWithValue("key", key);
            await release.ExecuteNonQueryAsync();
        }

        await session.DisposeAsync();
    }
}
