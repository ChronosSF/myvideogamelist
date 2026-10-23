using System.Diagnostics;
using Microsoft.AspNetCore.Http.Features;

namespace MyVideoGameList.Server.Observability;

/// <summary>
/// The one identifier a request is known by: the W3C trace id of the activity ASP.NET starts for it.
/// </summary>
/// <remarks>
/// <para>
/// ASP.NET starts an <see cref="Activity"/> for every request and continues a caller's trace when
/// the request carries a valid <c>traceparent</c>. The SSR server sends one on every call a render
/// makes, so a page and every API request behind it share one id: the one the document's
/// <c>X-Trace-Id</c> names, the one every log line written while serving the request carries as its
/// <c>TraceId</c> scope, and the one a <c>ProblemDetails</c> gives as <c>traceId</c>. A browser
/// sends none, so its own request starts the trace. See <c>docs/decisions/0059-*</c>.
/// </para>
/// <para>
/// Anybody can choose the id their own request is known by, which is why nothing may ever key on
/// it: it finds log lines, and it authorises nothing.
/// </para>
/// </remarks>
internal static class TraceIds
{
    /// <summary>
    /// The response header naming the request's trace, on every answer either process sends.
    /// </summary>
    public const string HeaderName = "X-Trace-Id";

    /// <summary>
    /// Every activity in W3C format, whatever the caller sent. Called once, before the host is built.
    /// </summary>
    /// <remarks>
    /// .NET 10's propagator is W3C-only and drops most malformed headers itself, and the request
    /// then starts a trace of its own. One kind gets through: a later version's header, which the
    /// recommendation lets carry more fields than version 00 has. The propagator passes it on, the
    /// activity's parser refuses it, and the activity falls back to the hierarchical format — both
    /// measured, on 10.0.11. Its <see cref="Activity.TraceId"/> is then all zeros, while the
    /// <c>TraceId</c> scope on every log line is the header's own text, so the body and the log
    /// would name the request differently and the log would carry whatever the caller wrote.
    /// Forced, the activity starts a trace of its own there too, as the recommendation asks of a
    /// receiver that cannot read what it was sent.
    /// </remarks>
    public static void UseW3COnly()
    {
        Activity.DefaultIdFormat = ActivityIdFormat.W3C;
        Activity.ForceDefaultIdFormat = true;
    }

    /// <summary>
    /// The trace id of the activity ASP.NET started for this request, as 32 lowercase hex digits.
    /// </summary>
    /// <remarks>
    /// The request's own activity rather than <see cref="Activity.Current"/>, which is a child of it
    /// while an outbound call is in flight; the trace id is the same, but this is the one the
    /// request is about. ASP.NET starts that activity only while its hosting log is enabled at some
    /// level or something listens, both of which hold here. If neither did there would be no trace
    /// id in the log scopes either, and the request identifier is the one id both still carry.
    /// </remarks>
    public static string Of(HttpContext context) =>
        context.Features.Get<IHttpActivityFeature>()?.Activity is { IdFormat: ActivityIdFormat.W3C } activity
            ? activity.TraceId.ToHexString()
            : context.TraceIdentifier;
}
