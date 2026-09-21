using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;

namespace MyVideoGameList.Server.Errors;

/// <summary>
/// Swallows the cancellation that a reader navigating away produces.
/// </summary>
/// <remarks>
/// Every controller and service takes a <c>CancellationToken</c>, so a browser closing a tab
/// mid-request unwinds the whole call as an <see cref="OperationCanceledException"/>. That is the
/// system working. Left to the handler below it, it would be logged as a server error and answered
/// with a body nobody is on the other end to read, and the 5xx alarm this deployment is supposed to
/// have would fire on people changing their minds.
/// </remarks>
public sealed class ClientDisconnectHandler : IExceptionHandler
{
    /// <summary>
    /// Not an HTTP status a client ever sees — the connection is gone. It is written so that logs
    /// and metrics can tell this apart from a request that was actually answered, which is the
    /// convention nginx established with the same number.
    /// </summary>
    private const int ClientClosedRequest = 499;

    public ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        if (exception is not OperationCanceledException
            || !httpContext.RequestAborted.IsCancellationRequested)
        {
            return ValueTask.FromResult(false);
        }

        // Nothing is written: there is nowhere to write it.
        httpContext.Response.StatusCode = ClientClosedRequest;
        return ValueTask.FromResult(true);
    }
}
