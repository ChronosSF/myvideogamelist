using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Polly.CircuitBreaker;
using Polly.Timeout;

namespace MyVideoGameList.Server.Errors;

/// <summary>
/// Turns a failed call to somebody else's service into a 502 rather than a 500.
/// </summary>
/// <remarks>
/// <para>
/// The distinction is not pedantry: a 500 says this app is broken and a retry is pointless, and a
/// 502 says the thing behind it is unavailable and the request may well work later. The front end
/// already makes exactly that distinction for its own loaders — an unreachable API is a deliberate
/// 502 there — so an IGDB outage arriving as a 500 was the one failure the two halves described
/// differently.
/// </para>
/// <para>
/// The circuit breaker makes this common rather than rare: once it opens, every request fails
/// immediately with <see cref="BrokenCircuitException"/> without an HTTP call happening at all.
/// </para>
/// </remarks>
public sealed class UpstreamFailureHandler(
    IProblemDetailsService problemDetails,
    ILogger<UpstreamFailureHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        if (!IsUpstreamFailure(exception)) return false;

        // Warning rather than error: the app did what it should, and the alarm worth having on
        // this is a rate rather than an occurrence.
        logger.LogWarning(
            exception,
            "Upstream call failed while serving {Method} {Path}",
            httpContext.Request.Method,
            httpContext.Request.Path);

        httpContext.Response.StatusCode = StatusCodes.Status502BadGateway;

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails = new ProblemDetails
            {
                Status = StatusCodes.Status502BadGateway,
                Title = "A service this page depends on is unavailable",
                Detail = "Game data comes from IGDB, which did not answer. Your own lists, "
                    + "scores and playthroughs are unaffected."
            }
        });
    }

    /// <summary>
    /// Everything the resilience pipeline can end a call with, plus the plain failure to reach a
    /// host. <see cref="TaskCanceledException"/> is here as a timeout: a cancelled <em>request</em>
    /// is handled before this, by <see cref="ClientDisconnectHandler"/>.
    /// </summary>
    private static bool IsUpstreamFailure(Exception exception) => exception
        is HttpRequestException
        or BrokenCircuitException
        or TimeoutRejectedException
        or TaskCanceledException;
}
