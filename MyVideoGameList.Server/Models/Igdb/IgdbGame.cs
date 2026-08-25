using System.Text.Json.Serialization;

namespace MyVideoGameList.Server.Models.Igdb;

public record IgdbGame(
    int Id,
    string Name,
    string? Summary,
    [property: JsonPropertyName("first_release_date")] long? FirstReleaseDate,
    IgdbCover? Cover,
    List<IgdbArtwork>? Artworks,
    List<IgdbScreenshot>? Screenshots,
    List<IgdbVideo>? Videos,
    List<IgdbWebsite>? Websites,
    double? Rating,
    [property: JsonPropertyName("aggregated_rating")] double? AggregatedRating,
    [property: JsonPropertyName("aggregated_rating_count")] int? AggregatedRatingCount,
    [property: JsonPropertyName("total_rating")] double? TotalRating,
    [property: JsonPropertyName("total_rating_count")] int? TotalRatingCount,
    [property: JsonPropertyName("age_ratings")] List<IgdbAgeRating>? AgeRatings,
    List<IgdbGenre>? Genres,
    List<IgdbPlatform>? Platforms,
    [property: JsonPropertyName("involved_companies")] List<IgdbInvolvedCompany>? InvolvedCompanies,
    List<IgdbNamedEntity>? Themes,
    [property: JsonPropertyName("player_perspectives")] List<IgdbNamedEntity>? PlayerPerspectives,
    [property: JsonPropertyName("game_modes")] List<IgdbNamedEntity>? GameModes,
    [property: JsonPropertyName("game_engines")] List<IgdbNamedEntity>? GameEngines,
    List<IgdbNamedEntity>? Collections,
    List<IgdbNamedEntity>? Franchises,
    [property: JsonPropertyName("multiplayer_modes")] List<IgdbMultiplayerMode>? MultiplayerModes,
    [property: JsonPropertyName("language_supports")] List<IgdbLanguageSupport>? LanguageSupports,
    [property: JsonPropertyName("similar_games")] List<IgdbRelatedGame>? SimilarGames,
    List<IgdbRelatedGame>? Dlcs,
    List<IgdbRelatedGame>? Expansions,
    [property: JsonPropertyName("parent_game")] IgdbRelatedGame? ParentGame);

public record IgdbCover(
    int Id,
    [property: JsonPropertyName("image_id")] string? ImageId);

public record IgdbArtwork(
    int Id,
    [property: JsonPropertyName("image_id")] string? ImageId);

public record IgdbScreenshot(
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

/// <summary>
/// The shape IGDB uses for its many small id-plus-name lookup tables — themes, game modes,
/// player perspectives, engines, collections, franchises and languages all deserialize into this.
/// </summary>
public record IgdbNamedEntity(
    int Id,
    string? Name);

/// <summary>
/// A game referenced from another game: similar games, DLC, expansions and the parent title.
/// Only the fields a cover card needs are requested.
/// </summary>
public record IgdbRelatedGame(
    int Id,
    string? Name,
    IgdbCover? Cover);

/// <summary>
/// One row of multiplayer capability, scoped to a single platform — a game on four platforms
/// returns four rows, so callers have to fold them together.
/// </summary>
/// <remarks>
/// Every property here needs an explicit <see cref="JsonPropertyNameAttribute"/>: IGDB spells
/// these fields as unseparated lowercase (<c>offlinecoopmax</c>), which the service's
/// snake_case naming policy would otherwise map to <c>offline_coop_max</c> and silently miss.
/// </remarks>
public record IgdbMultiplayerMode(
    int Id,
    [property: JsonPropertyName("campaigncoop")] bool CampaignCoop,
    [property: JsonPropertyName("dropin")] bool DropIn,
    [property: JsonPropertyName("lancoop")] bool LanCoop,
    [property: JsonPropertyName("offlinecoop")] bool OfflineCoop,
    [property: JsonPropertyName("onlinecoop")] bool OnlineCoop,
    [property: JsonPropertyName("splitscreen")] bool SplitScreen,
    [property: JsonPropertyName("splitscreenonline")] bool SplitScreenOnline,
    [property: JsonPropertyName("offlinecoopmax")] int? OfflineCoopMax,
    [property: JsonPropertyName("offlinemax")] int? OfflineMax,
    [property: JsonPropertyName("onlinecoopmax")] int? OnlineCoopMax,
    [property: JsonPropertyName("onlinemax")] int? OnlineMax);

/// <summary>
/// One language-and-support-type pairing. A game lists a separate row per combination, so
/// "French audio, subtitles and interface" arrives as three rows.
/// </summary>
public record IgdbLanguageSupport(
    int Id,
    IgdbNamedEntity? Language,
    [property: JsonPropertyName("language_support_type")] IgdbNamedEntity? LanguageSupportType);

/// <summary>
/// Community-submitted completion times from the <c>game_time_to_beats</c> endpoint, in seconds.
/// <c>Count</c> is how many submissions back the averages, which is often single digits.
/// </summary>
public record IgdbGameTimeToBeat(
    int Id,
    [property: JsonPropertyName("game_id")] int? GameId,
    int? Hastily,
    int? Normally,
    int? Completely,
    int? Count);

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
