/**
 * Moderation, mirroring `ModerationDtos.cs` on the server: what a reader reports, and what the admin
 * page's moderation card reads and does about it. See `docs/decisions/0076-*`.
 */

/** Why a reader reports something: the terms' own categories, keyed as `ReportReason` keys them. */
export type ReportReason = 'spam' | 'abuse' | 'impersonation' | 'illegal' | 'rights' | 'other';

/** Every reason, in the order the report dialog offers them, with the words it offers them in. */
export const REPORT_REASONS: readonly { key: ReportReason; label: string }[] = [
    { key: 'spam', label: 'Spam' },
    { key: 'abuse', label: 'Hateful, harassing or offensive' },
    { key: 'impersonation', label: 'Pretends to be somebody else' },
    { key: 'illegal', label: 'Illegal' },
    { key: 'rights', label: 'Not theirs to post' },
    { key: 'other', label: 'Something else' },
];

/** A reason's words, or the key itself for one this client does not know. */
export function reasonLabel(reason: string): string {
    return REPORT_REASONS.find(r => r.key === reason)?.label ?? reason;
}

/** `ContentReport.NoteMaxLength` on the server, for the note's `maxLength`. */
export const REPORT_NOTE_MAX_LENGTH = 500;

/**
 * What is reported, named the way the page names it: by the handle, and for a review the game it is about.
 * No game is the profile itself — its display name, picture and bio.
 */
export interface ReportTarget {
    userName: string;
    gameId?: number;
}

/** One reader's report, as the admin sees it: never who made it. */
export interface Report {
    reason: string;
    note: string | null;
    reportedAt: string;
}

export interface ReportedReview {
    reviewId: number;
    userName: string;
    displayName: string | null;
    gameId: number;
    /** From the game cache; null when it had nothing for the game, which is then shown by its id. */
    gameTitle: string | null;
    body: string;
    hasSpoilers: boolean;
    /** Whether a reader would see it now. False once its author has withdrawn it. */
    published: boolean;
    reports: Report[];
}

export interface ReportedProfile {
    accountId: string;
    userName: string;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string | null;
    /** Whether the profile is public now. */
    published: boolean;
    reports: Report[];
}

export interface HiddenReview {
    reviewId: number;
    userName: string;
    gameId: number;
    gameTitle: string | null;
    body: string;
    hasSpoilers: boolean;
    hiddenAt: string;
}

/** `GET /api/admin/moderation`: each list a page from its start, with its total. */
export interface ModerationQueue {
    reviews: ReportedReview[];
    reviewsTotal: number;
    profiles: ReportedProfile[];
    profilesTotal: number;
    hidden: HiddenReview[];
    hiddenTotal: number;
}

/** Which of a profile's three fields an admin clears. At least one. */
export interface ProfileFields {
    displayName: boolean;
    avatarUrl: boolean;
    bio: boolean;
}
