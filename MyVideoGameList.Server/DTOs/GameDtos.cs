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
    IEnumerable<LanguageSupportDto> Languages,
    IEnumerable<StoreLinkDto> Stores,
    RelatedGamesDto? Related = null);

/// <summary>A game referenced from another game, carrying just enough to render a cover card.</summary>
public record GameRefDto(int Id, string Name, string? CoverImageUrl);

/// <summary>
/// The rest of a game's series, and its remakes, remasters and editions (#450, ADR 0084). Null on
/// <see cref="GameDetailsDto.Related"/> when IGDB could not be asked, which the page reads as a render
/// to keep off the edge; empty lists when it was asked and there is nothing.
/// </summary>
/// <param name="AnchorId">
/// The game the page is about, or, when that game is an edition, the game it is an edition of: the card
/// the page marks as this one, wherever it falls in <paramref name="Games"/>.
/// </param>
/// <param name="Games">Every other game in the series, and this one's remakes, remasters and ports, in release order.</param>
/// <param name="Editions">The editions and bundles of the anchor, in release order: the same game, so a line of links rather than cards.</param>
public record RelatedGamesDto(int AnchorId, IEnumerable<RelatedGameDto> Games, IEnumerable<RelatedGameDto> Editions);

/// <summary>One game of <see cref="RelatedGamesDto"/>.</summary>
/// <param name="ReleaseYear">
/// The year of IGDB's <c>first_release_date</c>, in UTC. Only the year, because a date known to a month,
/// a quarter or a year is stored as a day inside it, so the year is always right where the day may not be.
/// </param>
/// <param name="Kind">
/// What it is to the page: <c>game</c>, <c>standalone</c>, <c>remake</c>, <c>remaster</c>, <c>expanded</c>
/// or <c>port</c> for a card, <c>edition</c> or <c>bundle</c> for an edition.
/// </param>
public record RelatedGameDto(int Id, string Name, string? CoverImageUrl, int? ReleaseYear, string Kind);

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

/// <summary>
/// A store a game is sold on, by the name the page shows, and the address of the game's page there.
/// No price: prices are IsThereAnyDeal's to give (ADR 0009), and this needs no key.
/// </summary>
public record StoreLinkDto(string Store, string Url);

public record PagedGamesResponse(IEnumerable<GameDto> Items, bool HasMore)
{
    /// <summary>
    /// The first <paramref name="count"/> games of this page, or the page itself when it holds no
    /// more than that. A page cut short has more by definition: the games it left out.
    /// </summary>
    public PagedGamesResponse FirstOf(int count)
    {
        var items = Items.ToList();
        return items.Count <= count ? this : new PagedGamesResponse(items.Take(count).ToList(), HasMore: true);
    }
}
