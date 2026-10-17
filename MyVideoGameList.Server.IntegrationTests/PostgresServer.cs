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
/// disposing it at exit as well is only tidier. Nothing here touches the <c>mvgl-postgres</c>
/// container <c>compose.yaml</c> runs, which a developer's own data lives in.
/// </para>
/// </remarks>
internal static class PostgresServer
{
    /// <summary>
    /// The image <c>compose.yaml</c> runs, so the tests see the engine a developer's
    /// <c>dotnet run</c> does. Change the two together.
    /// </summary>
    private const string Image = "postgres:18-alpine";

    private static readonly Lazy<Task<PostgreSqlContainer>> Container = new(StartAsync);

    private static async Task<PostgreSqlContainer> StartAsync()
    {
        var container = new PostgreSqlBuilder(Image).Build();

        await container.StartAsync();

        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
            container.DisposeAsync().AsTask().GetAwaiter().GetResult();

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
