import { useEffect, useState } from 'react';
import type { NewsItemDto } from '@/types/news';
import { NewsCard } from '@/components/NewsCard';

interface GameNewsPanelProps {
    gameId: number;
}

/**
 * "Latest news" for a single game, fetched on the client.
 *
 * Kept out of the route loader on purpose. News is supplementary and comes from a third party,
 * so blocking the server render of the game page on Steam would trade the page's own
 * time-to-first-byte — the part that matters for indexing — for a panel crawlers do not need.
 *
 * Renders nothing at all when the game has no Steam presence, which is the normal case for
 * console exclusives (ROADMAP N7). An empty panel or an error message would imply something
 * is broken when nothing is.
 */
export function GameNewsPanel({ gameId }: GameNewsPanelProps) {
    const [items, setItems] = useState<NewsItemDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastGameId, setLastGameId] = useState(gameId);

    // Clear the previous game's news when navigating between games. Adjusting state during
    // render rather than in the effect: resetting in the effect would flash the old game's
    // headlines under the new title for one commit, and trips react-hooks/set-state-in-effect.
    if (lastGameId !== gameId) {
        setLastGameId(gameId);
        setItems([]);
        setLoading(true);
    }

    useEffect(() => {
        const controller = new AbortController();

        fetch(`/api/news/game/${gameId}`, { signal: controller.signal })
            .then(r => (r.ok ? (r.json() as Promise<NewsItemDto[]>) : []))
            .then(data => setItems(data))
            .catch(() => {
                // Swallowed by design: the panel hides itself, and a failed garnish is not
                // worth an error box on a page that rendered perfectly well.
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [gameId]);

    if (loading || items.length === 0) return null;

    return (
        <section className="mt-10" aria-labelledby="game-news-heading">
            <h2
                id="game-news-heading"
                className="text-lg font-semibold text-white light:text-slate-900 mb-4 flex items-center gap-2"
            >
                <svg className="w-5 h-5 text-blue-400 light:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m0 0h2a2 2 0 012 2v9a2 2 0 01-2 2h-2m0-13v13M9 8h4m-4 4h4m-4 4h2" />
                </svg>
                Latest news &amp; patch notes
            </h2>

            <div className="flex flex-col gap-3">
                {items.map(item => (
                    <NewsCard key={item.id} item={item} showGame={false} />
                ))}
            </div>
        </section>
    );
}
