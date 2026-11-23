using System.Net;
using Microsoft.Extensions.DependencyInjection;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The client Steam is reached through, resolved out of the application's own registration rather than
/// built by hand, so that what is asserted is what <c>Program.cs</c> gets.
/// </summary>
public class SteamNewsClientTests
{
    private static ServiceProvider Services()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSteamNewsClient();
        return services.BuildServiceProvider();
    }

    [Fact]
    public void AddSteamNewsClient_PrimaryHandler_AsksForGzip()
    {
        // The service asks for whole bodies. Without gzip, the largest feed read costs 541 KB on the wire
        // rather than 161 KB, and nothing else would fail.
        using var provider = Services();

        var handler = provider.GetRequiredService<IHttpMessageHandlerFactory>().CreateHandler(SteamNewsClient.Name);
        while (handler is DelegatingHandler outer) handler = outer.InnerHandler!;

        Assert.Equal(DecompressionMethods.GZip, Assert.IsType<HttpClientHandler>(handler).AutomaticDecompression);
    }

    [Fact]
    public void AddSteamNewsClient_Client_GivesUpAfterEightSeconds()
    {
        using var provider = Services();

        var client = provider.GetRequiredService<IHttpClientFactory>().CreateClient(SteamNewsClient.Name);

        Assert.Equal(TimeSpan.FromSeconds(8), client.Timeout);
    }
}
