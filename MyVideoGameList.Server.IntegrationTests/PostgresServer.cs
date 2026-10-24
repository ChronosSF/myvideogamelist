using Npgsql;
using Testcontainers.PostgreSql;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// One PostgreSQL for the whole run, and an empty database on it for each test class that asks.
/// </summary>
/// <remarks>
/// <para>
/// Started on first use and shared by every class, because starting the server is most of what a
/// container costs and a database is nearly free beside it. Each class then gets a database of its
/// own, so classes run in parallel without seeing each other's rows, and nothing has to be reset
/// between them. See <c>docs/decisions/0057-*</c>.
/// </para>
/// <para>
/// Testcontainers' reaper removes the container when the test process goes away, however it goes;
/// disposing it at exit as well keeps a machine tidy where the reaper is switched off. Nothing here
/// touches the <c>mvgl-postgres</c> container <c>compose.yaml</c> runs, which a developer's own data
/// lives in.
/// </para>
/// </remarks>
internal static class PostgresServer
{
    /// <summary>
    /// The image <c>compose.yaml</c> runs, so the tests see the engine a developer's
    /// <c>dotnet run</c> does. The browser smoke test's and the Lighthouse audit's service containers in
    /// <c>ci.yml</c> run it too, so change the four together.
    /// </summary>
    private const string Image = "postgres:18-alpine";

    /// <summary>
    /// Long enough to pull the image on a slow connection the first time; short enough that a
    /// container which will never be ready fails the run with a reason, rather than waiting out
    /// Testcontainers' own hour.
    /// </summary>
    private static readonly TimeSpan StartLimit = TimeSpan.FromMinutes(5);

    private static readonly Lazy<Task<PostgreSqlContainer>> Container = new(StartAsync);

    private static async Task<PostgreSqlContainer> StartAsync()
    {
        var container = new PostgreSqlBuilder(Image).Build();

        using (var limit = new CancellationTokenSource(StartLimit))
        {
            try
            {
                await container.StartAsync(limit.Token);
            }
            // Testcontainers reports the token firing as a TimeoutException of its own, measured,
            // or as a cancellation, depending on where it was waiting.
            catch (Exception e) when (limit.IsCancellationRequested && e is TimeoutException or OperationCanceledException)
            {
                throw new TimeoutException(
                    $"PostgreSQL ({Image}) was not ready within {StartLimit.TotalMinutes} minutes. Is Docker running?", e);
            }
        }

        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            // ProcessExit is synchronous, so this is the one place a wait is unavoidable. Bounded,
            // and quiet when it fails: the reaper removes the container anyway, and a run that has
            // already reported its results must not end as a crashed test host.
            try
            {
                container.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(10));
            }
            catch (Exception)
            {
                // Left to the reaper.
            }
        };

        return container;
    }

    /// <summary>
    /// Creates an empty database and returns a connection string for it. The schema is the
    /// caller's to apply.
    /// </summary>
    public static async Task<string> CreateDatabaseAsync(string name)
    {
        var container = await Container.Value;
        var connection = new NpgsqlConnectionStringBuilder(container.GetConnectionString());

        await using (var server = new NpgsqlConnection(connection.ConnectionString))
        {
            await server.OpenAsync();

            // The name is ours, never input, and an identifier cannot be a parameter.
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", server);
            await create.ExecuteNonQueryAsync();
        }

        connection.Database = name;
        return connection.ConnectionString;
    }
}
