import type { ListEntryDto } from '@/types/list';

/**
 * The three playthrough types, mirroring the server's `PlaythroughType` rows.
 *
 * These keys are permanent: they are what the API, the export document and every community
 * median are written against. Adding a fourth is additive; renaming one would reinterpret
 * playthroughs people have already recorded.
 */
export type PlaythroughTypeKey = 'rushed' | 'normally' | 'completionist';

/**
 * One recorded time through a game.
 *
 * `platformId` is a bare IGDB id, deliberately — resolving it to a name server-side would mean an
 * IGDB call on a read that has to keep working when IGDB does not. The panel resolves it from the
 * game it is already showing.
 */
export interface PlaythroughDto {
    id: number;
    type: PlaythroughTypeKey | null;
    platformId: number | null;
    minutesPlayed: number | null;
    /** `yyyy-MM-dd`. A calendar date, not a timestamp — nobody records the hour they started. */
    startedOn: string | null;
    finishedOn: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
}

/** What a create or an update sends. Everything is optional; an unfinished run says so by omission. */
export interface PlaythroughInputDto {
    type: PlaythroughTypeKey | null;
    platformId: number | null;
    minutesPlayed: number | null;
    startedOn: string | null;
    finishedOn: string | null;
    notes: string | null;
}

/**
 * The user's own review of a game. At most one per game.
 *
 * The score is deliberately not on it — it lives on the entry, because a score with no prose is
 * the common case and must not require a review to exist.
 */
export interface ReviewDto {
    id: number;
    body: string;
    hasSpoilers: boolean;
    /**
     * `public` or `private`. Typed as a plain string rather than a union because the column is
     * one, and `friends` is a foreseeable third value: a response carrying one the client does not
     * know about should render, not throw.
     */
    visibility: string;
    /** The playthrough the review is about, when the author said which. */
    playthroughId: number | null;
    createdAt: string;
    updatedAt: string;
}

/** What a review write sends. A PUT: one per game, so writing again replaces it. */
export interface ReviewInputDto {
    body: string;
    hasSpoilers: boolean;
    visibility: 'public' | 'private';
    playthroughId: number | null;
}

/**
 * Everything the user has recorded about one game, from `GET /api/entries/{gameId}`. The list
 * views still read bare `ListEntryDto` rows — fifty of them at once have no use for anybody's
 * notes.
 */
export interface EntryDetailDto {
    entry: ListEntryDto;
    playthroughs: PlaythroughDto[];
    review: ReviewDto | null;
}

/** One tier's community median, in minutes, with the number of playthroughs behind it. */
export interface CommunityTimeBucket {
    type: PlaythroughTypeKey;
    samples: number;
    medianMinutes: number | null;
}

/** Always all three tiers, in effort order, so nothing has to guard a missing one. */
export interface CommunityTimes {
    buckets: CommunityTimeBucket[];
}

/**
 * The one place our playthrough types and IGDB's completion tiers are mapped onto each other.
 *
 * The two vocabularies exist because IGDB's are theirs and ours are ours — but they are
 * deliberately the same three buckets, which is what lets the game page show "IGDB: 45h / 119h /
 * 174h" against "MVGL members: 51h / 130h / —" as two readable rows from two sources rather than
 * one blend of unclear provenance. If the mapping lived in two places they would drift, and the
 * symptom would be two rows silently comparing different things.
 */
export const PLAYTHROUGH_TIERS = [
    {
        key: 'rushed',
        igdbKey: 'hastily',
        label: 'Rushed',
        hint: 'Straight through the main story',
        fill: 'bg-blue-400 light:bg-blue-300',
    },
    {
        key: 'normally',
        igdbKey: 'normally',
        label: 'Normally',
        hint: 'Main story plus a helping of extras',
        fill: 'bg-blue-500 light:bg-blue-500',
    },
    {
        key: 'completionist',
        igdbKey: 'completely',
        label: 'Completionist',
        hint: 'Everything the game has to offer',
        fill: 'bg-blue-600 light:bg-blue-700',
    },
] as const satisfies readonly {
    key: PlaythroughTypeKey;
    igdbKey: 'hastily' | 'normally' | 'completely';
    label: string;
    hint: string;
    fill: string;
}[];

/** The label for one of our type keys, for a list of playthroughs rather than a tier row. */
export function playthroughTypeLabel(type: PlaythroughTypeKey | null): string | null {
    return PLAYTHROUGH_TIERS.find(tier => tier.key === type)?.label ?? null;
}
