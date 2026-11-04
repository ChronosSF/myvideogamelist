using System.Diagnostics;
using System.Globalization;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Polly.RateLimiting;

namespace MyVideoGameList.Server.Observability;

/// <summary>
/// One line for every call the API makes to IGDB, written once the resilience pipeline has finished
/// with it, saying how the call ended. It is what the alarm on IGDB's failure rate counts (ADR 0080).
/// </summary>
/// <remarks>
/// <para>
/// A line of our own because the ones already written cannot be counted. The client factory writes
/// an end line for a call that came back with a response and a failure line for one that threw
/// <see cref="HttpRequestException"/>, and nothing at all for one that ended in a timeout or on an
/// open circuit, which are most of what an IGDB outage looks like from here: measured on .NET 10
/// with this client's own pipeline. Polly's lines are one per attempt, and say whether the retry
/// strategy handled a result rather than whether the call failed, so the 401 a rotated credential
/// earns, which is never retried, is "not handled" there.
/// </para>
/// <para>
/// Outermost on the client, so it sees each call as <c>IgdbService</c> does: after the retries, the
/// breaker and both timeouts. The token request goes through the same client and is counted too,
/// since a refused credential fails every call after it.
/// </para>
/// <para>
/// Information, whatever the outcome, because this is a count rather than a report: the failure
/// itself is described by Polly's own lines and by whatever the caller then does with it. The path
/// and nothing else of the address, which here has no query in any case: IGDB's queries travel in
/// the body, and the credentials in a form.
/// </para>
/// </remarks>
internal sealed class IgdbCallLogHandler(ILoggerFactory loggers) : DelegatingHandler
{
    /// <summary>
    /// The category the line is written under. The metric filters in <c>infra/src/Infra/Alarms.cs</c>
    /// match it, so it is stated rather than taken from this type's name, which a rename would change
    /// and stop the count without a word. <c>IgdbCallLogTests</c> reads that file and fails when the two
    /// differ.
    /// </summary>
    public const string Category = "MyVideoGameList.Server.Observability.IgdbCalls";

    /// <summary>IGDB answered, with a success status.</summary>
    public const string Succeeded = "succeeded";

    /// <summary>
    /// IGDB answered with an error status, or did not answer: unreachable, too slow, or behind a
    /// circuit already opened because it had been failing.
    /// </summary>
    public const string Failed = "failed";

    /// <summary>
    /// The caller gave up first: a reader who left, or the host stopping a background job. Not
    /// IGDB's failure. A deadline the caller set itself, and said so with
    /// <see cref="IgdbCallLog.UnderDeadline"/>, is: running past it is <see cref="Failed"/>.
    /// </summary>
    public const string Cancelled = "cancelled";

    /// <summary>
    /// Our own limiter refused the call before it was made, its queue full (a 503, ADR 0034). Not
    /// IGDB's failure either.
    /// </summary>
    public const string Refused = "refused";

    private readonly ILogger logger = loggers.CreateLogger(Category);

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var started = Stopwatch.GetTimestamp();
        try
        {
            var response = await base.SendAsync(request, cancellationToken);
            Write(
                request,
                response.IsSuccessStatusCode ? Succeeded : Failed,
                ((int)response.StatusCode).ToString(CultureInfo.InvariantCulture),
                started);
            return response;
        }
        catch (Exception exception)
        {
            Write(
                request,
                OutcomeOf(exception, cancellationToken, IgdbCallLog.CallersOwnToken),
                exception.GetType().Name,
                started);
            throw;
        }
    }

    /// <summary>
    /// How a call that threw ended. A timeout of the pipeline's is
    /// <see cref="Polly.Timeout.TimeoutRejectedException"/>, which is no cancellation, so only the
    /// caller's token makes one: the caller leaving, unless the call was made under a deadline of
    /// the caller's own and <paramref name="callersOwnToken"/>, the token the caller was itself
    /// handed, is still live, in which case it was the deadline that ran out.
    /// </summary>
    internal static string OutcomeOf(
        Exception exception,
        CancellationToken cancellationToken,
        CancellationToken? callersOwnToken) => exception switch
        {
            OperationCanceledException when cancellationToken.IsCancellationRequested =>
                callersOwnToken is { IsCancellationRequested: false } ? Failed : Cancelled,
            RateLimiterRejectedException => Refused,
            _ => Failed,
        };

    private void Write(HttpRequestMessage request, string outcome, string result, long started)
    {
        if (!logger.IsEnabled(LogLevel.Information)) return;

        logger.LogInformation(
            "IGDB {Endpoint} {Outcome} in {ElapsedMilliseconds} ms: {Result}",
            request.RequestUri?.AbsolutePath ?? string.Empty,
            outcome,
            Math.Round(Stopwatch.GetElapsedTime(started).TotalMilliseconds, 1),
            result);
    }
}

public static class IgdbCallLog
{
    private static readonly AsyncLocal<CancellationToken?> Deadline = new();

    /// <summary>
    /// The token the caller of the IGDB call now being made was itself handed, while it calls under
    /// a deadline of its own; null otherwise.
    /// </summary>
    internal static CancellationToken? CallersOwnToken => Deadline.Value;

    /// <summary>
    /// Marks the IGDB calls made inside it as bounded by a deadline the caller set itself, so that
    /// their line can tell IGDB not answering in time from the caller going away.
    /// </summary>
    /// <remarks>
    /// The handler is handed one token, the caller's own linked with its deadline, and cannot tell
    /// which of the two cancelled it. The caller can, so it passes <paramref name="callersOwnToken"/>,
    /// the token it was itself handed: a cancellation while that one is still live is the deadline
    /// running out, which a hanging IGDB causes and the alarm has to count, and one after it is the
    /// caller stopping. Without this the refresh, whose fifteen seconds is such a deadline and which is
    /// on a quiet site the only caller there is, would log a hanging IGDB as cancelled throughout.
    /// </remarks>
    public static IDisposable UnderDeadline(CancellationToken callersOwnToken)
    {
        var previous = Deadline.Value;
        Deadline.Value = callersOwnToken;
        return new Restore(previous);
    }

    private sealed class Restore(CancellationToken? previous) : IDisposable
    {
        public void Dispose() => Deadline.Value = previous;
    }

    /// <summary>
    /// Adds the call line to a client. Before <c>AddIgdbResilience</c>, because the client factory
    /// runs its handlers in the order they were added, and the line has to be outside the retries.
    /// </summary>
    public static IHttpClientBuilder AddIgdbCallLog(this IHttpClientBuilder builder)
    {
        builder.Services.TryAddTransient<IgdbCallLogHandler>();
        return builder.AddHttpMessageHandler<IgdbCallLogHandler>();
    }
}
