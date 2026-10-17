using System.Collections.Concurrent;
using System.Net;
using System.Xml.Linq;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.AspNetCore.DataProtection.XmlEncryption;
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
/// What is replaced, and nothing else: IGDB, by <see cref="UnreachableIgdb"/>; where the key ring
/// is kept, in memory; our own scheduled work, which a test runs by hand when it wants it, so that
/// no sweep deletes rows from under a test that did not ask for one. And one thing is added ahead of
/// the pipeline: <see cref="ClientAddress"/>, which gives each test browser the address a
/// connection would have given it. Every other middleware, every service and every policy is the
/// application's own. See <c>docs/decisions/0057-*</c>.
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
        // starts, as a step of its own. From the application's own migrations, through a context
        // that is not the host's: the host is not started yet, and the one error EF logs while
        // finding a new database has no history table is then not in the log of a run that passed.
        await using (var db = Database())
        {
            await db.Database.MigrateAsync();
        }

        // Starting the host, which is what reading Services does the first time. Nothing it starts
        // reads a table: our own scheduled work is removed below, and this says so rather than
        // trusting the filter that removes it to have kept up with how services get registered.
        var running = Services.GetServices<IHostedService>()
            .Where(service => service.GetType().Assembly == typeof(Program).Assembly)
            .Select(service => service.GetType().Name)
            .ToList();

        if (running.Count > 0)
        {
            throw new InvalidOperationException(
                $"Our own hosted services are running in the test host: {string.Join(", ", running)}. "
                + "Remove them in ConfigureWebHost, as the retention sweep is.");
        }
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        // As settings rather than as a configuration source, because Program.cs reads these while
        // it registers its services, and a source added here would arrive after it had read them.
        builder.UseSetting("ConnectionStrings:DefaultConnection", ConnectionString);

        // Outside Development a key ring persisted nowhere stops the application at startup unless
        // configuration says the loss is meant (ADR 0043). It is meant here: the setting alone would
        // leave the ring where the default puts it, which on a developer machine is their own
        // profile, so where the keys are kept is replaced below.
        builder.UseSetting("DataProtection:AllowEphemeralKeys", "true");

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IIgdbService>();
            services.AddSingleton(Igdb.Service);

            // Where the keys are kept, which is all that changes: the provider, the application name
            // and the key manager stay the application's own. Data Protection falls back to the
            // profile only when no repository is set, and its hosted service loads the ring as the
            // host starts, so without this the first key of every run would be written there. Kept
            // unencrypted, as anything in this process's memory is, and said so to Data Protection.
            services.Configure<KeyManagementOptions>(options =>
            {
                options.XmlRepository = new KeysInMemory();
                options.XmlEncryptor = new NullXmlEncryptor();
            });

            // Ours only: the framework's own hosted services include the one that starts the server.
            // Registered by type, by instance or by a factory written in our assembly; InitializeAsync
            // checks that none was missed.
            var scheduled = services
                .Where(service => service.ServiceType == typeof(IHostedService) && !service.IsKeyedService)
                .Where(service => (service.ImplementationType
                        ?? service.ImplementationInstance?.GetType()
                        ?? service.ImplementationFactory?.Method.DeclaringType)?.Assembly
                    == typeof(Program).Assembly)
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
    /// The key ring's storage: this process's memory, and nowhere a developer keeps their own.
    /// </summary>
    private sealed class KeysInMemory : IXmlRepository
    {
        private readonly ConcurrentQueue<XElement> keys = new();

        public IReadOnlyCollection<XElement> GetAllElements() =>
            keys.Select(key => new XElement(key)).ToList();

        public void StoreElement(XElement element, string friendlyName) =>
            keys.Enqueue(new XElement(element));
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
