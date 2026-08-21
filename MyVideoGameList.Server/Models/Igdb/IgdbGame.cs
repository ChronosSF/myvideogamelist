using System.Text.Json.Serialization;

namespace MyVideoGameList.Server.Models.Igdb;

public record IgdbGame(
    int Id,
    string Name,
    string? Summary,
    [property: JsonPropertyName("first_release_date")] long? FirstReleaseDate,
    IgdbCover? Cover,
    List<IgdbArtwork>? Artworks,
    List<IgdbVideo>? Videos,
    List<IgdbWebsite>? Websites,
    double? Rating,
    [property: JsonPropertyName("aggregated_rating")] double? AggregatedRating,
    [property: JsonPropertyName("age_ratings")] List<IgdbAgeRating>? AgeRatings,
    List<IgdbGenre>? Genres,
    List<IgdbPlatform>? Platforms,
    [property: JsonPropertyName("involved_companies")] List<IgdbInvolvedCompany>? InvolvedCompanies);

public record IgdbCover(
    int Id,
    [property: JsonPropertyName("image_id")] string? ImageId);

public record IgdbArtwork(
    int Id,
    [property: JsonPropertyName("image_id")] string? ImageId);

public record IgdbVideo(
    int Id,
    [property: JsonPropertyName("video_id")] string? VideoId);

public record IgdbWebsite(
    int Id,
    string? Url,
    int Category);

public record IgdbAgeRating(
    int Id,
    int Category,
    int Rating);

public record IgdbGenre(
    int Id,
    string Name);

public record IgdbPlatform(
    int Id,
    string Name,
    string? Abbreviation);

public record IgdbInvolvedCompany(
    int Id,
    IgdbCompany Company,
    bool Developer,
    bool Publisher);

public record IgdbCompany(
    int Id,
    string Name);

public record TwitchTokenResponse(
    [property: JsonPropertyName("access_token")] string AccessToken,
    [property: JsonPropertyName("expires_in")] long ExpiresIn,
    [property: JsonPropertyName("token_type")] string TokenType);

/// <summary>
/// A single row from the IGDB <c>release_dates</c> endpoint, with <c>game</c> and <c>platform</c>
/// left as raw IDs rather than expanded objects — deep field traversal is unreliable, so the game
/// details are fetched separately and joined in memory.
/// </summary>
/// <remarks>
/// Unlike <see cref="IgdbGame.FirstReleaseDate"/> this is per-platform and per-region, so a title
/// that already launched on one platform still surfaces when it reaches another.
/// </remarks>
public record IgdbReleaseDate(
    int Id,
    long? Date,
    int? Game,
    int? Platform);
