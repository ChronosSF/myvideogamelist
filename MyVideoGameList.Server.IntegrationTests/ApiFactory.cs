using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Security;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The API as <c>Program.cs</c> builds it, over a PostgreSQL database of its own, with IGDB out of
/// reach. One per test class, as its class fixture.
/// </summary>
/// <remarks>
/// <para>
/// <b>Not Development.</b> Development loads the developer's user secrets — IGDB's credentials
/// among them, which nothing here may use — and turns on the stack traces, the API reference and
/// the startup migration that no deployed instance has. Everything outside Development behaves as
/// deployed, so this runs as <c>Testing</c> and does what a deployment does instead: the schema is
/// applied by a step of its own before the first request, from the same migrations
/// (<c>CLAUDE.md</c>, "Migrations auto-apply in Development only").
/// </para>
/// <para>
/// What is replaced, and nothing else: IGDB, by <see cref="UnreachableIgdb"/>; the key ring, by one
/// held in memory; our own scheduled work, which a test runs by hand when it wants it, so that no
/// sweep deletes rows from under a test that did not ask for one. Every middleware, every service
/// and every policy is the application's own. See <c>docs/decisions/0057-*</c>.
/// </para>
/// </remarks>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    /// <summary>
    /// The header a test client names its own address in, which <see cref="ClientAddress"/> gives
    /// the request as the address it came from.
    /// </summary>
    internal const string ClientAddressHeader = "X-Test-Client-Address";

    private static int databases;

    private static int addresses;

    /// <summary>IGDB, for asserting what was asked of it.</summary>
    public UnreachableIgdb Igdb { get; } = new();

    /// <summary>This class's own database, for seeding and reading behind the API's back.</summary>
    public string ConnectionString { get; private set; } = "";

    public async Task InitializeAsync()
    {
        ConnectionString = await PostgresServer.CreateDatabaseAsync(
            $"test_{Interlocked.Increment(ref databases)}_{Guid.NewGuid():N}");

        // The deployment's migration step, which outside Development runs before the application
        // takes a request. Through the application's own context, so the model and the options are
        // the ones every request gets.
        await using var scope = Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<ApplicationDbContext>().Database.MigrateAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        // As settings rather than as a configuration source, because Program.cs reads these while
        // it registers its services, and a source added here would arrive after it had read them.
        builder.UseSetting("ConnectionStrings:DefaultConnection", ConnectionString);

        // Outside Development a key ring persisted nowhere stops the application at startup unless
        // configuration says the loss is meant (ADR 0043). It is meant here, and the ring is made
        // literally ephemeral below, so no test writes into the developer's own ring.
        builder.UseSetting("DataProtection:AllowEphemeralKeys", "true");

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IIgdbService>();
            services.AddSingleton(Igdb.Service);

            services.AddDataProtection().UseEphemeralDataProtectionProvider();

            // Ours only: the framework's own hosted services include the one that starts the server.
            var scheduled = services
                .Where(service => service.ServiceType == typeof(IHostedService)
                    && service.ImplementationType?.Assembly == typeof(Program).Assembly)
                .ToList();

            foreach (var service in scheduled) services.Remove(service);

            services.AddTransient<IStartupFilter, ClientAddress>();
        });
    }

    /// <summary>
    /// A browser with its own cookie jar and its own address, which sends the write guard's header
    /// the way <c>apiFetch</c> does (ADR 0033).
    /// </summary>
    public HttpClient CreateBrowser()
    {
        var address = Interlocked.Increment(ref addresses);

        // HTTPS because the sign-in cookie is Secure, and a cookie jar sends a Secure cookie over
        // HTTPS only. No redirects followed, so a test sees exactly what the API answered.
        return CreateDefaultClient(
            new Uri("https://localhost"),
            new CookieContainerHandler(),
            new BrowserHeaders(new IPAddress([10, 0, (byte)(address >> 8), (byte)address])));
    }

    /// <summary>
    /// A context over this class's database that is not the application's: for seeding what no
    /// endpoint writes, and for reading back what the API says it did.
    /// </summary>
    public ApplicationDbContext Database() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>().UseNpgsql(ConnectionString).Options);

    /// <summary>
    /// Puts games into <c>CachedGames</c> through the application's own writer, fresh, so a list
    /// renders them without asking IGDB (ADR 0035).
    /// </summary>
    public async Task CacheGamesAsync(params int[] ids)
    {
        await using var scope = Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<IGameCacheService>()
            .StoreAsync(ids.Select(Game).ToList());
    }

    /// <summary>A game with a title and nothing else, which is all a list needs to render one.</summary>
    public static GameDto Game(int id) =>
        new(id, $"Game {id}", null, null, null, null, null, null, null, null, null, null, null,
            [], [], [], [], null);

    async Task IAsyncLifetime.DisposeAsync() => await DisposeAsync();

    /// <summary>
    /// What every request from one test browser carries.
    /// </summary>
    private sealed class BrowserHeaders(IPAddress address) : DelegatingHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            request.Headers.Add(ClientAddressHeader, address.ToString());

            // On a write and nowhere else, with the value apiFetch sends, which nothing reads.
            var write = !HttpMethods.IsGet(request.Method.Method)
                && !HttpMethods.IsHead(request.Method.Method)
                && !HttpMethods.IsOptions(request.Method.Method);

            var omit = request.Options.TryGetValue(Requests.WithoutWriteHeader, out var without) && without;

            if (write && !omit) request.Headers.Add(CsrfHeaderMiddleware.HeaderName, "1");

            return base.SendAsync(request, cancellationToken);
        }
    }

    /// <summary>
    /// Gives each request the address its test browser names, as a connection from that browser
    /// would have.
    /// </summary>
    /// <remarks>
    /// The test server has no connection to take one from, so every request would otherwise share
    /// the rate limiter's one bucket for requests with no address, and a class that signs in eleven
    /// times would be refused for something no visitor does. Ahead of the whole application, as a
    /// connection's address is.
    /// </remarks>
    private sealed class ClientAddress : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use((context, nextMiddleware) =>
            {
                if (IPAddress.TryParse(context.Request.Headers[ClientAddressHeader], out var address))
                    context.Connection.RemoteIpAddress = address;

                return nextMiddleware(context);
            });

            next(app);
        };
    }
}

/// <summary>Per-request switches for a test browser.</summary>
public static class Requests
{
    /// <summary>
    /// Sends a write without <c>X-MVGL-Request</c>, as a form on somebody else's site would.
    /// </summary>
    public static readonly HttpRequestOptionsKey<bool> WithoutWriteHeader = new(nameof(WithoutWriteHeader));
}
