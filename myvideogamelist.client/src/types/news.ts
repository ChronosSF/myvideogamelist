import type { GameDto } from '@/types/game';
import type { CalendarEvents, ComingSoonGame } from '@/types/releases';

export interface NewsItemDto {
    id: string;
    gameId: number;
    gameTitle: string;
    gameCoverUrl: string | null;
    title: string;
    url: string;
    source: string;
    /** Plain text — sanitized server-side. Never render this as HTML. */
    excerpt: string | null;
    publishedAt: string;
}

export interface HomeResponse {
    spotlight: GameDto | null;
    popular: GameDto[];
    news: NewsItemDto[];
    /**
     * The showcases and sales on in the next two weeks for any reader, wherever they are: a day wider
     * at each end than one reader's two weeks, in UTC, for the page to keep the reader's own days of.
     */
    events: CalendarEvents;
    /**
     * The new games of the next ninety days that the most people follow on IGDB, in the order they arrive
     * (ADR 0071). Empty when none passes the rules, which is an answer rather than a failure.
     */
    comingSoon: ComingSoonGame[];
    /**
     * True when an upstream failed and the payload is missing what it would have supplied. The
     * response is a 200 either way, so this is all that tells the loader not to let the page built
     * from it be cached.
     */
    degraded: boolean;
}
