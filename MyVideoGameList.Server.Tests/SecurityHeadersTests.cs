using Microsoft.AspNetCore.Http;
using MyVideoGameList.Server.Security;

namespace MyVideoGameList.Server.Tests;

public class SecurityHeadersTests
{
    /// <summary>
    /// Calls what the middleware registers to run when the response starts. The registration
    /// itself is deliberately not exercised here - a DefaultHttpContext never starts a response,
    /// so a test of it would assert that a callback was stored and nothing about the headers.
    /// </summary>
    private static IHeaderDictionary HeadersFor(string path)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = path;

        SecurityHeadersMiddleware.Apply(context);

        return context.Response.Headers;
    }

    [Fact]
    public void Apply_OnAnApiResponse_RefusesSniffingFramingAndLoading()
    {
        var headers = HeadersFor("/api/games/1");

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
    public void Apply_OnTheApiReference_LeavesTheContentPolicyOff(string path)
    {
        var headers = HeadersFor(path);

        Assert.False(headers.ContentSecurityPolicy.Count > 0);

        // The rest still applies: nothing about a documentation page needs sniffing or framing.
        Assert.Equal("nosniff", headers.XContentTypeOptions);
        Assert.Equal("DENY", headers.XFrameOptions);
    }
}
