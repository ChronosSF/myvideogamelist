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

/// <summary>
/// One rating board's rating of a game. A game rated in several regions carries one row per board.
/// </summary>
/// <remarks>
/// The board is <see cref="Organization"/>, an <c>age_rating_organizations</c> id, and the rating is
/// <see cref="RatingCategory"/>, an <c>age_rating_categories</c> id — <em>not</em> the older
/// <c>category</c> and <c>rating</c> fields. IGDB has removed those: asking for them returns each
/// row with nothing but its id, so every ESRB rating read as absent without an error. Verified
/// against live IGDB — ESRB is organization 1.
/// </remarks>
public record IgdbAgeRating(
    int Id,
    int? Organization,
    [property: JsonPropertyName("rating_category")] int? RatingCategory);

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
/// A <c>release_dates</c> row as the release calendar asks for it: with how much of the date is known,
/// the release's status, and its platform expanded, so that naming the platform does not depend on the
/// game's own platform list being current.
/// </summary>
/// <remarks>
/// <see cref="DateFormat"/> is 0 for a day, 1 a month, 2 a year, 3 to 6 a quarter and 7 "to be
/// decided". For anything but a day, <see cref="Date"/> is a stand-in — the first of the month, the last
/// day of the quarter or of the year — so <see cref="Y"/> and <see cref="M"/> are what say which period
/// it is. All three verified against live responses on 2026-09-29.
/// </remarks>
public record IgdbConnectedReleaseDate(
    int Id,
    long? Date,
    int? Game,
    IgdbPlatform? Platform,
    [property: JsonPropertyName("date_format")] int? DateFormat,
    int? Status,
    int? Y,
    int? M);

/// <summary>
/// A game as the release calendar needs it: its type, the game it is DLC for or an edition of, and its
/// series. <see cref="ParentGame"/> and <see cref="VersionParent"/> are asked for bare, so they arrive
/// as ids rather than as the objects <see cref="IgdbGame"/> expands them into.
/// </summary>
public record IgdbCalendarGame(
    int Id,
    string Name,
    IgdbCover? Cover,
    [property: JsonPropertyName("game_type")] int? GameType,
    [property: JsonPropertyName("parent_game")] int? ParentGame,
    [property: JsonPropertyName("version_parent")] int? VersionParent,
    List<IgdbNamedEntity>? Collections);

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

/// <summary>
/// A row from the IGDB <c>events</c> endpoint: a showcase, a festival or a convention.
/// </summary>
/// <remarks>
/// <see cref="StartTime"/> and <see cref="EndTime"/> are Unix seconds, and some older rows have no end.
/// IGDB's <c>time_zone</c> is not asked for: it is an abbreviation, and an unreliable one — the June 2026
/// showcases were "PST" although Los Angeles was on daylight time — while the instants are exact. All
/// verified against live responses on 2026-10-06.
/// </remarks>
public record IgdbEvent(
    int Id,
    string? Name,
    [property: JsonPropertyName("start_time")] long? StartTime,
    [property: JsonPropertyName("end_time")] long? EndTime,
    [property: JsonPropertyName("live_stream_url")] string? LiveStreamUrl);
