using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Composes the home page payload from IGDB and Steam.
/// </summary>
public class HomeService(
    IIgdbService igdbService,
    ISteamNewsService steamNewsService,
    IMemoryCache cache,
    ILogger<HomeService> logger) : IHomeService
{
    private const string CacheKey = "home_payload";

    /// <summary>How many covers the trending rail shows.</summary>
    private const int PopularCount = 18;

    /// <summary>How many news items the rail shows.</summary>
    private const int NewsCount = 8;

    /// <summary>
    /// Items any one game may contribute to the rail. A game mid-esports-tournament posts several
    /// announcements a day and would otherwise crowd out every other title.
    /// </summary>
    private const int MaxNewsPerGame = 2;

    private static readonly TimeSpan CacheLifetime = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Shortened lifetime for a degraded response, so a transient IGDB failure is not pinned
    /// on the front page for the full window.
    /// </summary>
    private static readonly TimeSpan DegradedCacheLifetime = TimeSpan.FromMinutes(1);

    public async Task<HomeResponse> GetHomeAsync(CancellationToken cancellationToken = default)
    {
        if (cache.TryGetValue(CacheKey, out HomeResponse? cached) && cached is not null)
            return cached;

        List<GameDto> popular;
        try
        {
            popular = (await igdbService.GetTrendingAsync(PopularCount, cancellationToken)).ToList();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The home page still renders: the hero keeps its gradient and the calendar, which
            // loads separately on the client, is unaffected.
            logger.LogWarning(ex, "IGDB unavailable while composing the home page.");

            var empty = new HomeResponse(null, [], []);
            cache.Set(CacheKey, empty, DegradedCacheLifetime);
            return empty;
        }

        // The hero needs a wide artwork, not a cover. Plenty of IGDB entries have no artwork at
        // all, so pick the first that does rather than assuming the top-rated game has one.
        var spotlight = popular.FirstOrDefault(g => !string.IsNullOrWhiteSpace(g.BackgroundImageUrl));

        // Already non-throwing by contract, so no try/catch here: a Steam outage costs the rail
        // and nothing else.
        var news = await steamNewsService.GetLatestNewsAsync(
            popular.Select(g => g.Id), NewsCount, MaxNewsPerGame, cancellationToken);

        var result = new HomeResponse(spotlight, popular, news);

        cache.Set(CacheKey, result, CacheLifetime);
        return result;
    }
}
