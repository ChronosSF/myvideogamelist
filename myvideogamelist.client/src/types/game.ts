export interface PlatformDto {
    id: number;
    name: string;
    abbreviation: string;
    logoUrl: string | null;
    manufacturer: string | null;
}

export interface GenreDto {
    id: number;
    name: string;
    description: string | null;
}

export interface DeveloperDto {
    id: number;
    name: string;
    country: string | null;
    foundedYear: number | null;
    website: string | null;
    logoUrl: string | null;
    description: string | null;
}

export interface PublisherDto {
    id: number;
    name: string;
    country: string | null;
    foundedYear: number | null;
    website: string | null;
    logoUrl: string | null;
    description: string | null;
}

/** A game referenced from another game — similar titles, DLC, expansions, the parent title. */
export interface GameRefDto {
    id: number;
    name: string;
    coverImageUrl: string | null;
}

/**
 * Average completion times **in seconds**, from community submissions. `count` is how many
 * submissions back them and is often single digits, so it is always shown alongside.
 */
export interface TimeToBeatDto {
    hastily: number | null;
    normally: number | null;
    completely: number | null;
    count: number;
}

/** Multiplayer capability folded across every platform: any platform supporting it counts. */
export interface MultiplayerModesDto {
    onlineCoop: boolean;
    offlineCoop: boolean;
    campaignCoop: boolean;
    lanCoop: boolean;
    splitScreen: boolean;
    dropIn: boolean;
    onlineMax: number | null;
    onlineCoopMax: number | null;
    offlineMax: number | null;
    offlineCoopMax: number | null;
}

export interface LanguageSupportDto {
    language: string;
    supportTypes: string[];
}

/**
 * A store the game is sold on, by the name the page shows, and the address of the game's page there:
 * https, on that store's own host, with nothing after the path. No price — prices come from
 * IsThereAnyDeal (ADR 0009).
 */
export interface StoreLinkDto {
    store: string;
    url: string;
}

/**
 * The detail-only half of a game. Present only on `/api/games/{id}` — the listing endpoints
 * return `details: null`, because screenshots and language tables multiplied by a page of
 * results cost far more than a grid of covers can use.
 */
export interface GameDetailsDto {
    timeToBeat: TimeToBeatDto | null;
    screenshots: string[];
    similarGames: GameRefDto[];
    dlcs: GameRefDto[];
    expansions: GameRefDto[];
    parentGame: GameRefDto | null;
    gameModes: string[];
    multiplayerModes: MultiplayerModesDto | null;
    themes: string[];
    playerPerspectives: string[];
    gameEngines: string[];
    collections: string[];
    franchises: string[];
    languages: LanguageSupportDto[];
    /** One per store, in the order the page lists them; empty when IGDB names none. */
    stores: StoreLinkDto[];
    /**
     * The rest of the game's series and its remakes, remasters and editions (issue 450, ADR 0084). Null when
     * IGDB could not be asked, which makes the render one to keep off the edge; missing from an API older
     * than this build.
     */
    related?: RelatedGamesDto | null;
}

/** What a related game is to the page: a card's kind, or an edition's. */
export type RelatedGameKind = 'game' | 'standalone' | 'remake' | 'remaster' | 'expanded' | 'port' | 'edition' | 'bundle';

export interface RelatedGameDto {
    id: number;
    name: string;
    coverImageUrl: string | null;
    /** The year of its first release, which is right even where IGDB knows only the month, quarter or year. */
    releaseYear: number | null;
    kind: RelatedGameKind;
}

export interface RelatedGamesDto {
    /** The game the page marks as its own: the game itself, or the game it is an edition of. */
    anchorId: number;
    /** The series and the anchor's remakes, remasters and ports, in release order, the anchor among them. */
    games: RelatedGameDto[];
    /** The anchor's editions and bundles, in release order. */
    editions: RelatedGameDto[];
}

export interface GameDto {
    id: number;
    title: string;
    description: string | null;
    releaseDate: string | null;
    coverImageUrl: string | null;
    backgroundImageUrl: string | null;
    trailerUrl: string | null;
    website: string | null;
    /** IGDB's blended critic-and-user score, out of 10. */
    rating: number | null;
    /** How many scores back `rating`. */
    ratingCount: number | null;
    /** Critics-only aggregate, out of 100. Meaningless without `criticScoreCount`. */
    criticScore: number | null;
    criticScoreCount: number | null;
    esrbRating: string | null;
    platforms: PlatformDto[];
    genres: GenreDto[];
    developers: DeveloperDto[];
    publishers: PublisherDto[];
    details: GameDetailsDto | null;
}

export interface PagedGamesResponse {
    items: GameDto[];
    hasMore: boolean;
}
