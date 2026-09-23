import type { GameDto } from '@/types/game';

/** The keys the API uses for a job's state. See `ImportJobStates` on the server. */
export const IMPORT_STATE = {
    pending: 'pending',
    done: 'done',
    cancelled: 'cancelled',
} as const;

/** What the importer made of a row: either the file named a game or it did not. */
export const IMPORT_MATCH = {
    matched: 'matched',
    unmatched: 'unmatched',
} as const;

/** What the user decided about a row. */
export const IMPORT_DECISION = {
    import: 'import',
    skip: 'skip',
} as const;

export type ImportDecision = (typeof IMPORT_DECISION)[keyof typeof IMPORT_DECISION];

export interface ImportJob {
    id: string;
    /** Which service's export this was — `grouvee` today. */
    source: string;
    fileName: string;
    state: string;
    rowCount: number;
    importedCount: number | null;
    skippedCount: number | null;
    createdAt: string;
    completedAt: string | null;
}

export interface ImportReviewSummary {
    total: number;
    matched: number;
    unmatched: number;
    statusUnrecognised: number;
    alreadyTracked: number;
    /** How many rows are set to import — what the commit button counts. */
    selected: number;
}

export interface ImportReviewRow {
    id: number;
    title: string;
    releaseYear: number | null;
    gameId: number | null;
    /**
     * The matched game, when this app holds a copy of it. Null is not a failure — it means only
     * that the game has not been cached yet, or that IGDB is unreachable. The import needs the id
     * rather than the cover, so a null costs a thumbnail and not a row.
     */
    game: GameDto | null;
    matchKind: string;
    decision: string;
    /** The source's own word for the shelf, shown so the user sees what their file said. */
    sourceStatus: string | null;
    /** One of our status keys, or null for a row that will carry no status. */
    status: string | null;
    statusUnrecognised: boolean;
    score: number | null;
    wishlist: boolean;
    favourite: boolean;
    hasNotes: boolean;
    playthroughCount: number;
    minutesPlayed: number | null;
    /** The user already has an entry for this game, so importing it overwrites what is there. */
    alreadyTracked: boolean;
}

export interface ImportReview {
    job: ImportJob;
    summary: ImportReviewSummary;
    rows: ImportReviewRow[];
}

/** One decision, and optionally a correction to apply with it. */
export interface ImportRowDecision {
    rowId: number;
    decision: ImportDecision;
    gameId?: number | null;
    status?: string | null;
}

export interface ImportSkippedRow {
    title: string;
    sourceStatus: string | null;
    reason: string;
}

export interface ImportResult {
    job: ImportJob;
    /** Every row that did not import, with the reason. What the failure report is built from. */
    skipped: ImportSkippedRow[];
}
