import { useEffect, useRef } from 'react';
import { formatCount } from '@/lib/format';

interface ShowMoreGamesProps {
    /** How many of the list's games are drawn. */
    shown: number;
    /** How many of the list's games are not drawn yet. */
    left: number;
    onShowMore: () => void;
}

/**
 * The foot of a list drawn a chunk at a time (`useDrawLimit`): a button that draws the next chunk, and is
 * pressed for the reader once it is within a screen of being scrolled to, so scrolling down a list never
 * meets its end before the list does.
 *
 * A button rather than an invisible marker, so that the rest of the list can be reached from the keyboard
 * and by a screen reader, and where there is no `IntersectionObserver` at all. It keeps focus when pressed:
 * the games it draws go in before it.
 *
 * Over the button, a polite status says how much of the list is drawn, so a chunk drawn for a reader
 * moving through the list by screen reader is heard rather than slipped in ahead of them.
 *
 * The observer is made again whenever `left` changes, because one only reports a change: a chunk too short
 * to carry the button back out of reach would otherwise leave it in reach, and never pressed again.
 */
export function ShowMoreGames({ shown, left, onShowMore }: ShowMoreGamesProps) {
    const button = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const element = button.current;
        if (!element || typeof IntersectionObserver === 'undefined') return;

        const observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) onShowMore();
            },
            { rootMargin: '0px 0px 100% 0px' },
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [onShowMore, left]);

    return (
        <div className="mt-10">
            <p className="mb-3 text-center text-sm text-fg-muted" role="status">
                Showing {formatCount(shown)} of {formatCount(shown + left)}
            </p>
            <button
                ref={button}
                type="button"
                className="w-full py-2 text-sm font-semibold btn-outline"
                onClick={onShowMore}
            >
                Show more ({formatCount(left)} left)
            </button>
        </div>
    );
}
