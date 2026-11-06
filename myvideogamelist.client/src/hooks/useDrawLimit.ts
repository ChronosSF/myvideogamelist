import { useCallback, useState } from 'react';

/**
 * How many games a list draws at first, and how many more each time. Sixty is a whole number of rows at
 * every width of the grid, which is two to six columns (`GAME_GRID`), so a chunk never ends partway along
 * a row; in the table it is several screens.
 */
export const DRAW_CHUNK = 60;

interface Drawn {
    /** What the list was showing when this many were drawn. A different key starts again at one chunk. */
    key: string;
    count: number;
}

export interface DrawLimit {
    /** How many of the list's games to draw, from its top. */
    limit: number;
    /** Draws the next chunk. Stable across renders, so an observer can hold it. */
    showMore: () => void;
}

/**
 * How much of a long list to draw: a chunk to begin with and another each time `showMore` is called, as
 * the reader scrolls towards the end of what is drawn.
 *
 * Every game on a list is in memory already (the lists are loaded whole, ADR 0020), so this decides only
 * what is in the page. Drawn whole, a list of 640 games was 33,000 elements as tiles and 56,000 as a table,
 * and every change of order had React re-render all of them and the browser lay all of them out again, for
 * the screenful anybody can see: nearly half a second as tiles and up to a second and a half as a table, in
 * a production build, where sorting the games took two milliseconds.
 *
 * `key` names what the list is showing — its tab, its order, its filters — and a new one goes back to one
 * chunk, so a change of order costs one chunk however far down somebody had scrolled. Nothing else resets
 * it: a score given or a game taken off the list leaves the reader where they were.
 *
 * `atLeast` is a count the limit may not fall below, rounded up to whole chunks: a game being moved by
 * hand past the last one drawn is drawn where it would land, rather than vanishing from under its own
 * handle, and stays drawn once it is put down there.
 *
 * Reset during render rather than in an effect, as React documents for state that follows a prop, so a
 * new order is never drawn first at the old length.
 */
export function useDrawLimit(key: string, atLeast = 0): DrawLimit {
    const [drawn, setDrawn] = useState<Drawn>({ key, count: DRAW_CHUNK });

    let next = drawn.key === key ? drawn : { key, count: DRAW_CHUNK };
    if (next.count < atLeast) next = { key, count: Math.ceil(atLeast / DRAW_CHUNK) * DRAW_CHUNK };
    if (next !== drawn) setDrawn(next);

    const showMore = useCallback(
        () => setDrawn(current => ({ key: current.key, count: current.count + DRAW_CHUNK })),
        [],
    );

    return { limit: next.count, showMore };
}
