using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using MyVideoGameList.Server.Security;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The 429 is the error a person is most likely to report ("it will not let me log in"), so it has
/// to carry what every other error carries. Writing it by hand skipped the shared customisation
/// that adds the trace identifier, which is what these tests exist to stop happening again.
/// </summary>
public class RateLimitRejectionTests
{
    private readonly IProblemDetailsService problemDetails = Substitute.For<IProblemDetailsService>();

    private DefaultHttpContext Context()
    {
        var services = new ServiceCollection();
        services.AddSingleton(problemDetails);

        return new DefaultHttpContext { RequestServices = services.BuildServiceProvider() };
    }

    private ProblemDetails Written() =>
        (ProblemDetails)problemDetails.ReceivedCalls().Single().GetArguments()
            .OfType<ProblemDetailsContext>().Single().ProblemDetails;

    [Fact]
    public async Task WriteTooManyRequests_GoesThroughTheSharedWriter()
    {
        var context = Context();

        await RateLimiting.WriteTooManyRequests(context, retryAfter: null);

        Assert.Equal(StatusCodes.Status429TooManyRequests, context.Response.StatusCode);
        Assert.Equal(StatusCodes.Status429TooManyRequests, Written().Status);
        Assert.Equal("Too many requests", Written().Title);
    }

    [Fact]
    public async Task WriteTooManyRequests_WithNoRetryAfter_PromisesNothingSpecific()
    {
        var context = Context();

        await RateLimiting.WriteTooManyRequests(context, retryAfter: null);

        // The sliding window supplies no metadata, so there is no honest number to give.
        Assert.False(context.Response.Headers.ContainsKey("Retry-After"));
        Assert.Contains("Wait a few minutes", Written().Detail);
    }

    [Fact]
    public async Task WriteTooManyRequests_WithRetryAfter_SaysWhenAndSetsTheHeader()
    {
        var context = Context();

        await RateLimiting.WriteTooManyRequests(context, TimeSpan.FromSeconds(42.4));

        Assert.Equal("43", context.Response.Headers.RetryAfter);
        Assert.Contains("43 seconds", Written().Detail);
    }
}
