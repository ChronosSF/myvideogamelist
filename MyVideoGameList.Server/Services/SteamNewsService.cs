using System.Net;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models.Steam;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Fetches per-game news from Steam's public <c>ISteamNews</c> API and joins it to IGDB game
/// metadata.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately holds no database state. The IGDB-to-AppID mapping and the feeds themselves are
/// derived, regenerable and time-bounded — cache-shaped rather than table-shaped — so they live
/// in <see cref="IMemoryCache"/>. That keeps <c>ApplicationDbContext</c> and the migration set
/// untouched, which matters while the PostgreSQL move in ADR 0008 is still pending: every table
/// added now is another table whose migration has to be regenerated and re-verified there.
/// </para>
/// <para>
/// When the distributed cache in ROADMAP §5 lands, the swap is <see cref="IMemoryCache"/> for
/// <c>IDistributedCache</c> behind this same interface.
/// </para>
/// </remarks>
public partial class SteamNewsService(
    IHttpClientFactory httpClientFactory,
    IIgdbService igdbService,
    IMemoryCache cache,
    ILogger<SteamNewsService> logger) : ISteamNewsService
{
    private const string NewsEndpoint = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/";

    /// <summary>How many characters of article body Steam should return.</summary>
    private const int SteamMaxLength = 600;

    /// <summary>Length of the plain-text excerpt kept after stripping markup.</summary>
    private const int ExcerptLength = 180;

    /// <summary>
    /// Ceiling on how many games one aggregate call will fan out to. Each game is a separate
    /// Steam request; without a bound, a user with a 400-game backlog would issue 400 of them.
    /// </summary>
    private const int MaxGamesPerAggregate = 12;

    /// <summary>
    /// Steam is asked for more items than are displayed, because the feed mixes official
    /// announcements with third-party coverage and some get dropped in de-duplication.
    /// </summary>
    private const int OverFetchFactor = 3;

    private static readonly TimeSpan FeedCacheLifetime = TimeSpan.FromMinutes(30);

    /// <summary>
    /// Empty feeds are cached too, but briefly: a game may genuinely have no news yet, and a
    /// short window still stops a repeatedly-rendered card from re-asking Steam every time.
    /// </summary>
    private static readonly TimeSpan EmptyFeedCacheLifetime = TimeSpan.FromMinutes(10);

    public async Task<IReadOnlyList<NewsItemDto>> GetNewsForGameAsync(
        int igdbGameId, int count = 5, CancellationToken cancellationToken = default)
        // No per-game cap: every item on a single-game panel comes from that one game by design.
        => await GetLatestNewsAsync([igdbGameId], count, null, cancellationToken);

    public async Task<IReadOnlyList<NewsItemDto>> GetLatestNewsAsync(
        IEnumerable<int> igdbGameIds,
        int count = 8,
        int? maxPerGame = null,
        CancellationToken cancellationToken = default)
    {
        var ids = igdbGameIds.Distinct().ToList();
        if (ids.Count == 0 || count <= 0) return [];

        IReadOnlyDictionary<int, int> appIdsByGame;
        try
        {
            appIdsByGame = await igdbService.GetSteamAppIdsAsync(ids, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // IGDB being down is already visible on the readiness probe. Losing the news rail
            // is the correct, quiet consequence rather than a second alarm.
            logger.LogWarning(ex, "Could not resolve Steam AppIDs; returning no news.");
            return [];
        }

        if (appIdsByGame.Count == 0) return [];

        // Preserve the caller's ordering: they passed the games in priority order, so when the
        // fan-out has to be truncated it should keep the ones they cared about most.
        var targets = ids
            .Where(appIdsByGame.ContainsKey)
            .Take(MaxGamesPerAggregate)
            .Select(id => (GameId: id, AppId: appIdsByGame[id]))
            .ToList();

        if (targets.Count < appIdsByGame.Count)
        {
            logger.LogDebug(
                "News fan-out capped at {Cap} of {Available} Steam-backed games.",
                MaxGamesPerAggregate, appIdsByGame.Count);
        }

        var games = (await igdbService.GetGamesByIdsAsync(targets.Select(t => t.GameId), cancellationToken))
            .ToDictionary(g => g.Id);

        var feeds = await Task.WhenAll(targets.Select(t =>
            FetchFeedAsync(t.AppId, count * OverFetchFactor, cancellationToken)));

        var items = new List<NewsItemDto>();

        for (var i = 0; i < targets.Count; i++)
        {
            if (!games.TryGetValue(targets[i].GameId, out var game)) continue;

            foreach (var raw in feeds[i])
            {
                var mapped = MapToDto(raw, game);
                if (mapped is not null) items.Add(mapped);
            }
        }

        var ordered = items
            .OrderByDescending(n => n.PublishedAt)
            .DistinctBy(n => n.Id);

        if (maxPerGame is { } cap)
        {
            // Newest-first ordering is applied before the cap, so each game keeps its most recent
            // items rather than whichever happened to be enumerated first.
            ordered = ordered
                .GroupBy(n => n.GameId)
                .SelectMany(g => g.Take(cap))
                .OrderByDescending(n => n.PublishedAt);
        }

        return ordered.Take(count).ToList();
    }

    /// <summary>
    /// One Steam request for one AppID, cached and never throwing.
    /// </summary>
    private async Task<IReadOnlyList<SteamNewsItem>> FetchFeedAsync(
        int appId, int count, CancellationToken cancellationToken)
    {
        var cacheKey = $"steam_news|{appId}|{count}";
        if (cache.TryGetValue(cacheKey, out IReadOnlyList<SteamNewsItem>? cached) && cached is not null)
            return cached;

        IReadOnlyList<SteamNewsItem> items = [];

        try
        {
            var url = $"{NewsEndpoint}?appid={appId}&count={count}&maxlength={SteamMaxLength}&format=json";

            var client = httpClientFactory.CreateClient("Steam");
            var response = await client.GetAsync(url, cancellationToken);

            // A retired or region-locked AppID answers 4xx. That is a normal outcome for a game
            // IGDB still lists, not a fault worth an error-level log.
            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden)
            {
                logger.LogDebug("Steam has no accessible news feed for AppID {AppId}.", appId);
            }
            else
            {
                response.EnsureSuccessStatusCode();

                var payload = await response.Content
                    .ReadFromJsonAsync<SteamNewsResponse>(cancellationToken);

                items = payload?.AppNews?.NewsItems ?? [];
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Failed to fetch Steam news for AppID {AppId}.", appId);
        }

        cache.Set(cacheKey, items, items.Count > 0 ? FeedCacheLifetime : EmptyFeedCacheLifetime);
        return items;
    }

    /// <summary>
    /// Projects a raw Steam item onto the client DTO, dropping anything unusable.
    /// </summary>
    internal static NewsItemDto? MapToDto(SteamNewsItem item, GameDto game)
    {
        if (string.IsNullOrWhiteSpace(item.Gid)
            || string.IsNullOrWhiteSpace(item.Title)
            || string.IsNullOrWhiteSpace(item.Url))
        {
            return null;
        }

        // Steam dates are Unix seconds. A zero or negative one would render as 1970, which looks
        // like a bug on a "latest news" rail, so treat it as unusable.
        if (item.Date <= 0) return null;

        return new NewsItemDto(
            Id: item.Gid,
            GameId: game.Id,
            GameTitle: game.Title,
            GameCoverUrl: game.CoverImageUrl,
            Title: CleanTitle(item.Title),
            Url: item.Url,
            Source: string.IsNullOrWhiteSpace(item.FeedLabel) ? "Steam" : item.FeedLabel,
            Excerpt: ToExcerpt(item.Contents),
            PublishedAt: DateTimeOffset.FromUnixTimeSeconds(item.Date));
    }

    /// <summary>
    /// Strips markup from a headline. Entities are decoded *after* tags are removed, so an
    /// escaped ampersand survives as "&amp;" rather than being deleted along with the tags.
    /// </summary>
    private static string CleanTitle(string title)
    {
        var text = HtmlTags().Replace(title, " ");
        text = WebUtility.HtmlDecode(text);
        text = Whitespace().Replace(text, " ").Trim();

        return text.Length > 0 ? text : title;
    }

    /// <summary>
    /// Flattens Steam's mix of BBCode and HTML into a short plain-text excerpt.
    /// </summary>
    /// <remarks>
    /// Sanitizing here rather than on the client is deliberate: the DTO is documented as plain
    /// text, so no consumer has a reason to render it as markup.
    /// </remarks>
    internal static string? ToExcerpt(string? contents)
    {
        if (string.IsNullOrWhiteSpace(contents)) return null;

        // Remove media blocks whole, content included. Stripping only the tags would leave the
        // bare asset URL behind as prose, and Steam announcements routinely open with one — the
        // excerpt would start "https://clan.cloudflare.steamstatic.com/..." instead of the news.
        var text = MediaBlocks().Replace(contents, " ");
        text = BbCodeTags().Replace(text, " ");
        text = HtmlTags().Replace(text, " ");
        text = WebUtility.HtmlDecode(text);
        text = Whitespace().Replace(text, " ").Trim();

        if (text.Length == 0) return null;
        if (text.Length <= ExcerptLength) return text;

        // Cut on a word boundary so the excerpt does not end mid-word before the ellipsis.
        var cut = text.LastIndexOf(' ', ExcerptLength);
        if (cut < ExcerptLength / 2) cut = ExcerptLength;

        return string.Concat(text.AsSpan(0, cut).TrimEnd(), "…");
    }

    // Bounded quantifiers throughout: these run over untrusted upstream text, and an unbounded
    // nested quantifier is how a regex turns into a denial of service.
    [GeneratedRegex(
        @"\[(img|previewyoutube|video|audio)[^\]]{0,200}\].{0,2000}?\[/\1\]",
        RegexOptions.IgnoreCase | RegexOptions.Singleline,
        matchTimeoutMilliseconds: 200)]
    private static partial Regex MediaBlocks();

    [GeneratedRegex(@"\[/?[a-zA-Z][^\]]{0,80}\]", RegexOptions.None, matchTimeoutMilliseconds: 200)]
    private static partial Regex BbCodeTags();

    [GeneratedRegex(@"<[^>]{0,200}>", RegexOptions.None, matchTimeoutMilliseconds: 200)]
    private static partial Regex HtmlTags();

    [GeneratedRegex(@"\s+", RegexOptions.None, matchTimeoutMilliseconds: 200)]
    private static partial Regex Whitespace();
}
