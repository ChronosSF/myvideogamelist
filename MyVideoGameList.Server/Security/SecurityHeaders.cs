namespace MyVideoGameList.Server.Security;

/// <summary>
/// Response headers that state what this API's answers may be used for.
/// </summary>
/// <remarks>
/// <para>
/// Everything here serves JSON, so the policy is the strictest one there is: a document that
/// loads nothing and may not be framed. That covers the two ways a JSON endpoint gets turned
/// into something else — a browser sniffing a response into a script, and a page framing an
/// answer meant to be read by code.
/// </para>
/// <para>
/// The HTML has its own set, because it is served by the other process
/// (<c>docs/decisions/0003-two-process-deployment.md</c>) and a document that loads nothing would
/// be a blank page. See <c>myvideogamelist.client/src/lib/securityHeaders.ts</c>.
/// </para>
/// </remarks>
public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    /// <summary>
    /// A JSON API is not a document: it loads nothing, embeds nothing and frames nothing.
    /// </summary>
    private const string ContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";

    /// <summary>
    /// Registers the headers to be written when the response starts, rather than writing them
    /// now. The difference matters on the error path: the exception handler clears the response
    /// before writing its own, headers included, so anything set on the way in is gone by the
    /// time a 500 or a 502 goes out - which are the answers least worth sending bare.
    /// </summary>
    public async Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(static state =>
        {
            Apply((HttpContext)state);
            return Task.CompletedTask;
        }, context);

        await next(context);
    }

    internal static void Apply(HttpContext context)
    {
        var headers = context.Response.Headers;

        // Without this a response whose body looks like script can be loaded as one, whatever
        // its content type says.
        headers.XContentTypeOptions = "nosniff";

        // An API request is never a navigation, so there is no referrer worth sending. Paths
        // here carry usernames and game ids.
        headers["Referrer-Policy"] = "no-referrer";

        // The header and its modern replacement, because the two are read by different browsers
        // and neither is universal on its own.
        headers.XFrameOptions = "DENY";

        if (!IsApiDocumentation(context.Request.Path))
            headers.ContentSecurityPolicy = ContentSecurityPolicy;
    }

    /// <summary>
    /// The OpenAPI document and the Scalar UI in front of it, which are mapped in Development
    /// only. They are the one thing this process serves that <em>is</em> a document, and the
    /// policy above would leave it blank.
    /// </summary>
    private static bool IsApiDocumentation(PathString path) =>
        path.StartsWithSegments("/scalar") || path.StartsWithSegments("/openapi");
}

public static class SecurityHeaders
{
    public static IApplicationBuilder UseApiSecurityHeaders(this IApplicationBuilder app) =>
        app.UseMiddleware<SecurityHeadersMiddleware>();
}
