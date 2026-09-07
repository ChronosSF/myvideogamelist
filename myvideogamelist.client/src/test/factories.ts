import type { GameDto, PlatformDto } from '@/types/game';
import type { ListEntryDto } from '@/types/list';
import type { EntryDetailDto, PlaythroughDto } from '@/types/playthrough';

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

/** One logged playthrough, with everything the panel does not assert on left blank. */
export function playthrough(overrides: Partial<PlaythroughDto> = {}): PlaythroughDto {
    return {
        id: 1,
        type: 'normally',
        platformId: null,
        minutesPlayed: null,
        startedOn: null,
        finishedOn: null,
        notes: null,
        createdAt: '2026-01-01T00:00:00+00:00',
        updatedAt: '2026-01-01T00:00:00+00:00',
        ...overrides,
    };
}

/**
 * What `GET /api/entries/{gameId}` returns: the entry, its playthroughs, and a review that is
 * always null until the review table ships.
 */
export function entryDetail(
    overrides: Omit<Partial<EntryDetailDto>, 'entry'> & { entry?: Parameters<typeof entry>[0] } = {},
): EntryDetailDto {
    const { entry: entryOverrides, ...rest } = overrides;
    return {
        entry: entry(entryOverrides),
        playthroughs: [],
        review: null,
        ...rest,
    };
}
