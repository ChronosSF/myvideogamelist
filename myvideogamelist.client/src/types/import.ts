import type { GameDto } from '@/types/game';

/** The keys the API uses for a job's state. See `ImportJobStates` on the server. */
export const IMPORT_STATE = {
    pending: 'pending',
    done: 'done',
    cancelled: 'cancelled',
} as const;

/**
 * What the importer made of a row.
 *
 * `unlooked` and `unmatched` are both "no game yet" and mean different things: nobody has searched
 * for this one, against somebody searched and IGDB had nothing. Only the first is worth another
 * pass. `ambiguous` means the matcher found games worth offering and would not choose between
 * them — several IGDB rows carry the title, or the best is a near miss — so such a row carries
 * `candidates` and imports nothing until its owner picks one. See `ImportMatchKinds` on the server.
 */
export const IMPORT_MATCH = {
    unlooked: 'unlooked',
    matched: 'matched',
    ambiguous: 'ambiguous',
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
    /**
     * When retention will delete this job. Computed on the server from the same windows the sweep
     * uses, so nothing here has to know how long a job is kept — see `ImportRetention`.
     */
    expiresAt: string;
}

export interface ImportReviewSummary {
    total: number;
    matched: number;
    /** Rows with candidates to choose between. */
    ambiguous: number;
    unmatched: number;
    /** Rows no matching pass has been over yet — what is left to look up. */
    unlooked: number;
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
    /**
     * The games the matcher would offer for an ambiguous row, best first. Empty for every other
     * row — and empty too for a candidate this app holds no metadata for, since a candidate
     * rendered as a bare id helps nobody choose.
     */
    candidates: GameDto[];
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

/**
 * What one matching pass did.
 *
 * Only the rows it examined, never the whole review — a pass resolves a bounded batch and the
 * client repeats it, so answering with every row would re-send the entire job on each of them.
 * An empty `examined` is how the client knows to stop.
 */
export interface ImportMatchPass {
    job: ImportJob;
    examined: ImportReviewRow[];
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
