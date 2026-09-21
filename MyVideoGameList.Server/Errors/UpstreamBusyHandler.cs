using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Polly.RateLimiting;

namespace MyVideoGameList.Server.Errors;

/// <summary>
/// Answers 503 when our own throttle, rather than IGDB, is what refused the call.
/// </summary>
/// <remarks>
/// <para>
/// The IGDB pipeline paces calls at four a second and queues a burst sixty-four deep
/// (<c>Services/IgdbResilience.cs</c>). Past that the limiter refuses, and without this the
/// refusal surfaced as a 500 — an application fault, which it is not. It is this app deciding to
/// protect a third party's documented limit under a load spike, and the honest answer is "busy,
/// try shortly".
/// </para>
/// <para>
/// 503 rather than 429, which the review that raised this offered as an alternative: 429 tells the
/// caller *they* asked too often, and they did not. The queue they are behind is everybody's.
/// </para>
/// </remarks>
public sealed class UpstreamBusyHandler(
    IProblemDetailsService problemDetails,
    ILogger<UpstreamBusyHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        if (exception is not RateLimiterRejectedException rejected) return false;

        // Nothing from the request is logged: the fact worth having is that the queue filled, and
        // it is about load rather than about who asked. A sustained rate of this is the signal
        // that the cache in front of IGDB is not doing its job.
        logger.LogWarning(exception, "The IGDB rate limiter refused a call; its queue is full");

        httpContext.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;

        if (rejected.RetryAfter is { } wait)
        {
            httpContext.Response.Headers.RetryAfter =
                ((int)Math.Ceiling(wait.TotalSeconds)).ToString();
        }

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails = new ProblemDetails
            {
                Status = StatusCodes.Status503ServiceUnavailable,
                Title = "Busy fetching game data",
                Detail = "Too many people are browsing games at once. Try again in a moment — "
                    + "your own lists, scores and playthroughs are unaffected."
            }
        });
    }
}
