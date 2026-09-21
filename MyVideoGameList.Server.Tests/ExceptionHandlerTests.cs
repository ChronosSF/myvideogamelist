using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.Errors;
using NSubstitute;
using Polly.CircuitBreaker;
using Polly.RateLimiting;
using Polly.Timeout;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Which failures leave this API as which status. The distinction the handlers exist to make is
/// "this app is broken" against "the thing behind it is", which is the difference between a
/// pointless retry and a useful one.
/// </summary>
public class ExceptionHandlerTests
{
    private readonly IProblemDetailsService problemDetails = Substitute.For<IProblemDetailsService>();

    private UpstreamFailureHandler Upstream() =>
        new(problemDetails, NullLogger<UpstreamFailureHandler>.Instance);

    private UpstreamBusyHandler Busy() =>
        new(problemDetails, NullLogger<UpstreamBusyHandler>.Instance);

    public ExceptionHandlerTests()
    {
        problemDetails.TryWriteAsync(Arg.Any<ProblemDetailsContext>()).Returns(new ValueTask<bool>(true));
    }

    public static TheoryData<Exception> UpstreamFailures() =>
    [
        new HttpRequestException("connection refused"),
        new BrokenCircuitException(),
        new TimeoutRejectedException(),
        new TaskCanceledException()
    ];

    [Theory]
    [MemberData(nameof(UpstreamFailures))]
    public async Task TryHandle_WhenTheThirdPartyFailed_Answers502(Exception exception)
    {
        var context = new DefaultHttpContext();

        var handled = await Upstream().TryHandleAsync(context, exception, CancellationToken.None);

        Assert.True(handled);
        Assert.Equal(StatusCodes.Status502BadGateway, context.Response.StatusCode);
    }

    [Fact]
    public async Task TryHandle_WhenTheFaultIsOurs_DeclinesIt()
    {
        var context = new DefaultHttpContext();

        var handled = await Upstream()
            .TryHandleAsync(context, new InvalidOperationException(), CancellationToken.None);

        // Declining leaves it to the framework's own 500, which is the honest answer to a bug
        // here: nothing about retrying it would help.
        Assert.False(handled);
        await problemDetails.DidNotReceive().TryWriteAsync(Arg.Any<ProblemDetailsContext>());
    }

    [Fact]
    public async Task TryHandle_WhenOurOwnThrottleRefused_Answers503()
    {
        // The queue in front of IGDB filled up. That is this app protecting a third party's limit
        // under load, not a fault in either - and not the caller's doing, which is why it is not a
        // 429.
        var context = new DefaultHttpContext();

        var handled = await Busy()
            .TryHandleAsync(context, new RateLimiterRejectedException(), CancellationToken.None);

        Assert.True(handled);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, context.Response.StatusCode);
    }

    [Fact]
    public async Task TryHandle_WhenTheThrottleSaysHowLong_PassesItOn()
    {
        var context = new DefaultHttpContext();

        await Busy().TryHandleAsync(
            context,
            new RateLimiterRejectedException(TimeSpan.FromSeconds(2.5)),
            CancellationToken.None);

        Assert.Equal("3", context.Response.Headers.RetryAfter);
    }

    [Fact]
    public async Task TryHandle_TheUpstreamHandler_DeclinesOurOwnThrottle()
    {
        // The two must not overlap: a full queue is a 503, and saying 502 would blame IGDB for
        // something it was never asked.
        var context = new DefaultHttpContext();

        var handled = await Upstream()
            .TryHandleAsync(context, new RateLimiterRejectedException(), CancellationToken.None);

        Assert.False(handled);
    }

    [Fact]
    public async Task TryHandle_WhenTheReaderNavigatedAway_StaysQuiet()
    {
        var context = new DefaultHttpContext { RequestAborted = new CancellationToken(canceled: true) };

        var handled = await new ClientDisconnectHandler()
            .TryHandleAsync(context, new OperationCanceledException(), CancellationToken.None);

        Assert.True(handled);
        Assert.Equal(499, context.Response.StatusCode);
    }

    [Fact]
    public async Task TryHandle_WhenACancellationIsNotTheReaders_DeclinesIt()
    {
        // A TaskCanceledException with the request still live is a timeout on our side of the
        // call, and the handler above turns that into a 502. Treating it as a disconnect would
        // hide a real upstream failure behind a status nobody alarms on.
        var context = new DefaultHttpContext();

        var handled = await new ClientDisconnectHandler()
            .TryHandleAsync(context, new TaskCanceledException(), CancellationToken.None);

        Assert.False(handled);
    }
}
