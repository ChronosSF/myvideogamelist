namespace MyVideoGameList.Server.DTOs;

public record PlatformDto(int Id, string Name, string Abbreviation, string? LogoUrl, string? Manufacturer);

public record GenreDto(int Id, string Name, string? Description);

public record DeveloperDto(
    int Id,
    string Name,
    string? Country,
    int? FoundedYear,
    string? Website,
    string? LogoUrl,
    string? Description);

public record PublisherDto(
    int Id,
    string Name,
    string? Country,
    int? FoundedYear,
    string? Website,
    string? LogoUrl,
    string? Description);

/// <summary>
/// A game as the listing endpoints return it. <see cref="Details"/> is populated only by the
/// single-game endpoint — the browse and rail queries deliberately do not ask IGDB for the
/// heavier related-entity fields, because paying for 20 screenshot sets and language tables per
/// page would cost far more than the listing can use.
/// </summary>
/// <remarks>
/// Both score pairs carry their sample size. A rating without its count invites the mistake of
/// treating one perfect review as a perfect game, which is exactly how the browse listing used
/// to fill up with 100s.
/// </remarks>
public record GameDto(
    int Id,
    string Title,
    string? Description,
    DateOnly? ReleaseDate,
    string? CoverImageUrl,
    string? BackgroundImageUrl,
    string? TrailerUrl,
    string? Website,
    float? Rating,
    int? RatingCount,
    int? CriticScore,
    int? CriticScoreCount,
    string? EsrbRating,
    IEnumerable<PlatformDto> Platforms,
    IEnumerable<GenreDto> Genres,
    IEnumerable<DeveloperDto> Developers,
    IEnumerable<PublisherDto> Publishers,
    GameDetailsDto? Details);

/// <summary>
/// The richer half of a game, for the detail page only. Every collection is empty rather than
/// null when IGDB has nothing, so the client can iterate without guarding each one.
/// </summary>
public record GameDetailsDto(
    TimeToBeatDto? TimeToBeat,
    IEnumerable<string> Screenshots,
    IEnumerable<GameRefDto> SimilarGames,
    IEnumerable<GameRefDto> Dlcs,
    IEnumerable<GameRefDto> Expansions,
    GameRefDto? ParentGame,
    IEnumerable<string> GameModes,
    MultiplayerModesDto? MultiplayerModes,
    IEnumerable<string> Themes,
    IEnumerable<string> PlayerPerspectives,
    IEnumerable<string> GameEngines,
    IEnumerable<string> Collections,
    IEnumerable<string> Franchises,
    IEnumerable<LanguageSupportDto> Languages);

/// <summary>A game referenced from another game, carrying just enough to render a cover card.</summary>
public record GameRefDto(int Id, string Name, string? CoverImageUrl);

/// <summary>
/// Average completion times <b>in seconds</b>, left unconverted so the client owns the
/// formatting. <see cref="Count"/> is the number of community submissions behind the averages
/// and is frequently in single digits — show it, or the numbers read as more authoritative
/// than they are.
/// </summary>
public record TimeToBeatDto(int? Hastily, int? Normally, int? Completely, int Count);

/// <summary>
/// Multiplayer capability folded across every platform the game reports: a flag is true if any
/// platform supports it, and each maximum is the highest any platform allows.
/// </summary>
public record MultiplayerModesDto(
    bool OnlineCoop,
    bool OfflineCoop,
    bool CampaignCoop,
    bool LanCoop,
    bool SplitScreen,
    bool DropIn,
    int? OnlineMax,
    int? OnlineCoopMax,
    int? OfflineMax,
    int? OfflineCoopMax);

/// <summary>One language and the ways it is supported — audio, subtitles, interface.</summary>
public record LanguageSupportDto(string Language, IEnumerable<string> SupportTypes);

public record PagedGamesResponse(IEnumerable<GameDto> Items, bool HasMore);
