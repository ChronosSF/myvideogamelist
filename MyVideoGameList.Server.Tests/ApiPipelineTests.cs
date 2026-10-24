using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using MyVideoGameList.Server.Observability;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Import;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Run alone: <see cref="Activity.ForceDefaultIdFormat"/> is one setting for the whole process, and
/// <see cref="ApiPipelineTests"/> needs to see <c>Program.cs</c> be the one that sets it.
/// </summary>
[CollectionDefinition(nameof(ProcessWideActivityFormat), DisableParallelization = true)]
public sealed class ProcessWideActivityFormat;

/// <summary>
/// The application's own pipeline, as <c>Program.cs</c> builds it, with IGDB stood in for and no
/// database: the request's trace from the caller's <c>traceparent</c> to the error body, the header
/// and every line logged, the request line's place above the exception handler, what a line may not
/// carry, and <c>/api/version</c>.
/// </summary>
/// <remarks>
/// Through the real hosting layer, because that is what reads <c>traceparent</c> and starts the
/// request's activity, and through the real <c>Program.cs</c>, because the order of its middleware
/// is the thing under test: a copy of the pipeline would pass with the original in any order.
/// </remarks>
[Collection(nameof(ProcessWideActivityFormat))]
public sealed class ApiPipelineTests
{
    private const string TraceId = "4bf92f3577b34da6a3ce929d0e0e4736";

    /// <summary>What the SSR server sends: its trace, its request's span, sampled.</summary>
    private const string Traceparent = $"00-{TraceId}-00f067aa0ba902b7-01";

    /// <summary>A write without the guard's header: refused before anything asks for a database.</summary>
    private const string RefusedWrite = "/api/lists/1";

    private sealed class Api : WebApplicationFactory<Program>
    {
        public RecordingLoggerProvider Log { get; } = new();

        public IIgdbService Igdb { get; } = Substitute.For<IIgdbService>();

        /// <summary>Configuration the test sets, over whatever the shell running it has.</summary>
        public Dictionary<string, string?> Settings { get; } = new()
        {
            ["Build:Sha"] = "",
            ["Build:Time"] = "",
        };

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            // Not Development, which migrates a database at startup, and not Production either:
            // everything outside Development behaves as deployed, which is the point.
            builder.UseEnvironment("Testing");

            // Read while Program.cs registers its services, so set as early as WebApplicationFactory
            // allows. Nothing here opens the connection; the key ring stays in memory.
            builder.UseSetting("ConnectionStrings:DefaultConnection", "Host=localhost;Database=unused");
            builder.UseSetting("DataProtection:AllowEphemeralKeys", "true");

            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(Settings));

            builder.ConfigureTestServices(services =>
            {
                // Every line recorded and none written: the JSON console would write into the test
                // run's own output. What decides a line's scopes and filters is left as it is.
                services.RemoveAll<ILoggerProvider>();
                services.AddSingleton<ILoggerProvider>(Log);

                services.RemoveAll<IIgdbService>();
                services.AddSingleton(Igdb);

                // The hourly sweep, which has no database to sweep here.
                foreach (var sweep in services.Where(service => service.ImplementationType == typeof(ImportRetentionService)).ToList())
                {
                    services.Remove(sweep);
                }
            });
        }

        public async Task<(HttpResponseMessage Response, string Body)> SendAsync(
            HttpMethod method,
            string path,
            string? traceparent = null)
        {
            using var request = new HttpRequestMessage(method, path);
            if (traceparent is not null) request.Headers.TryAddWithoutValidation("traceparent", traceparent);

            // Read to its end, so that every line the request writes has been written.
            var response = await CreateClient().SendAsync(request);
            return (response, await response.Content.ReadAsStringAsync());
        }

        /// <summary>Every line written while serving the request for this path.</summary>
        public IReadOnlyList<RecordingLoggerProvider.Entry> LinesFor(string path) =>
            Log.Entries.Where(entry => entry.Scope("RequestPath") == path).ToList();

        /// <summary>The one line the request log wrote for this path.</summary>
        public RecordingLoggerProvider.Entry RequestLineFor(string path) =>
            Assert.Single(Log.Entries, entry =>
                entry.Category == typeof(RequestLogMiddleware).FullName && entry.Scope("RequestPath") == path);
    }

    private static string TraceIdIn(string problemDetails) =>
        JsonDocument.Parse(problemDetails).RootElement.GetProperty("traceId").GetString() ?? "";

    private static string HeaderOf(HttpResponseMessage response) =>
        response.Headers.GetValues(TraceIds.HeaderName).Single();

    private static void AssertFreshTraceId(string traceId)
    {
        Assert.Matches("^[0-9a-f]{32}$", traceId);
        Assert.NotEqual(new string('0', 32), traceId);
    }

    [Fact]
    public async Task Request_WithTheRendersTraceparent_IsKnownByItsTraceIdInTheBodyTheHeaderAndEveryLine()
    {
        await using var api = new Api();

        var (response, body) = await api.SendAsync(HttpMethod.Post, RefusedWrite, Traceparent);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(TraceId, TraceIdIn(body));
        Assert.Equal(TraceId, HeaderOf(response));

        var lines = api.LinesFor(RefusedWrite);
        Assert.NotEmpty(lines);
        Assert.All(lines, line => Assert.Equal(TraceId, line.Scope("TraceId")));

        var requestLine = api.RequestLineFor(RefusedWrite);
        Assert.Equal(LogLevel.Information, requestLine.Level);
        Assert.Equal("POST", requestLine.Value("Method"));
        Assert.Equal(RefusedWrite, requestLine.Value("Path"));
        Assert.Equal(403, requestLine.Value("StatusCode"));
        Assert.Equal(TraceId, requestLine.Value("TraceId"));
        Assert.True(Assert.IsType<double>(requestLine.Value("ElapsedMilliseconds")) >= 0);
    }

    [Fact]
    public async Task Request_WithoutATraceparent_StartsATraceOfItsOwn()
    {
        // A browser's own call, which reaches the API directly and so is the root of its trace.
        await using var api = new Api();

        var (response, body) = await api.SendAsync(HttpMethod.Post, RefusedWrite);

        var traceId = TraceIdIn(body);
        AssertFreshTraceId(traceId);
        Assert.Equal(traceId, HeaderOf(response));
        Assert.Equal(traceId, api.RequestLineFor(RefusedWrite).Scope("TraceId"));
    }

    [Theory]
    [InlineData("garbage")]
    [InlineData("00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01")]
    [InlineData("00-00000000000000000000000000000000-00f067aa0ba902b7-01")]
    [InlineData("00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01")]
    [InlineData("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra")]
    // A later version may carry more fields. .NET's propagator lets this one through and the
    // activity's parser does not, which without TraceIds.UseW3COnly is a hierarchical activity: an
    // all-zero trace id, and the header's own text as the TraceId on every line the request logs.
    [InlineData("01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra")]
    public async Task Request_WithATraceparentItCannotRead_StartsATraceOfItsOwnEverywhere(string traceparent)
    {
        // Program.cs forces the format before the host exists. Undone first, so that it is Program.cs
        // and not an earlier test that this one sees setting it.
        Activity.ForceDefaultIdFormat = false;
        await using var api = new Api();

        var (response, body) = await api.SendAsync(HttpMethod.Post, RefusedWrite, traceparent);

        Assert.True(Activity.ForceDefaultIdFormat);
        var traceId = TraceIdIn(body);
        AssertFreshTraceId(traceId);
        Assert.NotEqual(TraceId, traceId);
        Assert.Equal(traceId, HeaderOf(response));

        var lines = api.LinesFor(RefusedWrite);
        Assert.NotEmpty(lines);
        Assert.All(lines, line => Assert.Equal(traceId, line.Scope("TraceId")));
    }

    [Fact]
    public async Task Request_ThatAThirdPartyFailed_IsLoggedWithThe502ItWasAnsweredWith()
    {
        // The status the exception handler ends a failure with is what the request line reports
        // only while the line is written above that handler. Below it, this would read 500.
        await using var api = new Api();
        api.Igdb.GetGameByIdAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB did not answer."));

        var (response, body) = await api.SendAsync(HttpMethod.Get, "/api/games/7346", Traceparent);

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Equal(TraceId, TraceIdIn(body));
        Assert.Equal(502, api.RequestLineFor("/api/games/7346").Value("StatusCode"));
        Assert.Contains(api.LinesFor("/api/games/7346"), line => line.Level == LogLevel.Warning);

        // The exception goes into a Development answer and no other.
        Assert.False(JsonDocument.Parse(body).RootElement.TryGetProperty("exception", out _));
    }

    [Fact]
    public async Task Request_WithAnAddressInItsQuery_LeavesItInNoLine()
    {
        // A search can be an email address. The request line leaves the query out, and ASP.NET's own
        // lines, which print the whole URL, stay below the level they are written at.
        await using var api = new Api();

        await api.SendAsync(HttpMethod.Get, "/api/version?q=alice%40example.com", Traceparent);
        await api.SendAsync(HttpMethod.Post, $"{RefusedWrite}?q=alice%40example.com", Traceparent);

        Assert.NotEmpty(api.Log.Entries);
        Assert.DoesNotContain(api.Log.Entries, entry =>
            entry.Message.Contains("alice")
            || entry.State.Any(pair => $"{pair.Value}".Contains("alice"))
            || entry.Scopes.Any(pair => $"{pair.Value}".Contains("alice")));
    }

    [Fact]
    public async Task Request_ForTheLivenessCheck_IsAnsweredWithItsTraceButNotLogged()
    {
        // The balancer asks every few seconds; a line each time would bury the ones somebody reads.
        await using var api = new Api();

        var (response, _) = await api.SendAsync(HttpMethod.Get, "/healthz", Traceparent);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(TraceId, HeaderOf(response));
        Assert.DoesNotContain(api.Log.Entries, entry => entry.Category == typeof(RequestLogMiddleware).FullName);
    }

    [Fact]
    public async Task Version_WithNothingConfigured_AnswersUnknownUncached()
    {
        await using var api = new Api();

        var (response, body) = await api.SendAsync(HttpMethod.Get, "/api/version");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var version = JsonDocument.Parse(body).RootElement;
        Assert.Equal(BuildVersion.Unknown, version.GetProperty("sha").GetString());
        Assert.Equal(BuildVersion.Unknown, version.GetProperty("builtAt").GetString());
    }

    [Fact]
    public async Task Version_WithWhatTheImageSet_AnswersIt()
    {
        // The image's Build__Sha and Build__Time environment variables, which are these two keys.
        await using var api = new Api();
        api.Settings["Build:Sha"] = "6f84a2ed08be4a3e5fd1b8b777dd3a5fdff7f9a5";
        api.Settings["Build:Time"] = "2026-10-15T09:00:00Z";

        var (_, body) = await api.SendAsync(HttpMethod.Get, "/api/version");

        var version = JsonDocument.Parse(body).RootElement;
        Assert.Equal("6f84a2ed08be4a3e5fd1b8b777dd3a5fdff7f9a5", version.GetProperty("sha").GetString());
        Assert.Equal("2026-10-15T09:00:00Z", version.GetProperty("builtAt").GetString());
    }
}
