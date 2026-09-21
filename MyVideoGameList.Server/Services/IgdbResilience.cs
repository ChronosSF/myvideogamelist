using System.Threading.RateLimiting;
using Microsoft.Extensions.Http.Resilience;
using Polly;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// What happens to an IGDB call when IGDB is slow, rate-limiting us, or down.
/// </summary>
/// <remarks>
/// <para>
/// Before this, every call was one attempt and <c>EnsureSuccessStatusCode</c>: a single dropped
/// connection became a 500 on somebody's game page, and a bad afternoon at IGDB became thousands
/// of them, each one waiting the full timeout first.
/// </para>
/// <para>
/// Retrying is safe here in a way it usually is not for the verb involved. IGDB's query protocol
/// is a POST with the query in the body, but every call this app makes is a read — there is no
/// IGDB write in the product at all — so a repeated request cannot duplicate anything.
/// </para>
/// </remarks>
public static class IgdbResilience
{
    /// <summary>
    /// IGDB's documented ceiling is four requests a second. The limiter is per process, so a
    /// second instance doubles what IGDB sees; the shared limit belongs with the distributed
    /// cache, which is what stops the instances duplicating each other's work in the first place.
    /// </summary>
    private const int RequestsPerSecond = 4;

    /// <summary>
    /// The order below is the whole design, and the obvious arrangement is wrong.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A Polly pipeline runs outermost first, and the rate limiter used to be outermost. That
    /// paced <em>operations</em> rather than requests: one permit covered the original call and
    /// both of its retries, so four permits a second admitted up to twelve requests a second at
    /// IGDB — three times the limit the limiter exists to keep.
    /// </para>
    /// <para>
    /// So retry is outermost now and the limiter sits below it, where every actual attempt has to
    /// take a permit of its own. The breaker stays above the limiter deliberately: below it, a
    /// call that is going to be refused by an open circuit would first consume a permit and make
    /// real calls queue behind a failure that is already decided.
    /// </para>
    /// <para>
    /// The cost of the new order is latency — three attempts may now each wait for a permit — so a
    /// total timeout bounds the whole operation from the outside.
    /// </para>
    /// </remarks>
    public static IHttpClientBuilder AddIgdbResilience(this IHttpClientBuilder builder)
    {
        builder.AddResilienceHandler("igdb", pipeline => pipeline

            // The ceiling on everything below, retries and queueing included. Somebody is waiting
            // for a page; half a minute is already longer than they will.
            .AddTimeout(TimeSpan.FromSeconds(30))

            // Twice, quickly. The caller is a page somebody is watching, so this is about riding
            // out a dropped connection or a single 429, not about persistence.
            .AddRetry(new HttpRetryStrategyOptions
            {
                MaxRetryAttempts = 2,
                Delay = TimeSpan.FromSeconds(1),
                BackoffType = DelayBackoffType.Exponential,
                UseJitter = true
            })

            // Once half of a sample is failing, stop asking for fifteen seconds. Retrying into an
            // outage turns one upstream failure into three, and every one of them holds a request
            // open here. The features that can live without IGDB - stored lists, profile
            // statistics, the export - do not touch this client at all.
            .AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
            {
                SamplingDuration = TimeSpan.FromSeconds(30),
                MinimumThroughput = 8,
                FailureRatio = 0.5,
                BreakDuration = TimeSpan.FromSeconds(15)
            })

            // Four a second in quarter-second steps, so the upcoming-releases loop - ten pages one
            // after another - is paced rather than spending its whole allowance in the first
            // instant. A burst waits its turn instead of failing; past the queue's depth it is
            // refused, and Errors/UpstreamBusyHandler.cs turns that into a 503 rather than letting
            // our own throttle look like an application fault.
            .AddRateLimiter(new SlidingWindowRateLimiter(new SlidingWindowRateLimiterOptions
            {
                PermitLimit = RequestsPerSecond,
                Window = TimeSpan.FromSeconds(1),
                SegmentsPerWindow = 4,
                QueueLimit = 64,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst
            }))

            // Per attempt, innermost, so waiting for a permit is not charged to it. Well inside the
            // client's own 100-second default: a page that is going to fail should fail while the
            // reader is still watching.
            .AddTimeout(TimeSpan.FromSeconds(10)));

        return builder;
    }
}
