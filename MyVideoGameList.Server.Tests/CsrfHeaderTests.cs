using Microsoft.AspNetCore.Http;
using MyVideoGameList.Server.Security;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Cookie authentication means a browser attaches the session to a cross-site request as readily
/// as to one of ours. What tells them apart is a header only our own code can set.
/// </summary>
public class CsrfHeaderTests
{
    private readonly IProblemDetailsService problemDetails = Substitute.For<IProblemDetailsService>();

    private async Task<(int Status, bool Continued)> Send(string method, bool withHeader)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = "/api/lists/7";
        if (withHeader) context.Request.Headers[CsrfHeaderMiddleware.HeaderName] = "1";

        var continued = false;
        var middleware = new CsrfHeaderMiddleware(
            _ =>
            {
                continued = true;
                return Task.CompletedTask;
            },
            problemDetails);

        await middleware.InvokeAsync(context);

        return (context.Response.StatusCode, continued);
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    public async Task Invoke_AWriteWithoutTheHeader_IsRefused(string method)
    {
        var (status, continued) = await Send(method, withHeader: false);

        Assert.Equal(StatusCodes.Status403Forbidden, status);
        Assert.False(continued);
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("DELETE")]
    public async Task Invoke_AWriteWithTheHeader_IsLetThrough(string method)
    {
        var (_, continued) = await Send(method, withHeader: true);

        Assert.True(continued);
    }

    [Theory]
    [InlineData("GET")]
    [InlineData("HEAD")]
    [InlineData("OPTIONS")]
    public async Task Invoke_AReadWithoutTheHeader_IsLetThrough(string method)
    {
        // A read is exempt because it is not supposed to change anything - a rule this API keeps
        // rather than one it is granted, which is why every state change is a POST, PUT or DELETE.
        var (_, continued) = await Send(method, withHeader: false);

        Assert.True(continued);
    }
}
