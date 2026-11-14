import type { Route } from './+types/GameYoursPage';
import { useAuth } from '@/hooks/useAuth';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { titleAndYear } from '@/lib/releaseDate';
import { NOINDEX } from '@/lib/seo';
import { GameYours } from '@/components/GameYours';

/**
 * The page is the reader's own, so it is kept off the index: a crawler would see the game's page under a
 * second address with nothing of its own (ADR 0084). A `noindex` page names no canonical URL
 * (`docs/decisions/0036-*`).
 */
export function meta({ matches }: Route.MetaArgs) {
    // The game page's match, typed from the route table: the root's comes first.
    const game = matches[1]?.loaderData?.game;
    return [
        { title: game ? `Your game: ${titleAndYear(game)} - MyVideoGameList` : 'Your game - MyVideoGameList' },
        NOINDEX,
    ];
}

/**
 * Nothing shared. What the server renders here is the same for everybody — the reader's own record is read
 * after hydration, as it always was — but the address is a reader's own place, and a failure the game
 * page's boundary renders here hands on its own policy.
 */
export function headers({ errorHeaders }: Route.HeadersArgs) {
    return { 'Cache-Control': errorHeaders?.get('Cache-Control') ?? PRIVATE_NO_STORE };
}

/** The game page's Your game tab (ADR 0084), inside the reader's entry the page provides. */
export default function GameYoursPage() {
    const { loading } = useAuth();
    return <GameYours authLoading={loading} />;
}
