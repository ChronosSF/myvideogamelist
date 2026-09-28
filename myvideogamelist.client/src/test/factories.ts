import type { UserProfile } from '@/types/auth';
import type { GameDto, PlatformDto } from '@/types/game';
import {
    IMPORT_DECISION,
    IMPORT_MATCH,
    IMPORT_STATE,
    type ImportJob,
    type ImportReview,
    type ImportReviewRow,
} from '@/types/import';
import type { ListEntryDto } from '@/types/list';
import type { EntryDetailDto, PlaythroughDto, ReviewDto } from '@/types/playthrough';

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
 * What `GET /api/entries/{gameId}` returns: the entry, how the user has it, their notes, its
 * playthroughs and their review — everything but the entry blank unless a test says otherwise.
 */
export function entryDetail(
    overrides: Omit<Partial<EntryDetailDto>, 'entry'> & { entry?: Parameters<typeof entry>[0] } = {},
): EntryDetailDto {
    const { entry: entryOverrides, ...rest } = overrides;
    return {
        entry: entry(entryOverrides),
        ownership: null,
        notes: null,
        playthroughs: [],
        review: null,
        ...rest,
    };
}

/** The user's own review of a game, private and spoiler-free unless a test says otherwise. */
export function review(overrides: Partial<ReviewDto> = {}): ReviewDto {
    return {
        id: 1,
        body: 'Worth every hour.',
        hasSpoilers: false,
        visibility: 'private',
        playthroughId: null,
        createdAt: '2026-01-01T00:00:00+00:00',
        updatedAt: '2026-01-01T00:00:00+00:00',
        ...overrides,
    };
}

/** One import, as `/api/import/jobs` returns it. */
export function importJob(overrides: Partial<ImportJob> = {}): ImportJob {
    return {
        id: 'job-1',
        source: 'grouvee',
        fileName: 'grouvee_export.json',
        state: IMPORT_STATE.pending,
        rowCount: 1,
        importedCount: null,
        skippedCount: null,
        createdAt: '2026-09-22T12:00:00Z',
        completedAt: null,
        expiresAt: '2026-10-06T12:00:00Z',
        ...overrides,
    };
}

/** One row of a review. Eighteen fields, of which a test usually cares about two. */
export function importRow(overrides: Partial<ImportReviewRow> = {}): ImportReviewRow {
    return {
        id: 1,
        title: 'Metal Gear Solid 3',
        releaseYear: 2004,
        gameId: 379,
        game: null,
        candidates: [],
        matchKind: IMPORT_MATCH.matched,
        decision: IMPORT_DECISION.import,
        sourceStatus: 'Played',
        status: 'finished',
        statusUnrecognised: false,
        score: 10,
        wishlist: false,
        favourite: false,
        hasNotes: false,
        playthroughCount: 0,
        minutesPlayed: null,
        alreadyTracked: false,
        ...overrides,
    };
}

/**
 * A whole review, with the summary derived from the rows rather than restated.
 *
 * Derived, because a fixture that stated its own counts would let a test assert against a summary
 * the API could never produce — and the counting rules are the interesting part of more than one
 * of these tests.
 */
export function importReview(rows: ImportReviewRow[], job: Partial<ImportJob> = {}): ImportReview {
    const count = (kind: string) => rows.filter(row => row.matchKind === kind).length;

    return {
        job: importJob({ rowCount: rows.length, ...job }),
        summary: {
            total: rows.length,
            matched: count(IMPORT_MATCH.matched),
            ambiguous: count(IMPORT_MATCH.ambiguous),
            unmatched: count(IMPORT_MATCH.unmatched),
            unlooked: count(IMPORT_MATCH.unlooked),
            statusUnrecognised: rows.filter(row => row.statusUnrecognised).length,
            alreadyTracked: rows.filter(row => row.alreadyTracked).length,
            selected: rows.filter(row => row.decision === IMPORT_DECISION.import).length,
        },
        rows,
    };
}

/** The signed-in account, as `/api/auth/me` returns it. */
export function userProfile(overrides: Partial<UserProfile> = {}): UserProfile {
    return {
        id: 'user-1',
        email: 'alex@test.local',
        userName: 'alex',
        theme: 'dark',
        profileVisibility: 'private',
        ...overrides,
    };
}
