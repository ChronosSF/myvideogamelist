using Microsoft.AspNetCore.Http;
using MyVideoGameList.Server.Security;

namespace MyVideoGameList.Server.Tests;

public class SecurityHeadersTests
{
    private static async Task<IHeaderDictionary> HeadersFor(string path)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = path;

        var middleware = new SecurityHeadersMiddleware(_ => Task.CompletedTask);
        await middleware.InvokeAsync(context);

        return context.Response.Headers;
    }

    [Fact]
    public async Task Invoke_OnAnApiResponse_RefusesSniffingFramingAndLoading()
    {
        var headers = await HeadersFor("/api/games/1");

        Assert.Equal("nosniff", headers.XContentTypeOptions);
        Assert.Equal("DENY", headers.XFrameOptions);
        Assert.Equal("no-referrer", headers["Referrer-Policy"]);
        Assert.Equal("default-src 'none'; frame-ancestors 'none'", headers.ContentSecurityPolicy);
    }

    /// <summary>
    /// The API reference is the one document this process serves, and "load nothing" would
    /// render it blank. It is mapped in Development only, which is why the exemption is narrow
    /// rather than conditional on the environment.
    /// </summary>
    [Theory]
    [InlineData("/scalar/v1")]
    [InlineData("/openapi/v1.json")]
    public async Task Invoke_OnTheApiReference_LeavesTheContentPolicyOff(string path)
    {
        var headers = await HeadersFor(path);

        Assert.False(headers.ContentSecurityPolicy.Count > 0);

        // The rest still applies: nothing about a documentation page needs sniffing or framing.
        Assert.Equal("nosniff", headers.XContentTypeOptions);
        Assert.Equal("DENY", headers.XFrameOptions);
    }
}
