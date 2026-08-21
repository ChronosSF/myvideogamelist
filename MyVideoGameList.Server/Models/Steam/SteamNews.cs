using System.Text.Json.Serialization;

namespace MyVideoGameList.Server.Models.Steam;

/// <summary>
/// The <c>ISteamNews/GetNewsForApp</c> response shape.
/// </summary>
/// <remarks>
/// Property names are mapped explicitly rather than by naming policy. Steam's JSON is not
/// consistently snake_case — <c>newsitems</c> and <c>feedlabel</c> are single lowercase words
/// while <c>is_external_url</c> is separated — so a policy would silently miss the former and
/// deserialize an empty feed instead of failing loudly.
/// </remarks>
public record SteamNewsResponse(
    [property: JsonPropertyName("appnews")] SteamAppNews? AppNews);

public record SteamAppNews(
    [property: JsonPropertyName("appid")] int AppId,
    [property: JsonPropertyName("newsitems")] List<SteamNewsItem>? NewsItems);

public record SteamNewsItem(
    [property: JsonPropertyName("gid")] string? Gid,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("url")] string? Url,
    [property: JsonPropertyName("author")] string? Author,
    [property: JsonPropertyName("contents")] string? Contents,
    [property: JsonPropertyName("feedlabel")] string? FeedLabel,
    [property: JsonPropertyName("feedname")] string? FeedName,
    [property: JsonPropertyName("date")] long Date);
