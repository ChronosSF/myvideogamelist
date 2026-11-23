using System.Collections.Concurrent;
using System.Collections.Frozen;
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
/// <c>IDistributedCache</c> behind this same interface — and one more thing, since ADR 0052. A feed
/// somebody is reading is fetched again shortly before its entry expires, by
/// <see cref="RefreshFeedsAsync"/> on <c>SteamNewsRefreshService</c>'s timer, so the reader who
/// arrives after the expiry finds it warm rather than paying Steam's round trip. Which feeds those
/// are is kept beside the cache, in this process's memory, and the refresh takes no lock because
/// each process warms only its own copy. Once the copy is shared, every task would refresh the same
/// feeds: the record of what was read has to move with the cache, and the refresh go under a lock.
/// </para>
/// </remarks>
public partial class SteamNewsService(
    IHttpClientFactory httpClientFactory,
    IIgdbService igdbService,
    IMemoryCache cache,
    TimeProvider clock,
    ILogger<SteamNewsService> logger) : ISteamNewsService
{
    private const string NewsEndpoint = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/";

    /// <summary>
    /// The one feed asked for: what a game's own developer or publisher posts on Steam (ADR 0072).
    /// </summary>
    /// <remarks>
    /// Unfiltered, Steam mixes in the press it collects, and for a game whose developer posts rarely the
    /// press is most of it — two Russian outlets above all, which filled half of a list of single-player
    /// games' news. A list of outlets to leave out would need adding to whenever Steam adds one.
    /// </remarks>
    private const string AnnouncementsFeed = "steam_community_announcements";

    /// <summary>How many characters of each item's text Steam is asked for: none, which is all of it.</summary>
    /// <remarks>
    /// Asked for any other length, Steam answers with a blurb instead of the body. The blurb is cut at
    /// that length, and its markup is already gone, each tag deleted with nothing in its place. So the
    /// text of two blocks runs together ("AircraftHornet", "Anti-Cheat UpdateWe"), and nothing done to
    /// it afterwards can find the word boundary again. An <c>[img]</c> leaves its address behind as
    /// well. So the body is asked for, the excerpt is made here (<see cref="ToExcerpt"/>), and only the
    /// excerpt is kept (<see cref="CachedItem"/>). It is still one request a feed, and the cache holds
    /// what it held. Steam compresses the answer when asked, which <see cref="SteamNewsClient"/>
    /// does. Measured across 34 games' feeds in November 2026, the compressed bodies
    /// came to about twice the bytes of the uncompressed blurbs, half again at the median.
    /// </remarks>
    private const int SteamMaxLength = 0;

    /// <summary>Length of the plain-text excerpt kept after stripping markup.</summary>
    private const int ExcerptLength = 180;

    /// <summary>The most of one body that is read for its excerpt, in characters.</summary>
    /// <remarks>
    /// The longest body seen was 78,739 characters, and the slowest to excerpt took 3.5 ms, so no
    /// excerpt seen is changed by this. It is here so that a body longer than any seen costs a reader
    /// no more than one of those. The excerpt is the post's opening, so whatever is cut off was never
    /// going to be in it.
    /// </remarks>
    internal const int MaxBodyScanned = 100_000;

    /// <summary>
    /// Ceiling on how many games one aggregate call will fan out to. Each game is a separate
    /// Steam request; without a bound, a user with a 400-game backlog would issue 400 of them.
    /// </summary>
    private const int MaxGamesPerAggregate = 12;

    /// <summary>
    /// Steam is asked for more items than one game can contribute, because some are dropped on the way:
    /// one with no title, link or date, and an announcement a publisher posted to several of its games,
    /// which is kept once.
    /// </summary>
    private const int OverFetchFactor = 3;

    internal static readonly TimeSpan FeedCacheLifetime = TimeSpan.FromMinutes(30);

    /// <summary>
    /// Empty feeds are cached too, but briefly: a game may genuinely have no news yet, and a
    /// short window still stops a repeatedly-rendered card from re-asking Steam every time.
    /// </summary>
    internal static readonly TimeSpan EmptyFeedCacheLifetime = TimeSpan.FromMinutes(10);

    /// <summary>
    /// How long before a feed's entry expires <see cref="RefreshFeedsAsync"/> fetches it again.
    /// </summary>
    /// <remarks>
    /// Three of <c>SteamNewsRefreshService</c>'s one-minute ticks, so a refresh that fails is tried
    /// twice more before the copy it was meant to replace runs out — and one that runs out costs
    /// only what every feed cost before this existed: the next reader pays for it.
    /// </remarks>
    internal static readonly TimeSpan RefreshLead = TimeSpan.FromMinutes(3);

    /// <summary>
    /// The most feeds one refresh asks Steam for: one aggregate's fan-out, so the background never
    /// asks for more at once than a cold home page already does. The rest stay due and are taken on
    /// the next tick, soonest to expire first; only what is still waiting when its copy runs out is
    /// left to its readers, as before.
    /// </summary>
    internal const int MaxFeedsPerRefresh = MaxGamesPerAggregate;

    /// <summary>
    /// Every feed a reader has asked for, and when each was last asked for — the whole of what
    /// <see cref="RefreshFeedsAsync"/> needs to know. In memory beside the feeds themselves, and
    /// small: a feed leaves it the first time it reaches its refresh unread.
    /// </summary>
    private readonly ConcurrentDictionary<Feed, DateTimeOffset> readAt = new();

    /// <summary>How many feeds the refresh is watching, so a test can see one let go.</summary>
    internal int WatchedFeeds => readAt.Count;

    /// <summary>One feed as it is fetched and cached: an AppID and how many items to ask for.</summary>
    private readonly record struct Feed(int AppId, int Count)
    {
        public string CacheKey => $"steam_news|{AppId}|{Count}";
    }

    /// <summary>
    /// What the cache holds for a feed: the items, when they were fetched and will expire, which
    /// <see cref="RefreshFeedsAsync"/> reads and <see cref="IMemoryCache"/> cannot be asked, and
    /// whether the copy is only the empty stand-in for a fetch that failed.
    /// </summary>
    private sealed record CachedFeed(
        IReadOnlyList<CachedItem> Items, DateTimeOffset FetchedAt, DateTimeOffset ExpiresAt, bool Failed);

    /// <summary>
    /// One item as the cache keeps it: what a reader is sent of it, its body already made into the
    /// excerpt and dropped.
    /// </summary>
    /// <remarks>
    /// The body is a news post whole, tens of kilobytes for a long patch note. Kept as it came, it would
    /// sit in the cache for every reader of the feed in place of the 180 characters any of them is sent.
    /// </remarks>
    internal sealed record CachedItem(
        string? Gid, string? Title, string? Url, string? FeedLabel, long Date, string? Excerpt);

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
        // Filtered on the caller's token rather than on the exception's type, here and below. An
        // HttpClient that times out throws a TaskCanceledException too, and that is an upstream
        // failure to degrade from, not a request the caller abandoned — filtering out every
        // OperationCanceledException let a slow upstream through as a 500.
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
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

        Dictionary<int, GameDto> games;
        try
        {
            games = (await igdbService.GetGamesByIdsAsync(targets.Select(t => t.GameId), cancellationToken))
                .ToDictionary(g => g.Id);
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            // Guarded for the same reason as the AppID lookup, and reachable when that one is not:
            // the AppID map is cached for a day and this lookup for half an hour, so IGDB can fail
            // here after the call above was answered from cache.
            logger.LogWarning(ex, "Could not load the games behind Steam news; returning no news.");
            return [];
        }

        // Each game can contribute at most its cap, so that is all its feed has to supply. The rail
        // keeps two items a game and /news three, and both used to ask every feed for three times
        // the whole page — sixty items a game for /news, to keep three of them.
        var perFeed = Math.Clamp(maxPerGame ?? count, 1, count) * OverFetchFactor;

        var feeds = await Task.WhenAll(targets.Select(t =>
            FetchFeedAsync(new Feed(t.AppId, perFeed), cancellationToken)));

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

    public async Task RefreshFeedsAsync(CancellationToken cancellationToken = default)
    {
        var now = clock.GetUtcNow();
        var due = new List<(Feed Feed, DateTimeOffset ExpiresAt)>();
        var dropped = 0;

        foreach (var (feed, read) in readAt)
        {
            // Removing the pair rather than the key, here and below: a reader who asks for the feed
            // while this runs has moved the time on, and the removal then leaves their mark alone.
            var unchanged = new KeyValuePair<Feed, DateTimeOffset>(feed, read);

            if (!cache.TryGetValue(feed.CacheKey, out CachedFeed? copy) || copy is null)
            {
                // Expired already, so the next reader fetches it, as every reader did before this.
                if (readAt.TryRemove(unchanged)) dropped++;
                continue;
            }

            if (copy.ExpiresAt - now > RefreshLead) continue;

            // Nobody has asked for this copy since it was fetched, so it is left to expire. A feed
            // kept warm for nobody would turn every game page a crawler visits once into a Steam
            // request every half hour for ever; a feed somebody reads again is back on the next tick.
            //
            // Nor is a stand-in for a fetch that failed, read or not. It is cached precisely so that
            // a failing Steam is not asked again for ten minutes, and refreshing it ahead of its
            // expiry would ask three times in its last three — through an outage, for every feed
            // anybody is reading. Its next reader asks, as one would have before this.
            if (read <= copy.FetchedAt || copy.Failed)
            {
                if (readAt.TryRemove(unchanged)) dropped++;
                continue;
            }

            due.Add((feed, copy.ExpiresAt));
        }

        var refresh = due
            .OrderBy(d => d.ExpiresAt)
            .Take(MaxFeedsPerRefresh)
            .Select(d => d.Feed)
            .ToList();

        if (refresh.Count == 0)
        {
            if (dropped > 0) logger.LogDebug("Steam news refresh let {Dropped} unread feed(s) go.", dropped);
            return;
        }

        // In parallel, as an aggregate asks for its own: a dozen at most, each bounded by the Steam
        // client's eight-second timeout, so a slow Steam costs the tick seconds rather than minutes.
        var fetched = await Task.WhenAll(refresh.Select(feed => RequestFeedAsync(feed, cancellationToken)));
        var failed = 0;

        for (var i = 0; i < refresh.Count; i++)
        {
            // Steam did not answer, so the copy already there is kept until it expires. A reader
            // whose own fetch fails caches an empty feed, so as not to ask a failing Steam on every
            // render; doing the same here would blank a good feed to save nobody anything.
            if (fetched[i] is { } items) Store(refresh[i], items, failed: false);
            else failed++;
        }

        logger.LogDebug(
            "Steam news refresh fetched {Refreshed} feed(s) before they expired, {Failed} of them "
            + "failing, and let {Dropped} unread feed(s) go; {Waiting} more were due.",
            refresh.Count - failed, failed, dropped, due.Count - refresh.Count);
    }

    /// <summary>
    /// One feed, from the cache or from Steam, never throwing.
    /// </summary>
    private async Task<IReadOnlyList<CachedItem>> FetchFeedAsync(
        Feed feed, CancellationToken cancellationToken)
    {
        // Noted whether the copy is there or not: this is how the refresh learns which feeds are
        // worth keeping warm. A miss marks the feed as asked for a moment before the copy it
        // fetches, so a feed read only by the request that fetched it counts as unread.
        readAt[feed] = clock.GetUtcNow();

        if (cache.TryGetValue(feed.CacheKey, out CachedFeed? cached) && cached is not null)
            return cached.Items;

        // A failure is cached as an empty feed, briefly, so a failing Steam is not asked again on
        // every render of the page that wanted it.
        var items = await RequestFeedAsync(feed, cancellationToken);

        Store(feed, items ?? [], failed: items is null);
        return items ?? [];
    }

    /// <summary>
    /// One Steam request for one feed, never throwing for Steam.
    /// </summary>
    /// <returns>
    /// The items, empty when Steam says the AppID has no accessible feed, or <c>null</c> when Steam
    /// did not answer — which a reader and the refresh treat differently.
    /// </returns>
    private async Task<IReadOnlyList<CachedItem>?> RequestFeedAsync(
        Feed feed, CancellationToken cancellationToken)
    {
        try
        {
            var url = $"{NewsEndpoint}?appid={feed.AppId}&count={feed.Count}&maxlength={SteamMaxLength}"
                + $"&feeds={AnnouncementsFeed}&format=json";

            var client = httpClientFactory.CreateClient(SteamNewsClient.Name);
            using var response = await client.GetAsync(url, cancellationToken);

            // A retired or region-locked AppID answers 4xx. That is a normal outcome for a game
            // IGDB still lists, not a fault worth an error-level log.
            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden)
            {
                logger.LogDebug("Steam has no accessible news feed for AppID {AppId}.", feed.AppId);
                return [];
            }

            response.EnsureSuccessStatusCode();

            var payload = await response.Content
                .ReadFromJsonAsync<SteamNewsResponse>(cancellationToken);

            // The bodies go no further than this: each is made into its excerpt here, once a fetch,
            // and only that is kept.
            return payload?.AppNews?.NewsItems?
                .Select(item => Condense(item, ToExcerpt, logger, feed.AppId))
                .ToList() ?? [];
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            // A timeout included: the Steam client gives up after eight seconds and throws a
            // TaskCanceledException, which is a slow Steam rather than a cancelled request.
            logger.LogWarning(ex, "Failed to fetch Steam news for AppID {AppId}.", feed.AppId);
            return null;
        }
    }

    private void Store(Feed feed, IReadOnlyList<CachedItem> items, bool failed)
    {
        var now = clock.GetUtcNow();
        var lifetime = items.Count > 0 ? FeedCacheLifetime : EmptyFeedCacheLifetime;

        cache.Set(feed.CacheKey, new CachedFeed(items, now, now + lifetime, failed), lifetime);
    }

    /// <summary>
    /// One item as Steam sent it, reduced to what the cache keeps: its body made into its excerpt by
    /// <paramref name="excerpt"/>, which is <see cref="ToExcerpt"/> but for a test.
    /// </summary>
    /// <remarks>
    /// Every expression the excerpt runs has a timeout. One that fires costs this item its excerpt, so it
    /// is shown with its headline alone, and never costs the feed the other items came in.
    /// </remarks>
    internal static CachedItem Condense(
        SteamNewsItem item, Func<string?, string?> excerpt, ILogger logger, int appId)
    {
        string? text;
        try
        {
            text = excerpt(item.Contents);
        }
        catch (RegexMatchTimeoutException ex)
        {
            logger.LogWarning(
                ex, "Steam news item {Gid} of AppID {AppId} took too long to excerpt and is shown without one.",
                item.Gid, appId);
            text = null;
        }

        return new CachedItem(item.Gid, item.Title, item.Url, item.FeedLabel, item.Date, text);
    }

    /// <summary>
    /// Projects a cached Steam item onto the client DTO, dropping anything unusable.
    /// </summary>
    internal static NewsItemDto? MapToDto(CachedItem item, GameDto game)
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
            Excerpt: item.Excerpt,
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
    /// Flattens the body of a Steam news post, BBCode with the odd HTML tag, into a short plain-text
    /// excerpt.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Sanitizing here rather than on the client is deliberate: the DTO is documented as plain
    /// text, so no consumer has a reason to render it as markup.
    /// </para>
    /// <para>
    /// Every tag stands for a word boundary, except the ones that mark words inside a line: bold, a
    /// link. Those leave nothing in their place, so <c>([b][url=…]Report[/url][/b])</c> reads
    /// "(Report)". Only the tags Steam's posts were seen to use count as tags. Any other bracketed
    /// word ("[Frontier]", "[Xbox only]") is the author's text and is kept. So is a bracket the author
    /// escaped (<c>\[CLASSIFIED]</c>), without its backslash. An image or a video is removed whole,
    /// because an address is not prose. A spoiler's text is kept, as Steam's own blurb kept it.
    /// </para>
    /// <para>
    /// An image's address is removed again afterwards, in the two forms Steam's blurb used to leave
    /// behind (see <see cref="SteamMaxLength"/>), for an address outside any block.
    /// </para>
    /// </remarks>
    internal static string? ToExcerpt(string? contents)
    {
        if (string.IsNullOrWhiteSpace(contents)) return null;
        if (contents.Length > MaxBodyScanned) contents = contents[..MaxBodyScanned];

        var text = DroppedBlocks().Replace(contents, " ");
        text = BbCodeTags().Replace(text, tag => InlineTags.Contains(tag.Groups["name"].Value) ? "" : " ");
        text = HtmlTags().Replace(text, " ");
        text = text.Replace(@"\[", "[", StringComparison.Ordinal);
        text = WebUtility.HtmlDecode(text);
        text = ImageAddresses().Replace(text, " ");
        text = Whitespace().Replace(text, " ").Trim();

        if (text.Length == 0) return null;
        if (text.Length <= ExcerptLength) return text;

        // Cut on a word boundary so the excerpt does not end mid-word before the ellipsis.
        var cut = text.LastIndexOf(' ', ExcerptLength);
        if (cut < ExcerptLength / 2) cut = ExcerptLength;

        return string.Concat(text.AsSpan(0, cut).TrimEnd(), "…");
    }

    /// <summary>The tags that mark words inside a line, which leave no word boundary behind.</summary>
    private static readonly FrozenSet<string> InlineTags =
        new[] { "b", "i", "u", "c", "strike", "spoiler", "url" }.ToFrozenSet(StringComparer.OrdinalIgnoreCase);

    // Bounded quantifiers throughout: these run over untrusted upstream text, and an unbounded
    // nested quantifier is how a regex turns into a denial of service. An opening tag's attributes
    // are allowed a thousand characters: an [img] with an inline style ran to 545, a [video] to 351.
    // A tag never follows a backslash, which is how a post writes a bracket that is not one.

    /// <summary>
    /// A block removed with what is inside it, an image or a video. Stripping only its tags would leave
    /// its address behind as prose.
    /// </summary>
    [GeneratedRegex(
        @"(?<!\\)\[(img|previewyoutube|video|audio)(?=[\s=\]])[^\]]{0,1000}\].{0,2000}?\[/\1\]",
        RegexOptions.IgnoreCase | RegexOptions.Singleline,
        matchTimeoutMilliseconds: 200)]
    private static partial Regex DroppedBlocks();

    /// <summary>
    /// One tag, opening or closing, of the kinds Steam's posts use, in either case, as the expression
    /// before it was. Every tag seen was lowercase. A word in brackets that only begins like a tag stays
    /// text ("[PC]", "[Boss Event]"), because a name has to end at the bracket, at an equals sign, or at
    /// a space and an attribute of the form <c>name=</c>. A dropped block's own tags are here too, for
    /// one too long to drop whole, so that at least its tags go.
    /// </summary>
    [GeneratedRegex(
        @"(?<!\\)\[/?(?<name>\*|p|b|i|u|c|strike|spoiler|url|h[1-4]|list|olist|hr|table|tr|th|td|quote|code"
        + @"|expand|carousel|dynamiclink|img|previewyoutube|video|audio)"
        + @"(?:=[^\]]{0,1000}|\s+[a-z0-9-]+=[^\]]{0,1000})?\]",
        RegexOptions.IgnoreCase,
        matchTimeoutMilliseconds: 200)]
    private static partial Regex BbCodeTags();

    [GeneratedRegex(@"<[^>]{0,200}>", RegexOptions.None, matchTimeoutMilliseconds: 200)]
    private static partial Regex HtmlTags();

    /// <summary>
    /// An image's address, as Steam's blurb left it where an <c>[img]</c> stood: Steam's placeholder
    /// and the path after it, as far as the next space, or an address ending in an image's extension.
    /// </summary>
    /// <remarks>
    /// Only the forms seen in Steam's answers. The placeholder runs to the next space because the blurb
    /// was cut at its length wherever that fell, inside an address too, and in every blurb read a
    /// space or the end came after one. A link that is not to an image is prose ("Read more here:
    /// https://…") and stays.
    /// </remarks>
    [GeneratedRegex(
        @"\{STEAM_CLAN(?:_LOC)?_IMAGE\}\S{0,300}|https?://\S{1,300}?\.(?:png|jpg|gif)(?!\S)",
        RegexOptions.IgnoreCase,
        matchTimeoutMilliseconds: 200)]
    private static partial Regex ImageAddresses();

    [GeneratedRegex(@"\s+", RegexOptions.None, matchTimeoutMilliseconds: 200)]
    private static partial Regex Whitespace();
}
