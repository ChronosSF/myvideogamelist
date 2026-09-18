using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace MyVideoGameList.Server.Security;

/// <summary>
/// What the app is told to believe about the caller when something else terminated the
/// connection.
/// </summary>
/// <remarks>
/// Deliberately opt-in and deliberately explicit. Left off, the app sees the proxy as the client
/// and plain HTTP as the scheme — which makes <c>UseHttpsRedirection</c> redirect every request a
/// TLS-terminating load balancer forwards, and collapses the rate limiter's partitions onto one
/// address. Turned on without naming who is in front, it would take an attacker's word for both.
/// So turning it on without a trust list is a startup failure rather than either mistake.
/// </remarks>
public sealed class ProxyHeadersOptions
{
    public const string SectionName = "ForwardedHeaders";

    /// <summary>Whether a proxy is in front of this process at all.</summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// How many entries to consume from the right of <c>X-Forwarded-For</c>. One per proxy that
    /// appends to it: a load balancer alone is 1, a CDN in front of that is 2. Too high and a
    /// caller can pick their own address by sending the header themselves; too low and the
    /// address belongs to the nearest proxy rather than to the person.
    /// </summary>
    public int ForwardLimit { get; set; } = 1;

    /// <summary>Individual addresses allowed to speak for their callers.</summary>
    public string[] KnownProxies { get; set; } = [];

    /// <summary>The same in CIDR form, e.g. <c>10.0.0.0/16</c> for a VPC.</summary>
    public string[] KnownNetworks { get; set; } = [];
}

public static class ProxyHeaders
{
    public static IServiceCollection AddProxyHeaders(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var settings = configuration.GetSection(ProxyHeadersOptions.SectionName)
            .Get<ProxyHeadersOptions>() ?? new ProxyHeadersOptions();

        services.AddSingleton(settings);

        if (!settings.Enabled) return services;

        if (settings.KnownProxies.Length == 0 && settings.KnownNetworks.Length == 0)
        {
            throw new InvalidOperationException(
                $"{ProxyHeadersOptions.SectionName}:Enabled is true but neither KnownProxies nor "
                + "KnownNetworks names anything. Forwarded headers from an untrusted source let a "
                + "caller choose the address the app attributes the request to. Name the load "
                + "balancer's subnet, or turn the section off.");
        }

        services.Configure<ForwardedHeadersOptions>(options =>
        {
            // The address and the scheme, and nothing else. X-Forwarded-Host is left alone: the
            // host is what link generation and cookie domains key on, and a forwarded one is
            // worth less than the configured AllowedHosts already in appsettings.json.
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            options.ForwardLimit = settings.ForwardLimit;

            // The defaults are loopback only, which is never where a load balancer is.
            options.KnownProxies.Clear();
            options.KnownIPNetworks.Clear();

            foreach (var proxy in settings.KnownProxies)
                options.KnownProxies.Add(IPAddress.Parse(proxy));

            foreach (var network in settings.KnownNetworks)
                options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
        });

        return services;
    }

    /// <summary>
    /// Runs before everything: the redirect to HTTPS, the rate limiter's partition key and every
    /// logged address are all wrong if this has not run first.
    /// </summary>
    public static IApplicationBuilder UseProxyHeaders(this IApplicationBuilder app)
    {
        var settings = app.ApplicationServices.GetRequiredService<ProxyHeadersOptions>();
        return settings.Enabled ? app.UseForwardedHeaders() : app;
    }
}
