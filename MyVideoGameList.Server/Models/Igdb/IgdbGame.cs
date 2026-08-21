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

/// <summary>
/// A row from the IGDB <c>external_games</c> endpoint, which maps an IGDB game onto its
/// identifier on another storefront. <see cref="Uid"/> is that store's own id — for Steam
/// it is the AppID used by the Steam web API.
/// </summary>
/// <remarks>
/// <para>
/// The store is identified by <see cref="ExternalGameSource"/>, <em>not</em> by the older
/// <c>category</c> field. IGDB has removed <c>category</c> from responses: asking for it returns
/// no such key, and filtering <c>where category = 1</c> silently matches zero rows rather than
/// erroring. Verified against live IGDB — Steam is source 1.
/// </para>
/// <para>
/// The <c>uid</c> arrives as a string even for Steam, where it is numerically an AppID, so
/// callers must parse it rather than assume it is well formed.
/// </para>
/// </remarks>
public record IgdbExternalGame(
    int Id,
    int? Game,
    string? Uid,
    [property: JsonPropertyName("external_game_source")] int? ExternalGameSource);

/// <summary>
/// A row from the IGDB <c>popularity_primitives</c> endpoint: one popularity score for one game
/// under one <c>popularity_type</c>.
/// </summary>
public record IgdbPopularityPrimitive(
    int Id,
    [property: JsonPropertyName("game_id")] int? GameId,
    double? Value);
