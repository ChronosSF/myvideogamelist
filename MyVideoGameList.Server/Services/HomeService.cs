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
    /// Shortened lifetime for a degraded response, so a transient upstream failure is not pinned
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
            popular = [];
        }

        // The hero needs a wide artwork, not a cover. Plenty of IGDB entries have no artwork at
        // all, so pick the first that does rather than assuming the top-rated game has one.
        var spotlight = popular.FirstOrDefault(g => !string.IsNullOrWhiteSpace(g.BackgroundImageUrl));

        // Already non-throwing by contract, so no try/catch here: a Steam outage costs the rail
        // and nothing else. Given no games to ask about, it answers empty without a request.
        var news = await steamNewsService.GetLatestNewsAsync(
            popular.Select(g => g.Id), NewsCount, MaxNewsPerGame, cancellationToken);

        // One judgement, for both caches: it picks how long this process keeps the answer, and it
        // travels in the answer so that nobody keeps the page built from it (ADR 0013). It is
        // stated here rather than inferred by the page's loader from an empty rail, because the
        // loader cannot tell this 200 from a healthy one by its status, and an inference there
        // would be a second copy of this line, in another project, that whoever adds the next way
        // to degrade would have to know to go and change.
        //
        // Judged from what came back, not from the catch above, because most of the ways this goes
        // wrong throw nothing. GetTrendingAsync answers empty, quietly, when IGDB returns no
        // popularity rows — which is all a field IGDB has removed looks like. The news comes back
        // empty beside a full rail of covers when IGDB fails after the trending call was answered
        // from its hour-long cache, or when Steam is down. And neither rail is empty while its
        // upstream is well: these are Steam's most-played games, so every one of them has a feed
        // (ADR 0012).
        //
        // A rail that is only thinner than it should be, because some feeds failed and others did
        // not, cannot be seen from here.
        var degraded = popular.Count == 0 || news.Count == 0;

        if (degraded)
        {
            // Said once per composition. Most of the ways above are logged where they happen, but
            // not all — an AppID lookup that resolves nothing is silent — and what this costs, an
            // uncached front page, looks from outside like nothing at all.
            logger.LogWarning(
                "Home page composed degraded, with {PopularCount} trending games and {NewsCount} news items. "
                + "Kept for {Lifetime} and marked so that the page is not cached.",
                popular.Count, news.Count, DegradedCacheLifetime);
        }

        var result = new HomeResponse(spotlight, popular, news, degraded);

        cache.Set(CacheKey, result, degraded ? DegradedCacheLifetime : CacheLifetime);
        return result;
    }
}
