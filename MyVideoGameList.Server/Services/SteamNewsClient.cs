using System.Net;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The HTTP client <see cref="SteamNewsService"/> reaches Steam through.
/// </summary>
/// <remarks>
/// Registered here rather than in <c>Program.cs</c>, so that a test can resolve the application's own
/// registration and see what it sets, as <see cref="ScheduledWork"/>'s tests do.
/// </remarks>
public static class SteamNewsClient
{
    /// <summary>The named client's name.</summary>
    public const string Name = "Steam";

    /// <summary>How long a request to Steam may take before it counts as a failure.</summary>
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(8);

    /// <summary>
    /// Adds the client: a short timeout, and gzip.
    /// </summary>
    /// <remarks>
    /// Steam's news API is public and needs no key, but it is a third party on the home page's critical
    /// path, so it gets a short timeout of its own rather than the 100s default. It gzips a feed when
    /// asked, to about a third. <see cref="SteamNewsService"/> asks for the posts' whole bodies and keeps
    /// only their excerpts, so the bytes on the wire are what the bodies cost: the largest feed read,
    /// AppID 1938090's fifteen items, is 540,697 bytes plain and 161,484 gzipped.
    /// </remarks>
    public static IHttpClientBuilder AddSteamNewsClient(this IServiceCollection services) =>
        services
            .AddHttpClient(Name, client => client.Timeout = Timeout)
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
            {
                AutomaticDecompression = DecompressionMethods.GZip,
            });
}
