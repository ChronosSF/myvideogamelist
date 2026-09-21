using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MyVideoGameList.Server.Security;

/// <summary>
/// Refuses a state-changing request that did not come from this site's own code.
/// </summary>
/// <remarks>
/// <para>
/// Authentication here is a cookie, and a browser attaches cookies to a cross-site request as
/// readily as to one of ours. <c>SameSite=Lax</c> withholds the cookie from a cross-site POST and
/// is genuinely most of the defence, but it is a default a browser may relax and it says nothing
/// about a same-site subdomain, so it is mitigation rather than the answer.
/// </para>
/// <para>
/// The answer is this: every write must carry a header that only our own code can set. A form on
/// another site can POST to any URL but cannot add a header to the request. Script on another site
/// can add one, but adding it makes the request non-simple, so the browser asks this API for
/// permission first — and this API answers no CORS preflight at all, because no cross-origin policy
/// is configured. <strong>Adding one would undo this</strong>: a permissive
/// <c>Access-Control-Allow-Headers</c> hands an attacker the missing header back. If cross-origin
/// access is ever needed, it has to be a named origin, and this guard has to be re-thought
/// alongside it.
/// </para>
/// <para>
/// A token in a cookie, echoed in a header, would be the other standard answer. It is not used
/// because it buys nothing here: the double submit is checked by comparing two values the same
/// browser sent, and what makes that work is precisely that the attacker cannot write the header -
/// which is what is being relied on directly instead, with no token to mint, store, rotate or hand
/// to a server-rendered page.
/// </para>
/// </remarks>
public sealed class CsrfHeaderMiddleware(RequestDelegate next, IProblemDetailsService problemDetails)
{
    /// <summary>
    /// The header the client sets on every write. Its value is never read: a header a cross-site
    /// caller cannot add is the whole signal, and a value would only suggest there is a secret
    /// here to guess.
    /// </summary>
    public const string HeaderName = "X-MVGL-Request";

    public async Task InvokeAsync(HttpContext context)
    {
        if (ChangesState(context.Request.Method)
            && !context.Request.Headers.ContainsKey(HeaderName))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;

            await problemDetails.TryWriteAsync(new ProblemDetailsContext
            {
                HttpContext = context,
                ProblemDetails = new ProblemDetails
                {
                    Status = StatusCodes.Status403Forbidden,
                    Title = "Request rejected",
                    Detail = $"A write to this API must carry the {HeaderName} header. The app "
                        + "sends it on every request it makes; a tool calling this endpoint by "
                        + "hand has to add it."
                }
            });

            return;
        }

        await next(context);
    }

    /// <summary>
    /// The methods a browser will send cross-site with cookies attached. GET, HEAD and OPTIONS
    /// are exempt because they are not supposed to change anything - which is a rule this API has
    /// to keep, not one it is granted.
    /// </summary>
    private static bool ChangesState(string method) =>
        !HttpMethods.IsGet(method)
        && !HttpMethods.IsHead(method)
        && !HttpMethods.IsOptions(method)
        && !HttpMethods.IsTrace(method);
}
