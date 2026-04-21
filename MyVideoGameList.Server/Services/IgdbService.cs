using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models.Igdb;

namespace MyVideoGameList.Server.Services;

public class IgdbService(
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    IMemoryCache cache) : IIgdbService
{
    private const string TokenCacheKey = "igdb_access_token";
    private const string ImageBaseUrl = "https://images.igdb.com/igdb/image/upload";
    // Buffer (in seconds) subtracted from the token's reported expiry so we refresh before it actually expires
    private const int TokenExpiryBufferSeconds = 120;

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

    private async Task<string> GetAccessTokenAsync()
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
        var response = await client.PostAsync("https://id.twitch.tv/oauth2/token", content);

        response.EnsureSuccessStatusCode();

        var tokenResponse = await response.Content.ReadFromJsonAsync<TwitchTokenResponse>(SnakeCaseOptions)
            ?? throw new InvalidOperationException("Failed to deserialize IGDB token response.");

        var cacheLifetimeSeconds = Math.Max(30, tokenResponse.ExpiresIn - TokenExpiryBufferSeconds);
        var expiry = TimeSpan.FromSeconds(cacheLifetimeSeconds);
        cache.Set(TokenCacheKey, tokenResponse.AccessToken, expiry);

        return tokenResponse.AccessToken;
    }

    public async Task<PagedGamesResponse> GetGamesAsync(int offset = 0, int limit = 20, string? search = null)
    {
        var cacheKey = $"igdb_games|{limit}|{offset}|{search ?? string.Empty}";
        if (cache.TryGetValue(cacheKey, out PagedGamesResponse? cached) && cached is not null)
            return cached;

        var accessToken = await GetAccessTokenAsync();
        var query = BuildQuery(offset, limit, search);

        var request = new HttpRequestMessage(HttpMethod.Post, "https://api.igdb.com/v4/games");
        request.Headers.Add("Client-ID", ClientId);
        request.Headers.Add("Authorization", $"Bearer {accessToken}");
        request.Content = new StringContent(query, Encoding.UTF8, "text/plain");

        var client = httpClientFactory.CreateClient("Igdb");
        var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var igdbGames = await response.Content.ReadFromJsonAsync<List<IgdbGame>>(SnakeCaseOptions)
            ?? [];

        var games = igdbGames.Select(MapToGameDto).ToList();
        var hasMore = igdbGames.Count == limit;
        var result = new PagedGamesResponse(games, hasMore);

        cache.Set(cacheKey, result, TimeSpan.FromMinutes(30));
        return result;
    }

    public async Task<IEnumerable<GameDto>> GetGamesByIdsAsync(IEnumerable<int> ids)
    {
        var idList = ids.ToList();
        if (idList.Count == 0) return [];

        idList.Sort();
        var idsCsv = string.Join(',', idList);
        var cacheKey = $"igdb_games_by_ids|{idsCsv}";
        if (cache.TryGetValue(cacheKey, out IEnumerable<GameDto>? cached) && cached is not null)
            return cached;

        var accessToken = await GetAccessTokenAsync();
        var query = new StringBuilder();
        query.AppendLine(GameFields);
        query.AppendLine($"where id = ({idsCsv});");
        query.AppendLine($"limit {idList.Count};");

        var request = new HttpRequestMessage(HttpMethod.Post, "https://api.igdb.com/v4/games");
        request.Headers.Add("Client-ID", ClientId);
        request.Headers.Add("Authorization", $"Bearer {accessToken}");
        request.Content = new StringContent(query.ToString(), Encoding.UTF8, "text/plain");

        var client = httpClientFactory.CreateClient("Igdb");
        var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var igdbGames = await response.Content.ReadFromJsonAsync<List<IgdbGame>>(SnakeCaseOptions) ?? [];
        var result = igdbGames.Select(MapToGameDto).ToList();

        cache.Set(cacheKey, result, TimeSpan.FromMinutes(30));
        return result;
    }

    private static string BuildQuery(int offset, int limit, string? search)
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

        var genres = g.Genres?.Select(genre => new GenreDto(genre.Id, genre.Name, null))
            ?? Enumerable.Empty<GenreDto>();

        var platforms = g.Platforms?.Select(p => new PlatformDto(
                p.Id, p.Name, p.Abbreviation ?? p.Name, null, null))
            ?? Enumerable.Empty<PlatformDto>();

        var developers = g.InvolvedCompanies?
            .Where(ic => ic.Developer)
            .Select(ic => new DeveloperDto(ic.Company.Id, ic.Company.Name, null, null, null, null, null))
            ?? Enumerable.Empty<DeveloperDto>();

        var publishers = g.InvolvedCompanies?
            .Where(ic => ic.Publisher)
            .Select(ic => new PublisherDto(ic.Company.Id, ic.Company.Name, null, null, null, null, null))
            ?? Enumerable.Empty<PublisherDto>();

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

    private static string? MapEsrbRating(int ratingValue) => ratingValue switch
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
