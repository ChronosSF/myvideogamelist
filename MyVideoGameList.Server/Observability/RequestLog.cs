using System.Diagnostics;
using MyVideoGameList.Server.Errors;

namespace MyVideoGameList.Server.Observability;

/// <summary>
/// One line for every request the API answers, written once it has been answered, and the name of
/// its trace on the answer itself.
/// </summary>
/// <remarks>
/// <para>
/// The status is on this line rather than in a scope, because a scope is opened before there is a
/// response to have a status. Every other line written while serving the request carries the trace
/// id and the path as scopes of its own, which ASP.NET opens; this is the line that says how the
/// request ended, so a reader's trace id finds at least one line even when nothing went wrong.
/// </para>
/// <para>
/// The method and the path, and never the query string. A search term is whatever somebody typed,
/// an email address included, and nothing that logs an address, a cookie or a token belongs here:
/// the request's headers are not read at all. Both values come from the request, so they go through
/// <see cref="LogText"/> first, as everywhere else that logs one.
/// </para>
/// </remarks>
public sealed class RequestLogMiddleware(RequestDelegate next, ILogger<RequestLogMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var started = Stopwatch.GetTimestamp();

        // When the response starts rather than now, for the reason SecurityHeadersMiddleware gives:
        // the exception handler clears the headers before it writes a 500 or a 502, and those are
        // the answers most likely to be reported.
        context.Response.OnStarting(static state =>
        {
            var httpContext = (HttpContext)state;
            httpContext.Response.Headers[TraceIds.HeaderName] = TraceIds.Of(httpContext);
            return Task.CompletedTask;
        }, context);

        var escaped = false;
        try
        {
            await next(context);
        }
        catch
        {
            escaped = true;
            throw;
        }
        finally
        {
            if (!IsLiveness(context.Request.Path) && logger.IsEnabled(LogLevel.Information))
            {
                logger.LogInformation(
                    "{Method} {Path} answered {StatusCode} in {ElapsedMilliseconds} ms, trace {TraceId}",
                    LogText.OneLine(context.Request.Method),
                    LogText.OneLine(context.Request.Path),
                    StatusOf(context.Response, escaped),
                    Math.Round(Stopwatch.GetElapsedTime(started).TotalMilliseconds, 1),
                    TraceIds.Of(context));
            }
        }
    }

    /// <summary>
    /// What the caller was sent. An exception that got past the exception handler before anything
    /// was written is answered with a 500 by the server, whatever the status says by then.
    /// </summary>
    internal static int StatusOf(HttpResponse response, bool escaped) =>
        escaped && !response.HasStarted ? StatusCodes.Status500InternalServerError : response.StatusCode;

    /// <summary>
    /// The balancer asks every few seconds, and the answer says nothing a missing line would not.
    /// <c>/readyz</c> is logged: somebody asks it on purpose.
    /// </summary>
    private static bool IsLiveness(PathString path) =>
        path.Equals("/healthz", StringComparison.OrdinalIgnoreCase);
}

public static class RequestLog
{
    public static IApplicationBuilder UseRequestLog(this IApplicationBuilder app) =>
        app.UseMiddleware<RequestLogMiddleware>();
}
