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

    private static readonly JsonSerializerOptions SnakeCaseOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    private static readonly string GameFields =
        "fields id,name,summary,first_release_date," +
        "cover.image_id," +
        "artworks.image_id," +
        "videos.video_id," +
        "websites.url,websites.category," +
        "rating,aggregated_rating," +
        "age_ratings.category,age_ratings.rating," +
        "genres.id,genres.name," +
        "platforms.id,platforms.name,platforms.abbreviation," +
        "involved_companies.company.id,involved_companies.company.name," +
        "involved_companies.developer,involved_companies.publisher;";

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
        int offset = 0, int limit = 20, string? search = null, CancellationToken cancellationToken = default)
    {
        var cacheKey = $"igdb_games|{limit}|{offset}|{search ?? string.Empty}";
        if (cache.TryGetValue(cacheKey, out PagedGamesResponse? cached) && cached is not null)
            return cached;

        var igdbGames = await QueryAsync<IgdbGame>(
            GamesEndpoint, BuildQuery(offset, limit, search), cancellationToken);

        var games = igdbGames.Select(MapToGameDto).ToList();
        var result = new PagedGamesResponse(games, igdbGames.Count == limit);

        cache.Set(cacheKey, result, TimeSpan.FromMinutes(30));
        return result;
    }

    public async Task<GameDto?> GetGameByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        var cacheKey = $"igdb_game|{id}";
        if (cache.TryGetValue(cacheKey, out GameDto? cached))
            return cached;

        var query = new StringBuilder()
            .AppendLine(GameFields)
            .AppendLine($"where id = {id};")
            .AppendLine("limit 1;")
            .ToString();

        var igdbGames = await QueryAsync<IgdbGame>(GamesEndpoint, query, cancellationToken);
        var result = igdbGames.Select(MapToGameDto).FirstOrDefault();

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

    internal static string BuildQuery(int offset, int limit, string? search)
    {
        var sb = new StringBuilder();
        sb.AppendLine(GameFields);

        if (!string.IsNullOrWhiteSpace(search))
        {
            // Escape backslashes and double-quotes to prevent Apicalypse query injection
            var safeSearch = search.Replace("\\", "\\\\").Replace("\"", "\\\"");
            sb.AppendLine($"search \"{safeSearch}\";");
        }
        else
        {
            sb.AppendLine("sort aggregated_rating desc;");
        }

        sb.AppendLine($"limit {limit};");
        sb.AppendLine($"offset {offset};");

        return sb.ToString();
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

        float? rating = g.Rating.HasValue ? (float)Math.Round(g.Rating.Value / 10.0, 1) : null;
        int? metacriticScore = g.AggregatedRating.HasValue ? (int)Math.Round(g.AggregatedRating.Value) : null;

        var esrbRating = g.AgeRatings?.FirstOrDefault(r => r.Category == 1) is { } esrb
            ? MapEsrbRating(esrb.Rating)
            : null;

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
            metacriticScore,
            esrbRating,
            platforms,
            genres,
            developers,
            publishers);
    }

    internal static string? MapEsrbRating(int ratingValue) => ratingValue switch
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
