import type { Route } from './+types/GameYoursPage';
import type { GameDto } from '@/types/game';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { titleAndYear } from '@/lib/releaseDate';
import { useGamePage } from '@/lib/gamePage';
import { NOINDEX } from '@/lib/seo';
import { GameYours } from '@/components/GameYours';

/**
 * The page is the reader's own, so it is kept off the index: a crawler would see the game's page under a
 * second address with nothing of its own (ADR 0084). A `noindex` page names no canonical URL
 * (`docs/decisions/0036-*`).
 */
export function meta({ matches }: Route.MetaArgs) {
    const game = (matches.find(match => match?.id === 'pages/GamePage')?.loaderData as { game?: GameDto } | undefined)?.game;
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
    const { authLoading } = useGamePage();
    return <GameYours authLoading={authLoading} />;
}
