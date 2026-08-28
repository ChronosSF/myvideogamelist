import type { GameDto, PlatformDto } from '@/types/game';
import type { ListEntryDto } from '@/types/list';

/**
 * Fixture builders for the two DTOs the list views are built on.
 *
 * `GameDto` has eighteen fields and `ListEntryDto` wraps it, so spelling either out inline makes
 * a test about sort order read as a test about DTO shape. These take only what the assertion
 * cares about and fill the rest with neutral values.
 */
export function platform(id: number, name: string, abbreviation = name): PlatformDto {
    return { id, name, abbreviation, logoUrl: null, manufacturer: null };
}

export function game(overrides: Partial<GameDto> = {}): GameDto {
    return {
        id: 1,
        title: 'A Game',
        description: null,
        releaseDate: null,
        coverImageUrl: null,
        backgroundImageUrl: null,
        trailerUrl: null,
        website: null,
        rating: null,
        ratingCount: null,
        criticScore: null,
        criticScoreCount: null,
        esrbRating: null,
        platforms: [],
        genres: [],
        developers: [],
        publishers: [],
        details: null,
        ...overrides,
    };
}

/**
 * `game` is omitted from the base before being re-added as a partial. Intersecting
 * `Partial<ListEntryDto>` with `{ game?: Partial<GameDto> }` collapses the property back to a
 * required, complete `GameDto`, which defeats the point of a factory.
 */
export function entry(
    overrides: Omit<Partial<ListEntryDto>, 'game'> & { game?: Partial<GameDto> } = {},
): ListEntryDto {
    const { game: gameOverrides, ...rest } = overrides;
    return {
        game: game(gameOverrides),
        score: null,
        addedAt: '2026-01-01T00:00:00+00:00',
        statusChangedAt: null,
        ...rest,
    };
}
