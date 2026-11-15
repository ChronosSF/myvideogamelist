import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DRAW_CHUNK, useDrawLimit } from '@/hooks/useDrawLimit';

/** The hook under a key and a floor the test can change between renders. */
function drawing(key = 'playing|title|false', atLeast = 0) {
    return renderHook(props => useDrawLimit(props.key, props.atLeast), { initialProps: { key, atLeast } });
}

describe('useDrawLimit', () => {
    it('draws one chunk, and a chunk more each time it is asked', () => {
        const { result } = drawing();
        expect(result.current.limit).toBe(DRAW_CHUNK);

        act(() => result.current.showMore());
        act(() => result.current.showMore());

        expect(result.current.limit).toBe(3 * DRAW_CHUNK);
    });

    it('draws a chunk whole rows long at every width of the grid, two columns to six', () => {
        for (const columns of [2, 3, 4, 5, 6]) expect(DRAW_CHUNK % columns).toBe(0);
    });

    it('starts again at one chunk under a new key, and keeps counting under the same one', () => {
        const { result, rerender } = drawing();
        act(() => result.current.showMore());

        rerender({ key: 'playing|title|false', atLeast: 0 });
        expect(result.current.limit).toBe(2 * DRAW_CHUNK);

        rerender({ key: 'playing|title|true', atLeast: 0 });
        expect(result.current.limit).toBe(DRAW_CHUNK);

        act(() => result.current.showMore());
        expect(result.current.limit).toBe(2 * DRAW_CHUNK);
    });

    it('never draws fewer than it is told to, in whole chunks, and keeps them once the floor is gone', () => {
        const { result, rerender } = drawing();

        rerender({ key: 'playing|title|false', atLeast: DRAW_CHUNK + 1 });
        expect(result.current.limit).toBe(2 * DRAW_CHUNK);

        rerender({ key: 'playing|title|false', atLeast: 0 });
        expect(result.current.limit).toBe(2 * DRAW_CHUNK);
    });

    it('hands out the same way to ask for more on every render, for an observer to hold', () => {
        const { result, rerender } = drawing();
        const first = result.current.showMore;

        act(() => first());
        rerender({ key: 'backlog|manual|false', atLeast: 0 });

        expect(result.current.showMore).toBe(first);
    });
});
