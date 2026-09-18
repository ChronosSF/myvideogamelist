using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Security;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The trust list is the whole point of the section: forwarded headers from a source nobody
/// vouched for let a caller pick the address they are rate-limited and logged under.
/// </summary>
public class ProxyHeadersTests
{
    private static IConfiguration Configuration(params (string Key, string Value)[] settings) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(settings.Select(s =>
                new KeyValuePair<string, string?>(s.Key, s.Value)))
            .Build();

    [Fact]
    public void AddProxyHeaders_EnabledWithNoTrustList_Throws()
    {
        var services = new ServiceCollection();

        var act = () => services.AddProxyHeaders(Configuration(("ForwardedHeaders:Enabled", "true")));

        var exception = Assert.Throws<InvalidOperationException>(act);
        Assert.Contains("KnownProxies", exception.Message);
    }

    [Fact]
    public void AddProxyHeaders_EnabledWithANetwork_HonoursTheAddressAndTheScheme()
    {
        var services = new ServiceCollection();
        services.AddOptions();

        services.AddProxyHeaders(Configuration(
            ("ForwardedHeaders:Enabled", "true"),
            ("ForwardedHeaders:ForwardLimit", "2"),
            ("ForwardedHeaders:KnownNetworks:0", "10.0.0.0/16")));

        var options = services.BuildServiceProvider()
            .GetRequiredService<IOptions<ForwardedHeadersOptions>>().Value;

        Assert.Equal(2, options.ForwardLimit);
        Assert.Equal(
            Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor
                | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto,
            options.ForwardedHeaders);

        // The loopback default is gone, because a load balancer is never on loopback - and the
        // configured network is there in its place.
        Assert.Equal(
            [System.Net.IPNetwork.Parse("10.0.0.0/16")],
            options.KnownIPNetworks);
        Assert.Empty(options.KnownProxies);
    }

    [Fact]
    public void AddProxyHeaders_Disabled_ChangesNothing()
    {
        var services = new ServiceCollection();
        services.AddOptions();

        services.AddProxyHeaders(Configuration(("ForwardedHeaders:Enabled", "false")));

        var options = services.BuildServiceProvider()
            .GetRequiredService<IOptions<ForwardedHeadersOptions>>().Value;

        // Whatever the defaults are, nothing here has touched them: with no proxy in front, a
        // request's own address and scheme are the true ones.
        Assert.Equal(new ForwardedHeadersOptions().ForwardedHeaders, options.ForwardedHeaders);
    }
}
