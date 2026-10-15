using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.Extensions.Logging.Console;

namespace MyVideoGameList.Server.Observability;

/// <summary>
/// How the API writes its log: one JSON object per line wherever it is deployed, and the plain
/// console a developer reads on their own machine.
/// </summary>
/// <remarks>
/// <para>
/// JSON because what reads it deployed is CloudWatch, which splits a stream into events at line
/// breaks and can query a field only if the line is an object. The simple formatter's two lines per
/// entry, and an exception's stack across twenty more, arrive there as separate events with
/// nothing to say they belong together.
/// </para>
/// <para>
/// The scopes go into every line: the trace id ASP.NET puts there from the request's activity, the
/// request path and the request id. That is what lets one id find everything a request wrote
/// (ADR 0059).
/// </para>
/// </remarks>
public static class ApiLogging
{
    /// <summary>
    /// The timestamp's format, in UTC: to the millisecond, and sortable as text. The JSON formatter
    /// writes no timestamp at all unless it is given one.
    /// </summary>
    internal const string TimestampFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    public static ILoggingBuilder AddApiConsole(this ILoggingBuilder logging, IHostEnvironment environment)
    {
        // Stated rather than inherited, though it is the host's default today: the trace id in
        // every line's scopes is what the correlation rests on, and a default can change under it.
        logging.Configure(options => options.ActivityTrackingOptions =
            ActivityTrackingOptions.TraceId | ActivityTrackingOptions.SpanId | ActivityTrackingOptions.ParentId);

        if (environment.IsDevelopment()) return logging;

        return logging.AddJsonConsole(options =>
        {
            options.IncludeScopes = true;
            options.UseUtcTimestamp = true;
            options.TimestampFormat = TimestampFormat;

            // One line still, because quotes, backslashes and control characters are escaped all the
            // same. What the relaxed encoder leaves alone is everything an HTML page would care about,
            // which a log line read in CloudWatch is not: with the default one, every stack frame of
            // an async method reads `<QueryAsync>d__12`, and every quoted identifier in a
            // failed SQL command `"…"`, in the raw stream and in `aws logs tail`.
            options.JsonWriterOptions = new JsonWriterOptions
            {
                Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
                Indented = false,
            };
        });
    }
}
