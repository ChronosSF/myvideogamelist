using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using MyVideoGameList.Server.Errors;
using MyVideoGameList.Server.Observability;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The id a request is known by, through the real hosting layer. That layer is what reads a caller's
/// <c>traceparent</c> and starts the request's activity, so nothing short of it can say what a page's
/// render, a malformed header or no header at all end up named.
/// </summary>
/// <remarks>
/// The pipeline is the application's own pieces in the application's own order — the request log,
/// then the exception handler — with endpoints that stand in for a controller: one that answers, one
/// that fails as a bug does, and the liveness check.
/// </remarks>
public sealed class TraceIdTests
{
    private const string TraceId = "4bf92f3577b34da6a3ce929d0e0e4736";

    /// <summary>What the SSR server sends: its trace, its request's span, sampled.</summary>
    private const string Traceparent = $"00-{TraceId}-00f067aa0ba902b7-01";

    private sealed class Pipeline : IAsyncDisposable
    {
        private readonly WebApplication app;

        private Pipeline(WebApplication app, RecordingLoggerProvider log)
        {
            this.app = app;
            Log = log;
            Client = app.GetTestClient();
        }

        public HttpClient Client { get; }

        public RecordingLoggerProvider Log { get; }

        public static async Task<Pipeline> StartAsync(Action<WebApplicationBuilder>? configure = null)
        {
            TraceIds.UseW3COnly();

            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = Environments.Production,
            });
            builder.WebHost.UseTestServer();

            // The application's logging configuration, minus the JSON console it adds, which would
            // write into the test run's own output. What is kept is what decides a line's scopes.
            var log = new RecordingLoggerProvider();
            builder.Logging.AddApiConsole(builder.Environment);
            builder.Logging.ClearProviders();
            builder.Logging.AddProvider(log);

            builder.Services.AddApiProblemDetails();
            configure?.Invoke(builder);

            var app = builder.Build();
            app.UseRequestLog();
            app.UseExceptionHandler();
            app.MapGet("/answers", () => "fine");
            app.MapGet("/fails", string () => throw new InvalidOperationException("A bug."));
            app.MapGet("/healthz", () => "Healthy");
            app.MapBuildVersion();

            await app.StartAsync();
            return new Pipeline(app, log);
        }

        /// <summary>A GET, read to its end so that every line the request writes has been written.</summary>
        public async Task<(HttpResponseMessage Response, string Body)> GetAsync(string path, string? traceparent = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, path);
            if (traceparent is not null) request.Headers.TryAddWithoutValidation("traceparent", traceparent);

            var response = await Client.SendAsync(request);
            return (response, await response.Content.ReadAsStringAsync());
        }

        public IReadOnlyList<RecordingLoggerProvider.Entry> LinesFor(string path) =>
            Log.Entries.Where(entry => entry.Scope("RequestPath") == path).ToList();

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.DisposeAsync();
        }
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
        await using var pipeline = await Pipeline.StartAsync();

        var (response, body) = await pipeline.GetAsync("/fails", Traceparent);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal(TraceId, TraceIdIn(body));
        Assert.Equal(TraceId, HeaderOf(response));

        // The exception handler's error and the request's own line both, and every one of them under
        // the trace the render started.
        var lines = pipeline.LinesFor("/fails");
        Assert.Contains(lines, line => line.Level == LogLevel.Error);
        Assert.Contains(lines, line => line.Category == typeof(RequestLogMiddleware).FullName);
        Assert.All(lines, line => Assert.Equal(TraceId, line.Scope("TraceId")));
    }

    [Fact]
    public async Task Request_WithoutATraceparent_StartsATraceOfItsOwn()
    {
        // A browser's own call, which reaches the API directly and so is the root of its trace.
        await using var pipeline = await Pipeline.StartAsync();

        var (response, body) = await pipeline.GetAsync("/fails");

        var traceId = TraceIdIn(body);
        AssertFreshTraceId(traceId);
        Assert.Equal(traceId, HeaderOf(response));
        Assert.All(pipeline.LinesFor("/fails"), line => Assert.Equal(traceId, line.Scope("TraceId")));
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
    public async Task Request_WithATraceparentItCannotRead_StartsATraceOfItsOwn(string traceparent)
    {
        await using var pipeline = await Pipeline.StartAsync();

        var (response, body) = await pipeline.GetAsync("/fails", traceparent);

        var traceId = TraceIdIn(body);
        AssertFreshTraceId(traceId);
        Assert.NotEqual(TraceId, traceId);
        Assert.Equal(traceId, HeaderOf(response));
    }

    [Fact]
    public async Task Request_ThatIsAnswered_LeavesOneLineWithItsStatusPathAndTrace()
    {
        await using var pipeline = await Pipeline.StartAsync();

        var (response, _) = await pipeline.GetAsync("/answers", Traceparent);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(TraceId, HeaderOf(response));

        var line = Assert.Single(pipeline.LinesFor("/answers"));
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Equal("GET", line.Value("Method"));
        Assert.Equal("/answers", line.Value("Path"));
        Assert.Equal(200, line.Value("StatusCode"));
        Assert.Equal(TraceId, line.Value("TraceId"));
        Assert.Equal(TraceId, line.Scope("TraceId"));
    }

    [Fact]
    public async Task Request_ThatFails_IsLoggedWithTheStatusItWasAnsweredWith()
    {
        await using var pipeline = await Pipeline.StartAsync();

        await pipeline.GetAsync("/fails");

        var line = Assert.Single(pipeline.LinesFor("/fails"),
            entry => entry.Category == typeof(RequestLogMiddleware).FullName);
        Assert.Equal(500, line.Value("StatusCode"));
    }

    [Fact]
    public async Task Request_ForTheLivenessCheck_IsAnsweredWithItsTraceButNotLogged()
    {
        // The balancer asks every few seconds; a line each time would bury the ones somebody reads.
        await using var pipeline = await Pipeline.StartAsync();

        var (response, _) = await pipeline.GetAsync("/healthz", Traceparent);

        Assert.Equal(TraceId, HeaderOf(response));
        Assert.DoesNotContain(pipeline.Log.Entries,
            entry => entry.Category == typeof(RequestLogMiddleware).FullName);
    }

    [Fact]
    public async Task Request_ToAPathWithALineBreakInIt_IsLoggedOnOneLine()
    {
        // The path arrives decoded, so a crafted one would otherwise forge a line of its own.
        await using var pipeline = await Pipeline.StartAsync();

        await pipeline.GetAsync("/nothing%0AINFO:%20all%20clear");

        var line = Assert.Single(pipeline.Log.Entries,
            entry => entry.Category == typeof(RequestLogMiddleware).FullName);
        Assert.Equal(404, line.Value("StatusCode"));
        Assert.DoesNotContain('\n', line.Message);
    }

    [Fact]
    public async Task Version_WithNothingConfigured_AnswersUnknownUncached()
    {
        await using var pipeline = await Pipeline.StartAsync();

        var (response, body) = await pipeline.GetAsync(BuildVersion.Path);

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
        await using var pipeline = await Pipeline.StartAsync(builder =>
        {
            builder.Configuration["Build:Sha"] = "6f84a2ed08be4a3e5fd1b8b777dd3a5fdff7f9a5";
            builder.Configuration["Build:Time"] = "2026-10-15T09:00:00Z";
        });

        var version = await pipeline.Client.GetFromJsonAsync<JsonElement>(BuildVersion.Path);

        Assert.Equal("6f84a2ed08be4a3e5fd1b8b777dd3a5fdff7f9a5", version.GetProperty("sha").GetString());
        Assert.Equal("2026-10-15T09:00:00Z", version.GetProperty("builtAt").GetString());
    }

    [Fact]
    public void StatusOf_AnExceptionPastTheHandlerBeforeAnythingWasSent_IsA500()
    {
        // The server answers such a request with a 500, whatever the status said when it escaped.
        // The pipeline above cannot produce one: the exception handler catches everything first.
        var response = new Microsoft.AspNetCore.Http.DefaultHttpContext().Response;
        response.StatusCode = 200;

        Assert.Equal(500, RequestLogMiddleware.StatusOf(response, escaped: true));
        Assert.Equal(200, RequestLogMiddleware.StatusOf(response, escaped: false));
    }
}
