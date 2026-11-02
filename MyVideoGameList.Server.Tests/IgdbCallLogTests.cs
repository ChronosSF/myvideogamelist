using System.Net;
using Microsoft.Extensions.Logging;
using MyVideoGameList.Server.Observability;
using Polly.CircuitBreaker;
using Polly.RateLimiting;
using Polly.Timeout;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The line the alarm on IGDB's failure rate counts: one per call, and what each way a call can end
/// is counted as. Its place on the client <c>Program.cs</c> builds is <see cref="ApiPipelineTests"/>.
/// </summary>
public class IgdbCallLogTests
{
    private sealed class Answering(Func<CancellationToken, Task<HttpResponseMessage>> answer) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) => answer(cancellationToken);
    }

    /// <summary>
    /// One call through the handler, answered as given: the one line it wrote, and what the caller
    /// was thrown, if anything.
    /// </summary>
    private static async Task<(RecordingLoggerProvider.Entry Line, Exception? Thrown)> Call(
        Func<CancellationToken, Task<HttpResponseMessage>> answer,
        CancellationToken cancellationToken = default)
    {
        var log = new RecordingLoggerProvider();
        using var loggers = LoggerFactory.Create(builder => builder.AddProvider(log));
        using var invoker = new HttpMessageInvoker(new IgdbCallLogHandler(loggers) { InnerHandler = new Answering(answer) });
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.igdb.com/v4/games");

        Exception? thrown = null;
        try
        {
            using var response = await invoker.SendAsync(request, cancellationToken);
        }
        catch (Exception exception)
        {
            thrown = exception;
        }

        return (Assert.Single(log.Entries), thrown);
    }

    private static Func<CancellationToken, Task<HttpResponseMessage>> Status(HttpStatusCode status) =>
        _ => Task.FromResult(new HttpResponseMessage(status));

    private static Func<CancellationToken, Task<HttpResponseMessage>> Throw(Exception exception) =>
        _ => Task.FromException<HttpResponseMessage>(exception);

    [Fact]
    public async Task SendAsync_ASuccessStatus_IsSucceededUnderTheCategoryTheAlarmsMatch()
    {
        var (line, thrown) = await Call(Status(HttpStatusCode.OK));

        Assert.Null(thrown);
        Assert.Equal(IgdbCallLogHandler.Category, line.Category);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Equal(IgdbCallLogHandler.Succeeded, line.Value("Outcome"));
        Assert.Equal("200", line.Value("Result"));
        Assert.Equal("/v4/games", line.Value("Endpoint"));
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    // What a rotated credential earns, and is never retried: still IGDB failing us.
    [InlineData(HttpStatusCode.Unauthorized)]
    public async Task SendAsync_AnErrorStatus_IsFailedWithTheStatus(HttpStatusCode status)
    {
        var (line, _) = await Call(Status(status));

        Assert.Equal(IgdbCallLogHandler.Failed, line.Value("Outcome"));
        Assert.Equal(((int)status).ToString(), line.Value("Result"));
        // Information all the same: the line is a count, and the failure is described elsewhere.
        Assert.Equal(LogLevel.Information, line.Level);
    }

    public static TheoryData<Exception> NoAnswer() => new()
    {
        new HttpRequestException("No connection could be made."),
        // The two the client factory's own lines leave out, and most of an outage.
        new BrokenCircuitException(),
        new TimeoutRejectedException(),
        // The client's own timeout, with nobody having given up: no answer, so a failure.
        new TaskCanceledException(),
    };

    [Theory]
    [MemberData(nameof(NoAnswer))]
    public async Task SendAsync_NoAnswer_IsFailedAndStillThrown(Exception exception)
    {
        var (line, thrown) = await Call(Throw(exception));

        Assert.Same(exception, thrown);
        Assert.Equal(IgdbCallLogHandler.Failed, line.Value("Outcome"));
        Assert.Equal(exception.GetType().Name, line.Value("Result"));
    }

    [Fact]
    public async Task SendAsync_TheCallerGivingUp_IsCancelledRatherThanFailed()
    {
        using var reader = new CancellationTokenSource();
        await reader.CancelAsync();

        var (line, thrown) = await Call(token =>
        {
            token.ThrowIfCancellationRequested();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        }, reader.Token);

        Assert.IsAssignableFrom<OperationCanceledException>(thrown);
        Assert.Equal(IgdbCallLogHandler.Cancelled, line.Value("Outcome"));
    }

    [Fact]
    public async Task SendAsync_OurOwnLimiterRefusing_IsRefusedRatherThanFailed()
    {
        var (line, _) = await Call(Throw(new RateLimiterRejectedException()));

        Assert.Equal(IgdbCallLogHandler.Refused, line.Value("Outcome"));
    }

    [Fact]
    public void TheAlarms_MatchThisCategoryAndBothOutcomesTheyCount()
    {
        // The metric filters live in the CDK app, which cannot reference this project, so they state
        // the strings again. A rename on either side would stop the count with a clean log, and the
        // alarm would sit at OK through an outage.
        var alarms = File.ReadAllText(Path.Combine(RepositoryRoot(), "infra", "src", "Infra", "Alarms.cs"));

        Assert.Contains($"\"{IgdbCallLogHandler.Category}\"", alarms);
        Assert.Contains($"\"{IgdbCallLogHandler.Succeeded}\"", alarms);
        Assert.Contains($"\"{IgdbCallLogHandler.Failed}\"", alarms);
    }

    private static string RepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "MyVideoGameList.slnx"))) return directory.FullName;
        }

        throw new InvalidOperationException("The repository root, which holds MyVideoGameList.slnx, is above the test assembly.");
    }
}
