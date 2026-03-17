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

export interface GameDto {
    id: number;
    title: string;
    description: string | null;
    releaseDate: string | null;
    coverImageUrl: string | null;
    backgroundImageUrl: string | null;
    trailerUrl: string | null;
    website: string | null;
    rating: number | null;
    metacriticScore: number | null;
    esrbRating: string | null;
    platforms: PlatformDto[];
    genres: GenreDto[];
    developers: DeveloperDto[];
    publishers: PublisherDto[];
}
