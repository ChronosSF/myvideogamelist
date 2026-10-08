import type { CuratedEventKind, CuratedEventStore } from '@/types/calendarAdmin';
import type { PlatformDto } from '@/types/game';
import type { ListId } from '@/types/list';

/**
 * What is coming for somebody's games, and what sits beside it — mirrors `ReleaseDtos` and
 * `CalendarDtos` on the server. The rules are `specs/release-timeline-and-calendar.md`.
 */

/** How much of a release date IGDB knows (spec §4). The two-week line asks only for `day`. */
export type ReleasePrecision = 'day' | 'month' | 'quarter' | 'year';

/** What a release is, from IGDB's game type — only the ones F1 keeps. */
export type ReleaseKind =
    | 'game'
    | 'dlc'
    | 'expansion'
    | 'standalone_expansion'
    | 'episode'
    | 'season'
    | 'remake'
    | 'remaster'
    | 'expanded_game'
    | 'port';

/** R1, R2 and R3: the game itself, one of its children, or another game in its series. */
export type ReleaseRelation = 'itself' | 'child' | 'series';

/** Why the game that brought a release in is in the user's set (§3.1). */
export type SetMembership = 'favourite' | 'wishlist' | 'list';

/** Why a release is on somebody's line (§3.4), as data; `@/lib/releaseReason` says it in words. */
export interface ReleaseReason {
    relation: ReleaseRelation;
    /** The game in the user's set that brought it in. */
    gameId: number;
    /** That game's title; null only for a game IGDB no longer answers for. */
    title: string | null;
    membership: SetMembership;
    /** The list's status key, when the membership is a list. Never `dropped`: Dropped is not in the set. */
    list: ListId | null;
    /** The series they share, when the relation is `series`. */
    series: string | null;
}

export interface ConnectedRelease {
    gameId: number;
    title: string;
    coverImageUrl: string | null;
    kind: ReleaseKind;
    /** What it arrives on that day. Empty when IGDB did not say. */
    platforms: PlatformDto[];
    earlyAccess: boolean;
    reason: ReleaseReason;
}

/**
 * One thing the line draws: a release, or several on the same day that belong together (F6) —
 * "Kingdom Hearts — 8 releases". A group's releases come strongest reason first.
 */
export interface ReleaseEntry {
    precision: ReleasePrecision;
    /** The day, `YYYY-MM-DD`, or the first day of the month, quarter or year. */
    starts: string;
    /** What the releases have in common, when there are several. */
    groupName: string | null;
    releases: ConnectedRelease[];
}

/** A sale, a fest or a showcase entered on the admin page: days, not instants (S3). */
export interface CalendarCuratedEvent {
    id: number;
    kind: CuratedEventKind;
    store: CuratedEventStore | null;
    name: string;
    startsOn: string;
    /** The last day, inclusive. */
    endsOn: string;
    /** Where the dates were announced. */
    url: string;
}

/** A showcase from IGDB, as instants: only the reader's clock can say which day it is on. */
export interface CalendarShowcase {
    id: number;
    name: string;
    startsAt: string;
    endsAt: string | null;
    /** Where to watch it, when IGDB has a stream. */
    url: string | null;
}

/** What `/api/calendar/events` answers: the same for everybody. */
export interface CalendarEvents {
    curated: CalendarCuratedEvent[];
    showcases: CalendarShowcase[];
    /** True when IGDB could not be asked, so the showcases are missing rather than none. */
    degraded: boolean;
}
