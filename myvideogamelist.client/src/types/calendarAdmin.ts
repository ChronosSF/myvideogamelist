/**
 * The release calendar's hand-entered data, as the admin page edits it. Mirrors `CalendarAdminDtos`
 * on the server; the rules are `specs/release-timeline-and-calendar.md` §6 and §7.
 */

/** What an event is, mirroring `CuratedEventKinds`. It decides how the calendar draws one. */
export type CuratedEventKind = 'sale' | 'fest' | 'showcase';

export const CURATED_EVENT_KINDS: readonly CuratedEventKind[] = ['sale', 'fest', 'showcase'];

export const CURATED_EVENT_KIND_LABELS: Record<CuratedEventKind, string> = {
    sale: 'Sale',
    fest: 'Fest',
    showcase: 'Showcase',
};

/** The stores the server accepts, mirroring `CuratedEventStores`. */
export const CURATED_EVENT_STORES = ['steam', 'epic', 'playstation', 'xbox', 'nintendo', 'gog'] as const;

export type CuratedEventStore = (typeof CURATED_EVENT_STORES)[number];

const STORE_LABELS: Record<CuratedEventStore, string> = {
    steam: 'Steam',
    epic: 'Epic Games Store',
    playstation: 'PlayStation Store',
    xbox: 'Xbox',
    nintendo: 'Nintendo eShop',
    gog: 'GOG',
};

/**
 * A store's name for people. The database keeps the store open while the API closes it, so a value
 * this does not know is shown as it is rather than as nothing.
 */
export function storeLabel(store: string): string {
    return (STORE_LABELS as Record<string, string | undefined>)[store] ?? store;
}

/** The lengths the server refuses past — `CuratedEvent` and `ShowcaseName`. */
export const CURATED_EVENT_NAME_MAX = 120;
export const CURATED_EVENT_URL_MAX = 512;
export const SHOWCASE_NAME_MAX = 100;

export interface CuratedEvent {
    id: number;
    kind: CuratedEventKind;
    /** Open in the database — see `storeLabel`. */
    store: string | null;
    name: string;
    /** The first day, `YYYY-MM-DD`. A day rather than an instant, shown as the day it names. */
    startsOn: string;
    /** The last day, inclusive. */
    endsOn: string;
    /** Where the dates were announced. */
    url: string;
    updatedAt: string;
}

/** What the page sends to add an event or to replace one whole. */
export interface CuratedEventInput {
    kind: CuratedEventKind;
    store: CuratedEventStore | null;
    name: string;
    startsOn: string;
    endsOn: string;
    url: string;
}

export interface ShowcaseName {
    id: number;
    prefix: string;
}
