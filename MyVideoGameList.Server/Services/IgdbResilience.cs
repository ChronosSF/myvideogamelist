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

    public static IHttpClientBuilder AddIgdbResilience(this IHttpClientBuilder builder)
    {
        builder.AddResilienceHandler("igdb", pipeline => pipeline

            // Outermost, so the wait for a permit is not counted against an attempt's timeout and
            // a burst queues instead of failing. Four per second in quarter-second steps: the
            // upcoming-releases loop pages ten times in a row and would otherwise spend its whole
            // allowance in the first instant.
            .AddRateLimiter(new SlidingWindowRateLimiter(new SlidingWindowRateLimiterOptions
            {
                PermitLimit = RequestsPerSecond,
                Window = TimeSpan.FromSeconds(1),
                SegmentsPerWindow = 4,
                QueueLimit = 64,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst
            }))

            // Twice, quickly. The caller is a page somebody is waiting for, so this is about
            // riding out a dropped connection or a single 429, not about persistence.
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

            // Per attempt, and well inside the client's own 100-second default: a page that is
            // going to fail should fail while the reader is still watching.
            .AddTimeout(TimeSpan.FromSeconds(10)));

        return builder;
    }
}
