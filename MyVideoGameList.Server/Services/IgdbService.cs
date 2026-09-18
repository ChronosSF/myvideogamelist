using System.Collections.ObjectModel;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models.Igdb;

namespace MyVideoGameList.Server.Services;

public class IgdbService(
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    IMemoryCache cache,
    ILogger<IgdbService> logger) : IIgdbService
{
    private const string TokenCacheKey = "igdb_access_token";
    private const string ImageBaseUrl = "https://images.igdb.com/igdb/image/upload";
    private const string GamesEndpoint = "https://api.igdb.com/v4/games";
    private const string ReleaseDatesEndpoint = "https://api.igdb.com/v4/release_dates";
    private const string ExternalGamesEndpoint = "https://api.igdb.com/v4/external_games";
    private const string PopularityEndpoint = "https://api.igdb.com/v4/popularity_primitives";
    private const string TimeToBeatEndpoint = "https://api.igdb.com/v4/game_time_to_beats";

    // Buffer (in seconds) subtracted from the token's reported expiry so we refresh before it actually expires
    private const int TokenExpiryBufferSeconds = 120;

    /// <summary>IGDB caps a single response at 500 rows.</summary>
    private const int MaxBatchSize = 500;

    /// <summary>
    /// Hard ceiling on pagination. At 500 rows per page this covers 5000 release rows, far more than
    /// any realistic window, and stops a bad filter from paging forever against IGDB's rate limit.
    /// </summary>
    private const int MaxPages = 10;

    /// <summary>How far ahead the upcoming-releases timeline looks.</summary>
    private const int UpcomingWindowDays = 30;

    /// <summary>
    /// The IGDB <c>external_game_source</c> identifying a Steam store entry. This replaced the
    /// old <c>category</c> field, which no longer exists — filtering on it matches nothing.
    /// </summary>
    private const int SteamExternalSource = 1;

    /// <summary>
    /// The IGDB <c>age_rating_organizations</c> id for the ESRB. This replaced the old
    /// <c>age_ratings.category</c> field, which no longer exists — asking for it returns nothing.
    /// </summary>
    private const int EsrbOrganization = 1;

    /// <summary>
    /// IGDB <c>popularity_type</c> 5, "24hr Peak Players", sourced from Steam.
    /// </summary>
    /// <remarks>
    /// Chosen over the IGDB-native types after comparing their live output. Type 1 ("Visits")
    /// returns zero-valued rows mixed with junk and adult titles, and type 9 ("Global Top
    /// Sellers") returns near-identical values whose ordering is not meaningful. Type 5 returns
    /// well-separated values over recognisable titles, and — being Steam-sourced — every game in
    /// it has a Steam feed, which is what makes the news rail reliably non-empty.
    /// </remarks>
    private const int SteamPeakPlayersPopularityType = 5;

    /// <summary>
    /// Critics a game needs before its <c>aggregated_rating</c> is treated as a ranking signal for
    /// the browse listing. Eight is low enough to keep the catalogue deep and high enough to drop
    /// the single-review entries that would otherwise fill the first pages with perfect scores.
    /// </summary>
    private const int MinAggregatedRatingCount = 8;

    /// <summary>
    /// Ratings — critics' and players' together — a game needs before any browse order that is not the
    /// critic score will list it.
    /// </summary>
    /// <remarks>
    /// Without a floor, newest first is a page of games released today that nobody has heard of, and
    /// A to Z fills with shovelware. Ten was checked against live IGDB: it keeps the last month's
    /// reviewed releases, which held between twelve and thirty ratings, and still admits a series of
    /// cat-collecting games at twelve to sixteen — which is why the orders that rank by nothing about
    /// the game also require a critic. See ADR 0032.
    /// </remarks>
    private const int MinListedRatingCount = 10;

    private const string GenresEndpoint = "https://api.igdb.com/v4/genres";

    /// <summary>
    /// Games per <c>external_games</c> lookup. Deliberately well below <see cref="MaxBatchSize"/>:
    /// a game can have several Steam rows (regional entries, demos), so asking for 500 games could
    /// overflow the 500-row response cap and silently drop mappings.
    /// </summary>
    private const int ExternalGamesChunkSize = 200;

    private static readonly JsonSerializerOptions SnakeCaseOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    /// <summary>
    /// What every game query asks for. Both score fields come with their counts, since a score
    /// without a sample size cannot be displayed honestly.
    /// </summary>
    private const string GameListFieldList =
        "id,name,summary,first_release_date," +
        "cover.image_id," +
        "artworks.image_id," +
        "videos.video_id," +
        "websites.url,websites.category," +
        "rating,aggregated_rating,aggregated_rating_count," +
        "total_rating,total_rating_count," +
        "age_ratings.organization,age_ratings.rating_category," +
        "genres.id,genres.name," +
        "platforms.id,platforms.name,platforms.abbreviation," +
        "involved_companies.company.id,involved_companies.company.name," +
        "involved_companies.developer,involved_companies.publisher";

    /// <summary>
    /// The extra fields only the detail page uses. Kept out of the listing queries on purpose:
    /// screenshots, language tables and three sets of related games multiply by the page size,
    /// and a grid of cover art has no use for any of them.
    /// </summary>
    private const string GameDetailFieldList =
        "screenshots.image_id," +
        "themes.name,player_perspectives.name,game_modes.name,game_engines.name," +
        "collections.name,franchises.name," +
        "multiplayer_modes.*," +
        "language_supports.language.name,language_supports.language_support_type.name," +
        "similar_games.name,similar_games.cover.image_id," +
        "dlcs.name,dlcs.cover.image_id," +
        "expansions.name,expansions.cover.image_id," +
        "parent_game.name,parent_game.cover.image_id";

    private static readonly string GameFields = $"fields {GameListFieldList};";

    private static readonly string GameDetailFields =
        $"fields {GameListFieldList},{GameDetailFieldList};";

    private string ClientId
    {
        get
        {
            var clientId = configuration["Igdb:ClientId"];
            return string.IsNullOrWhiteSpace(clientId)
                ? throw new InvalidOperationException("IGDB ClientId is not configured.")
                : clientId;
        }
    }

    private string ClientSecret
    {
        get
        {
            var clientSecret = configuration["Igdb:ClientSecret"];
            return string.IsNullOrWhiteSpace(clientSecret)
                ? throw new InvalidOperationException("IGDB ClientSecret is not configured.")
                : clientSecret;
        }
    }

    private async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken)
    {
        if (cache.TryGetValue(TokenCacheKey, out string? cached) && cached is not null)
            return cached;

        var client = httpClientFactory.CreateClient("Igdb");
        using var content = new FormUrlEncodedContent(
            [
                new KeyValuePair<string, string>("client_id", ClientId),
                new KeyValuePair<string, string>("client_secret", ClientSecret),
                new KeyValuePair<string, string>("grant_type", "client_credentials")
            ]);
        var response = await client.PostAsync("https://id.twitch.tv/oauth2/token", content, cancellationToken);

        response.EnsureSuccessStatusCode();

        var tokenResponse = await response.Content
                .ReadFromJsonAsync<TwitchTokenResponse>(SnakeCaseOptions, cancellationToken)
            ?? throw new InvalidOperationException("Failed to deserialize IGDB token response.");

        var cacheLifetimeSeconds = Math.Max(30, tokenResponse.ExpiresIn - TokenExpiryBufferSeconds);
        cache.Set(TokenCacheKey, tokenResponse.AccessToken, TimeSpan.FromSeconds(cacheLifetimeSeconds));

        return tokenResponse.AccessToken;
    }

    /// <summary>
    /// Issues a single Apicalypse query and deserializes the result. Every IGDB call funnels
    /// through here so auth headers, content type and cancellation stay consistent.
    /// </summary>
    private async Task<List<T>> QueryAsync<T>(string endpoint, string query, CancellationToken cancellationToken)
    {
        var accessToken = await GetAccessTokenAsync(cancellationToken);

        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        request.Headers.Add("Client-ID", ClientId);
        request.Headers.Add("Authorization", $"Bearer {accessToken}");
        request.Content = new StringContent(query, Encoding.UTF8, "text/plain");

        var client = httpClientFactory.CreateClient("Igdb");
        var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<List<T>>(SnakeCaseOptions, cancellationToken) ?? [];
    }

    public async Task<PagedGamesResponse> GetGamesAsync(
        int offset = 0,
        int limit = 20,
        string? search = null,
        GameBrowseQuery? browse = null,
        CancellationToken cancellationToken = default)
    {
        browse ??= GameBrowseQuery.Default;

        // Every input that changes the query is in the key. The clock that newest-first reads is not:
        // a page cached for half an hour can miss a game released in that half hour, which is the
        // same staleness every other page here has.
        var cacheKey = $"igdb_games|{limit}|{offset}|{search ?? string.Empty}|{browse.Sort}|"
            + $"{browse.PlatformId}|{browse.GenreId}|{browse.Year}|{browse.MinScore}";
        if (cache.TryGetValue(cacheKey, out PagedGamesResponse? cached) && cached is not null)
            return cached;

        var igdbGames = await QueryAsync<IgdbGame>(
            GamesEndpoint, BuildQuery(offset, limit, search, browse, DateTimeOffset.UtcNow), cancellationToken);

        var games = igdbGames.Select(MapToGameDto).ToList();
        var result = new PagedGamesResponse(games, igdbGames.Count == limit);

        cache.Set(cacheKey, result, TimeSpan.FromMinutes(30));
        return result;
    }

    public async Task<IReadOnlyList<GenreDto>> GetGenresAsync(CancellationToken cancellationToken = default)
    {
        const string cacheKey = "igdb_genres";
        if (cache.TryGetValue(cacheKey, out IReadOnlyList<GenreDto>? cached) && cached is not null)
            return cached;

        // IGDB has a couple of dozen genres and adds one rarely, so a day is fresh enough.
        var rows = await QueryAsync<IgdbGenre>(
            GenresEndpoint, "fields id,name; sort name asc; limit 100;", cancellationToken);

        IReadOnlyList<GenreDto> result = rows
            .Where(g => !string.IsNullOrWhiteSpace(g.Name))
            .Select(g => new GenreDto(g.Id, g.Name, null))
            .ToList();

        cache.Set(cacheKey, result, TimeSpan.FromHours(24));
        return result;
    }

    public async Task<GameDto?> GetGameByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        var cacheKey = $"igdb_game|{id}";
        if (cache.TryGetValue(cacheKey, out GameDto? cached))
            return cached;

        var query = new StringBuilder()
            .AppendLine(GameDetailFields)
            .AppendLine($"where id = {id};")
            .AppendLine("limit 1;")
            .ToString();

        var igdbGames = await QueryAsync<IgdbGame>(GamesEndpoint, query, cancellationToken);
        var igdbGame = igdbGames.FirstOrDefault();

        GameDto? result = null;
        if (igdbGame is not null)
        {
            var timeToBeat = await FetchTimeToBeatAsync(id, cancellationToken);
            result = MapToGameDto(igdbGame) with { Details = MapToDetailsDto(igdbGame, timeToBeat) };
        }

        // Cache misses briefly too, so a bad ID cannot hammer IGDB on repeat requests
        var ttl = result is not null ? TimeSpan.FromMinutes(30) : TimeSpan.FromMinutes(5);
        cache.Set(cacheKey, result, ttl);

        return result;
    }

    public async Task<IEnumerable<GameDto>> GetGamesByIdsAsync(
        IEnumerable<int> ids, CancellationToken cancellationToken = default)
    {
        var idList = ids.Distinct().ToList();
        if (idList.Count == 0) return [];

        idList.Sort();
        var cacheKey = $"igdb_games_by_ids|{string.Join(',', idList)}";
        if (cache.TryGetValue(cacheKey, out IEnumerable<GameDto>? cached) && cached is not null)
            return cached;

        var result = await FetchGamesByIdsAsync(idList, cancellationToken);

        cache.Set(cacheKey, result, TimeSpan.FromMinutes(30));
        return result;
    }

    /// <summary>
    /// Fetches full game details for the given IDs, chunked to IGDB's 500-row response cap.
    /// </summary>
    private async Task<List<GameDto>> FetchGamesByIdsAsync(
        List<int> idList, CancellationToken cancellationToken)
    {
        var games = new List<GameDto>(idList.Count);

        foreach (var chunk in idList.Chunk(MaxBatchSize))
        {
            var query = new StringBuilder()
                .AppendLine(GameFields)
                .AppendLine($"where id = ({string.Join(',', chunk)});")
                .AppendLine($"limit {chunk.Length};")
                .ToString();

            var igdbGames = await QueryAsync<IgdbGame>(GamesEndpoint, query, cancellationToken);
            games.AddRange(igdbGames.Select(MapToGameDto));
        }

        return games;
    }

    /// <summary>
    /// Builds the upcoming-releases timeline from the <c>release_dates</c> endpoint rather than
    /// <c>first_release_date</c>. A game already out on PC but launching on Switch next week has a
    /// <c>first_release_date</c> in the past and would never appear otherwise.
    /// </summary>
    public async Task<IEnumerable<GameDto>> GetUpcomingReleasesAsync(CancellationToken cancellationToken = default)
    {
        var nowOffset = DateTimeOffset.UtcNow;
        var nowUnix = nowOffset.ToUnixTimeSeconds();
        var endUnix = nowOffset.AddDays(UpcomingWindowDays).ToUnixTimeSeconds();

        // Refresh hourly so the list stays current without hammering the API
        var cacheKey = $"igdb_upcoming|{nowOffset:yyyyMMddHH}";
        if (cache.TryGetValue(cacheKey, out IEnumerable<GameDto>? cached) && cached is not null)
            return cached;

        var releaseRows = await FetchReleaseDatesAsync(nowUnix, endUnix, cancellationToken);

        var gameIds = releaseRows
            .Select(r => r.Game!.Value)
            .Distinct()
            .ToList();

        var gamesById = (await FetchGamesByIdsAsync(gameIds, cancellationToken))
            .ToDictionary(g => g.Id);

        var result = ComposeUpcoming(releaseRows, gamesById);

        cache.Set(cacheKey, result, TimeSpan.FromHours(1));
        return result;
    }

    private async Task<List<IgdbReleaseDate>> FetchReleaseDatesAsync(
        long fromUnix, long toUnix, CancellationToken cancellationToken)
    {
        var rows = new List<IgdbReleaseDate>();

        for (var page = 0; page < MaxPages; page++)
        {
            var query = new StringBuilder()
                .AppendLine("fields game,date,platform;")
                .AppendLine($"where date >= {fromUnix} & date <= {toUnix} & game != null;")
                .AppendLine("sort date asc;")
                .AppendLine($"limit {MaxBatchSize};")
                .AppendLine($"offset {page * MaxBatchSize};")
                .ToString();

            var batch = await QueryAsync<IgdbReleaseDate>(ReleaseDatesEndpoint, query, cancellationToken);
            rows.AddRange(batch.Where(r => r.Game.HasValue && r.Date.HasValue));

            if (batch.Count < MaxBatchSize) return rows;
        }

        logger.LogWarning(
            "Upcoming releases hit the {MaxPages}-page ceiling ({RowCount} rows); results may be truncated.",
            MaxPages, rows.Count);

        return rows;
    }

    /// <summary>
    /// Collapses release rows into one entry per (game, date), carrying only the platforms actually
    /// releasing on that date so the timeline's platform filter stays meaningful.
    /// </summary>
    internal static List<GameDto> ComposeUpcoming(
        List<IgdbReleaseDate> releaseRows, Dictionary<int, GameDto> gamesById)
    {
        var composed = new List<GameDto>();

        var grouped = releaseRows
            .Where(r => gamesById.ContainsKey(r.Game!.Value))
            .GroupBy(r => (
                GameId: r.Game!.Value,
                Date: DateOnly.FromDateTime(DateTimeOffset.FromUnixTimeSeconds(r.Date!.Value).UtcDateTime)));

        foreach (var group in grouped)
        {
            var game = gamesById[group.Key.GameId];

            // Resolve the releasing platform IDs against the platform list already on the game
            var releasingIds = group
                .Where(r => r.Platform.HasValue)
                .Select(r => r.Platform!.Value)
                .ToHashSet();

            var platforms = game.Platforms.Where(p => releasingIds.Contains(p.Id)).ToList();

            // If IGDB gave no platform on the release row, fall back to the game's full platform list
            // rather than dropping the entry entirely.
            if (platforms.Count == 0) platforms = game.Platforms.ToList();

            composed.Add(game with { ReleaseDate = group.Key.Date, Platforms = platforms });
        }

        return composed.OrderBy(g => g.ReleaseDate).ThenBy(g => g.Title).ToList();
    }

    /// <summary>
    /// The games with the highest current player counts, most popular first.
    /// </summary>
    /// <remarks>
    /// Replaces sorting the catalogue by <c>aggregated_rating</c>, which is a poor proxy for
    /// popularity: it surfaces obscure DLC and re-releases carrying a single perfect review
    /// rather than games anyone recognises.
    /// </remarks>
    public async Task<IEnumerable<GameDto>> GetTrendingAsync(
        int limit, CancellationToken cancellationToken = default)
    {
        if (limit <= 0) return [];

        // Refresh hourly, on the same clock-hour key the upcoming timeline uses.
        var cacheKey = $"igdb_trending|{limit}|{DateTimeOffset.UtcNow:yyyyMMddHH}";
        if (cache.TryGetValue(cacheKey, out IEnumerable<GameDto>? cached) && cached is not null)
            return cached;

        // Over-fetch: a rail of cover art has to drop games that have no cover, and popularity
        // rows sometimes point at entries that no longer resolve.
        var fetchCount = Math.Min(limit * 3, MaxBatchSize);

        var query = new StringBuilder()
            .AppendLine("fields game_id,value;")
            .AppendLine($"where popularity_type = {SteamPeakPlayersPopularityType};")
            .AppendLine("sort value desc;")
            .AppendLine($"limit {fetchCount};")
            .ToString();

        var primitives = await QueryAsync<IgdbPopularityPrimitive>(
            PopularityEndpoint, query, cancellationToken);

        // Distinct preserves first occurrence, which is the highest-scoring row for that game.
        var rankedIds = primitives
            .Where(p => p.GameId.HasValue)
            .Select(p => p.GameId!.Value)
            .Distinct()
            .ToList();

        if (rankedIds.Count == 0)
        {
            logger.LogWarning("IGDB returned no popularity primitives; the trending rail will be empty.");
            return [];
        }

        var gamesById = (await FetchGamesByIdsAsync(rankedIds, cancellationToken))
            .ToDictionary(g => g.Id);

        // Re-impose the popularity order: the id lookup returns rows in IGDB's own order, not ours.
        IEnumerable<GameDto> result = rankedIds
            .Where(gamesById.ContainsKey)
            .Select(id => gamesById[id])
            .Where(g => !string.IsNullOrWhiteSpace(g.CoverImageUrl))
            .Take(limit)
            .ToList();

        cache.Set(cacheKey, result, TimeSpan.FromHours(1));
        return result;
    }

    /// <summary>
    /// Resolves IGDB game ids onto Steam AppIDs via the <c>external_games</c> endpoint.
    /// </summary>
    /// <remarks>
    /// Games with no Steam presence — console exclusives, most retro titles — are simply absent
    /// from the returned map rather than mapped to a sentinel, so callers can treat a missing key
    /// as "no news available here" and hide the panel entirely.
    /// </remarks>
    public async Task<IReadOnlyDictionary<int, int>> GetSteamAppIdsAsync(
        IEnumerable<int> gameIds, CancellationToken cancellationToken = default)
    {
        var idList = gameIds.Distinct().ToList();
        if (idList.Count == 0) return ReadOnlyDictionary<int, int>.Empty;

        idList.Sort();
        var cacheKey = $"igdb_steam_appids|{string.Join(',', idList)}";
        if (cache.TryGetValue(cacheKey, out IReadOnlyDictionary<int, int>? cached) && cached is not null)
            return cached;

        var map = new Dictionary<int, int>();

        foreach (var chunk in idList.Chunk(ExternalGamesChunkSize))
        {
            var query = new StringBuilder()
                .AppendLine("fields game,uid,external_game_source;")
                .AppendLine($"where game = ({string.Join(',', chunk)}) & external_game_source = {SteamExternalSource};")
                .AppendLine($"limit {MaxBatchSize};")
                .ToString();

            var rows = await QueryAsync<IgdbExternalGame>(ExternalGamesEndpoint, query, cancellationToken);

            foreach (var row in rows)
            {
                // uid is a string even though a Steam AppID is numeric, so parse rather than trust it.
                if (row.Game is { } gameId && int.TryParse(row.Uid, out var appId) && appId > 0)
                    map.TryAdd(gameId, appId);
            }
        }

        // A game's storefront identity effectively never changes, so this caches for a day. Misses
        // are cached with the hits: a console-only library would otherwise re-ask IGDB on every render.
        IReadOnlyDictionary<int, int> result = map;
        cache.Set(cacheKey, result, TimeSpan.FromHours(24));
        return result;
    }

    public Task<IEnumerable<PlatformDto>> GetActivePlatformsAsync()
    {
        var entries = configuration
            .GetSection("ActivePlatforms")
            .Get<List<ActivePlatformConfig>>() ?? [];

        IEnumerable<PlatformDto> result = entries
            .Select(p => new PlatformDto(p.Id, p.Name, p.Abbreviation, null, null))
            .OrderBy(p => p.Name)
            .ToList();

        return Task.FromResult(result);
    }

    public async Task<bool> IsReachableAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await QueryAsync<IgdbGame>(GamesEndpoint, "fields id; limit 1;", cancellationToken);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "IGDB readiness check failed.");
            return false;
        }
    }

    private sealed record ActivePlatformConfig(int Id, string Name, string Abbreviation);

    /// <summary>
    /// The Apicalypse query behind one page of the browse listing or of a search.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The filters apply to both, and every value in them is an integer the controller has already
    /// range-checked, so only the search needs escaping.
    /// </para>
    /// <para>
    /// The order and its floor apply only when nobody is searching. A search must reach every game,
    /// however thinly reviewed (ADR 0016), and IGDB orders search results itself — it answers a
    /// <c>search</c> that also carries a <c>sort</c> with a 406.
    /// </para>
    /// </remarks>
    /// <param name="now">What "released" means for newest first. Passed in so the query is testable.</param>
    internal static string BuildQuery(
        int offset,
        int limit,
        string? search,
        GameBrowseQuery? browse = null,
        DateTimeOffset? now = null)
    {
        browse ??= GameBrowseQuery.Default;

        var sb = new StringBuilder();
        sb.AppendLine(GameFields);

        var where = new List<string>();

        if (browse.PlatformId is int platformId) where.Add($"platforms = ({platformId})");
        if (browse.GenreId is int genreId) where.Add($"genres = ({genreId})");

        if (browse.Year is int year)
        {
            var from = new DateTimeOffset(year, 1, 1, 0, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds();
            var to = new DateTimeOffset(year + 1, 1, 1, 0, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds();
            where.Add($"first_release_date >= {from}");
            where.Add($"first_release_date < {to}");
        }

        if (browse.MinScore is int minScore)
        {
            // A score floor needs a critic floor, or "80 and above" is every game one critic loved.
            where.Add($"aggregated_rating >= {minScore}");
            where.Add($"aggregated_rating_count >= {MinAggregatedRatingCount}");
        }

        string? sort = null;

        if (!string.IsNullOrWhiteSpace(search))
        {
            // Escape backslashes and double-quotes to prevent Apicalypse query injection
            var safeSearch = search.Replace("\\", "\\\\").Replace("\"", "\\\"");
            sb.AppendLine($"search \"{safeSearch}\";");
        }
        else
        {
            switch (browse.Sort)
            {
                case GameSortKeys.Popular:
                    // Ranked by the ratings IGDB holds, which is a ranking by attention in itself, so
                    // it needs no critic: a game players rated heavily and no outlet reviewed belongs
                    // near the top. The floor only keeps the far end of the pages clean.
                    where.Add($"total_rating_count >= {MinListedRatingCount}");
                    sort = "total_rating_count desc";
                    break;

                case GameSortKeys.Newest:
                    // An order by date says nothing about the game, so it takes both floors: enough
                    // ratings, and at least one critic. Unreleased games wait for their date.
                    var released = (now ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
                    where.Add($"first_release_date <= {released}");
                    where.Add($"total_rating_count >= {MinListedRatingCount}");
                    where.Add("aggregated_rating_count >= 1");
                    sort = "first_release_date desc";
                    break;

                case GameSortKeys.Name:
                    where.Add($"total_rating_count >= {MinListedRatingCount}");
                    where.Add("aggregated_rating_count >= 1");
                    sort = "name asc";
                    break;

                default:
                    // Sorting the whole catalogue by aggregated_rating puts the long tail first: obscure
                    // DLC, special editions and console re-releases carrying a single perfect review
                    // all score exactly 100. Requiring a minimum number of contributing critics is what
                    // makes the sort mean anything.
                    where.Add($"aggregated_rating_count >= {MinAggregatedRatingCount}");
                    sort = "aggregated_rating desc";
                    break;
            }
        }

        // Distinct, because a score filter and the critic-score order ask for the same critic floor.
        if (where.Count > 0) sb.AppendLine($"where {string.Join(" & ", where.Distinct())};");
        if (sort is not null) sb.AppendLine($"sort {sort};");

        sb.AppendLine($"limit {limit};");
        sb.AppendLine($"offset {offset};");

        return sb.ToString();
    }

    /// <summary>
    /// Community completion times for one game. Supplementary to the page, so a failure here
    /// degrades to no completion-time section rather than taking the whole game down with it.
    /// </summary>
    private async Task<IgdbGameTimeToBeat?> FetchTimeToBeatAsync(
        int gameId, CancellationToken cancellationToken)
    {
        var query = new StringBuilder()
            .AppendLine("fields game_id,hastily,normally,completely,count;")
            .AppendLine($"where game_id = {gameId};")
            .AppendLine("limit 1;")
            .ToString();

        try
        {
            var rows = await QueryAsync<IgdbGameTimeToBeat>(TimeToBeatEndpoint, query, cancellationToken);
            return rows.FirstOrDefault();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Completion times unavailable for game {GameId}.", gameId);
            return null;
        }
    }

    private static GameDto MapToGameDto(IgdbGame g)
    {
        var coverUrl = g.Cover?.ImageId is { } coverId
            ? $"{ImageBaseUrl}/t_cover_big/{coverId}.jpg"
            : null;

        var backgroundUrl = g.Artworks?.FirstOrDefault(a => a.ImageId is not null)?.ImageId is { } artId
            ? $"{ImageBaseUrl}/t_1080p/{artId}.jpg"
            : null;

        var trailerUrl = g.Videos?.FirstOrDefault(v => v.VideoId is not null)?.VideoId is { } vidId
            ? $"https://www.youtube.com/watch?v={vidId}"
            : null;

        var website = g.Websites?.FirstOrDefault(w => w.Category == 3)?.Url
            ?? g.Websites?.FirstOrDefault()?.Url;

        // The headline score is total_rating - IGDB's blend of critic and user scores - because it
        // is backed by orders of magnitude more opinions than aggregated_rating alone. Falls back
        // to the raw user rating when IGDB has published no blend. Both arrive 0-100 and are shown
        // out of 10.
        var ratingSource = g.TotalRating ?? g.Rating;
        float? rating = ratingSource.HasValue ? (float)Math.Round(ratingSource.Value / 10.0, 1) : null;
        var ratingCount = g.TotalRating.HasValue ? g.TotalRatingCount : null;

        int? criticScore = g.AggregatedRating.HasValue ? (int)Math.Round(g.AggregatedRating.Value) : null;

        var esrbRating = MapEsrbRating(g.AgeRatings);

        DateOnly? releaseDate = g.FirstReleaseDate.HasValue
            ? DateOnly.FromDateTime(DateTimeOffset.FromUnixTimeSeconds(g.FirstReleaseDate.Value).UtcDateTime)
            : null;

        var genres = g.Genres?.Select(genre => new GenreDto(genre.Id, genre.Name, null)).ToList()
            ?? [];

        var platforms = g.Platforms?.Select(p => new PlatformDto(
                p.Id, p.Name, p.Abbreviation ?? p.Name, null, null)).ToList()
            ?? [];

        var developers = g.InvolvedCompanies?
                .Where(ic => ic.Developer)
                .Select(ic => new DeveloperDto(ic.Company.Id, ic.Company.Name, null, null, null, null, null))
                .ToList()
            ?? [];

        var publishers = g.InvolvedCompanies?
                .Where(ic => ic.Publisher)
                .Select(ic => new PublisherDto(ic.Company.Id, ic.Company.Name, null, null, null, null, null))
                .ToList()
            ?? [];

        return new GameDto(
            g.Id,
            g.Name,
            g.Summary,
            releaseDate,
            coverUrl,
            backgroundUrl,
            trailerUrl,
            website,
            rating,
            ratingCount,
            criticScore,
            g.AggregatedRatingCount,
            esrbRating,
            platforms,
            genres,
            developers,
            publishers,
            Details: null);
    }

    /// <summary>
    /// Builds the detail-only half of a game. Named entities are flattened to their names - the
    /// page renders them as chips and the ids are not linkable anywhere yet.
    /// </summary>
    internal static GameDetailsDto MapToDetailsDto(IgdbGame g, IgdbGameTimeToBeat? timeToBeat)
    {
        var screenshots = g.Screenshots?
                .Where(sc => sc.ImageId is not null)
                .Select(sc => $"{ImageBaseUrl}/t_screenshot_big/{sc.ImageId}.jpg")
                .ToList()
            ?? [];

        return new GameDetailsDto(
            MapTimeToBeat(timeToBeat),
            screenshots,
            MapRelatedGames(g.SimilarGames),
            MapRelatedGames(g.Dlcs),
            MapRelatedGames(g.Expansions),
            MapRelatedGame(g.ParentGame),
            Names(g.GameModes),
            FoldMultiplayerModes(g.MultiplayerModes),
            Names(g.Themes),
            Names(g.PlayerPerspectives),
            Names(g.GameEngines),
            Names(g.Collections),
            Names(g.Franchises),
            MapLanguages(g.LanguageSupports));
    }

    private static List<string> Names(List<IgdbNamedEntity>? entities) =>
        entities?.Select(e => e.Name).OfType<string>().ToList() ?? [];

    /// <summary>
    /// Drops rows with no submissions behind them: a zero-count average is not an average.
    /// </summary>
    internal static TimeToBeatDto? MapTimeToBeat(IgdbGameTimeToBeat? t)
    {
        if (t is null) return null;

        var count = t.Count ?? 0;
        if (count <= 0) return null;
        if (t.Hastily is null && t.Normally is null && t.Completely is null) return null;

        return new TimeToBeatDto(t.Hastily, t.Normally, t.Completely, count);
    }

    private static List<GameRefDto> MapRelatedGames(List<IgdbRelatedGame>? related) =>
        related?.Select(MapRelatedGame).OfType<GameRefDto>().ToList() ?? [];

    private static GameRefDto? MapRelatedGame(IgdbRelatedGame? r)
    {
        // A related game with no name can be neither rendered nor linked usefully, so it is
        // dropped rather than shown as a blank card.
        if (r is null || string.IsNullOrWhiteSpace(r.Name)) return null;

        var coverUrl = r.Cover?.ImageId is { } coverId
            ? $"{ImageBaseUrl}/t_cover_big/{coverId}.jpg"
            : null;

        return new GameRefDto(r.Id, r.Name, coverUrl);
    }

    /// <summary>
    /// Collapses IGDB's per-platform multiplayer rows into one summary: a capability counts if any
    /// platform offers it, and each ceiling is the most generous on offer. A single summary is what
    /// the page needs; per-platform differences are noise at this altitude.
    /// </summary>
    internal static MultiplayerModesDto? FoldMultiplayerModes(List<IgdbMultiplayerMode>? modes)
    {
        if (modes is null || modes.Count == 0) return null;

        // IGDB uses 0 and 1 to mean "not applicable" as often as a real ceiling, so anything at or
        // below 1 is treated as unknown rather than reported as a one-player maximum.
        static int? BestMax(List<IgdbMultiplayerMode> rows, Func<IgdbMultiplayerMode, int?> select) =>
            rows.Select(select).Where(v => v > 1).DefaultIfEmpty(null).Max();

        return new MultiplayerModesDto(
            modes.Any(m => m.OnlineCoop),
            modes.Any(m => m.OfflineCoop),
            modes.Any(m => m.CampaignCoop),
            modes.Any(m => m.LanCoop),
            modes.Any(m => m.SplitScreen || m.SplitScreenOnline),
            modes.Any(m => m.DropIn),
            BestMax(modes, m => m.OnlineMax),
            BestMax(modes, m => m.OnlineCoopMax),
            BestMax(modes, m => m.OfflineMax),
            BestMax(modes, m => m.OfflineCoopMax));
    }

    /// <summary>
    /// Groups IGDB's one-row-per-combination language table into one entry per language. Elden
    /// Ring returns 29 rows covering roughly a dozen languages, which is unreadable ungrouped.
    /// </summary>
    internal static List<LanguageSupportDto> MapLanguages(List<IgdbLanguageSupport>? supports)
    {
        if (supports is null || supports.Count == 0) return [];

        return supports
            .Where(sup => !string.IsNullOrWhiteSpace(sup.Language?.Name))
            .GroupBy(sup => sup.Language!.Name!)
            .Select(group => new LanguageSupportDto(
                group.Key,
                group
                    .Select(sup => sup.LanguageSupportType?.Name)
                    .OfType<string>()
                    .Distinct()
                    .OrderBy(name => name, StringComparer.Ordinal)
                    .ToList()))
            .OrderBy(l => l.Language, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>
    /// The game's ESRB rating as the short code the client shows, or null when the ESRB has not
    /// rated it. The cases are the <c>age_rating_categories</c> ids IGDB lists under the ESRB.
    /// </summary>
    internal static string? MapEsrbRating(List<IgdbAgeRating>? ageRatings)
    {
        var esrb = ageRatings?.FirstOrDefault(r => r.Organization == EsrbOrganization);

        return esrb?.RatingCategory switch
        {
            1 => "RP",
            2 => "EC",
            3 => "E",
            4 => "E10+",
            5 => "T",
            6 => "M",
            7 => "AO",
            _ => null
        };
    }
}
