using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MyVideoGameList.Server.Security;

/// <summary>
/// The API's request rate limits.
/// </summary>
/// <remarks>
/// <para>
/// Only the endpoints that accept a password are limited, and the limit partitions by client
/// address. That is deliberately narrow: the front end renders on a server of its own
/// (<c>docs/decisions/0003-two-process-deployment.md</c>), so every loader fetch reaches this API
/// from that one process. A limit applied to the whole API and partitioned by address would put
/// every visitor's server render into a single bucket and throttle the site as though it were one
/// abusive client. Browsers call <c>/api/auth/login</c> and <c>/api/auth/register</c> directly and
/// nothing else does, which is what makes the address a meaningful partition here and nowhere
/// else yet. Volume control for the rest belongs at the edge, with the CDN in front of it.
/// </para>
/// <para>
/// This is also the half of the brute-force defence that is allowed to speak. Identity's lockout
/// counts failures per account and answers a locked account with the same 401 as a wrong password,
/// because a distinct answer would reveal that the account exists. A limit keyed on the caller's
/// address reveals nothing about who is registered, so it can say plainly that there have been too
/// many attempts.
/// </para>
/// </remarks>
public static class RateLimiting
{
    /// <summary>The policy guarding the endpoints that take a password.</summary>
    public const string AuthWrites = "auth-writes";

    /// <summary>
    /// Attempts allowed per <see cref="Window"/>. Ten is well above what a person mistyping a
    /// password reaches and far below what guessing needs, and it has to leave room for a
    /// household or an office sharing one address.
    /// </summary>
    private const int PermitLimit = 10;

    private static readonly TimeSpan Window = TimeSpan.FromMinutes(5);

    public static IServiceCollection AddApiRateLimiting(this IServiceCollection services)
    {
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            options.AddPolicy(AuthWrites, context => RateLimitPartition.GetSlidingWindowLimiter(
                PartitionKey(context),
                _ => new SlidingWindowRateLimiterOptions
                {
                    PermitLimit = PermitLimit,
                    Window = Window,

                    // The window slides in one-minute steps, so the budget refills gradually
                    // instead of the whole allowance arriving at once every five minutes.
                    SegmentsPerWindow = 5,

                    // Refuse rather than queue. A caller over the limit wants an answer, and a
                    // held-open request is a resource an attacker would be delighted to spend.
                    QueueLimit = 0
                }));

            options.OnRejected = WriteProblemDetails;
        });

        return services;
    }

    /// <summary>
    /// The client address, or a single shared bucket when there is none. A request with no remote
    /// address is not normal traffic; putting them together means such requests limit each other
    /// rather than being exempt.
    /// </summary>
    private static string PartitionKey(HttpContext context) =>
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    /// <summary>
    /// Answers in the same shape as every other error the API produces, so the client's existing
    /// reader finds a message to show rather than falling back to "login failed" — which is the
    /// one thing this response must not be mistaken for.
    /// </summary>
    private static async ValueTask WriteProblemDetails(
        OnRejectedContext context,
        CancellationToken cancellationToken)
    {
        var response = context.HttpContext.Response;
        response.StatusCode = StatusCodes.Status429TooManyRequests;

        var detail = "Too many attempts from this device. Try again later.";

        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        {
            var seconds = (int)Math.Ceiling(retryAfter.TotalSeconds);
            response.Headers.RetryAfter = seconds.ToString();
            detail = $"Too many attempts from this device. Try again in {seconds} seconds.";
        }

        await response.WriteAsJsonAsync(
            new ProblemDetails
            {
                Status = StatusCodes.Status429TooManyRequests,
                Title = "Too many requests",
                Detail = detail
            },
            options: null,
            contentType: "application/problem+json",
            cancellationToken);
    }
}
