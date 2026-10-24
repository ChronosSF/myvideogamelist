import type { GameRefDto } from '@/types/game';
import type { ListId } from '@/types/list';
import type { PlaythroughTypeKey } from '@/types/playthrough';

/**
 * The owner's history, mirroring `HistoryDtos.cs`: status changes, scores and playthrough dates as
 * one list, newest first.
 *
 * Every item is read from a row its owner wrote, at the moment that row records — nothing is
 * inferred, so what has no moment of its own is absent, and the page is told how much. See
 * `docs/decisions/0062-*`.
 */

/** One page, mirroring `HistoryPageDto`. */
export interface HistoryPage {
    items: HistoryItem[];
    /**
     * What to send as `?after=` for the page that follows, or null when this is the last. A position
     * in the order, encrypted, rather than a page number — opaque to the client, which passes it back
     * as it came.
     */
    next: string | null;
    /**
     * How many of the owner's games were put in a list by an import, which records where a game sat
     * and never when it got there, so none of those placements is an item. The same on every page.
     */
    importedStatuses: number;
    /**
     * How many scores have no moment — given before the history kept one, or imported — and so are
     * not items either. The same on every page.
     */
    undatedScores: number;
}

/**
 * One thing recorded about one game. The server sends one shape with the fields a kind does not
 * use set to null; these types name only the fields each kind reads.
 */
export type HistoryItem = StatusItem | ScoreItem | PlaythroughDateItem;

interface ItemBase {
    gameId: number;
    /**
     * Title and cover from the server's copy of IGDB's answer. Null when it holds none — a game IGDB
     * no longer lists, or one never fetched while IGDB is down — and the item stays, unnamed.
     */
    game: GameRefDto | null;
}

/** A move between lists, into one from none, or out of every list. */
export interface StatusItem extends ItemBase {
    kind: 'status';
    /** An instant, shown on the reader's own calendar. */
    at: string;
    on: null;
    /** Null when the game was in no list before. */
    fromStatus: ListId | null;
    /** Null when the game left every list. */
    toStatus: ListId | null;
}

/** The score a game holds now, from the moment it was given. */
export interface ScoreItem extends ItemBase {
    kind: 'score';
    at: string;
    on: null;
    /** The 1–10 the owner entered, shown on that scale and never as a percentage (ADR 0021). */
    score: number;
}

/** The day a playthrough started or finished. */
export interface PlaythroughDateItem extends ItemBase {
    kind: 'playthrough_started' | 'playthrough_finished';
    at: null;
    /** `yyyy-MM-dd`, as its owner wrote it: a day with no time and no zone. */
    on: string;
    /** The run's type, when it has one. */
    playthroughType: PlaythroughTypeKey | null;
}
