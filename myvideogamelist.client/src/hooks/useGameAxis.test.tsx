import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type GameAxisOptions, useGameAxis } from '@/hooks/useGameAxis';
import { game } from '@/test/factories';

/**
 * The shared axis on its own, for what neither provider's suite can reach: the two providers' tests
 * cover the wishlist and the favourites through their contexts, and the wishlist's context does not
 * hand on a move at all.
 */
const auth = {
    user: { id: 'u1', email: 'alice@test.local' },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

/** The wishlist's shape: no `order`. Module-level, as every provider's options are. */
const NO_ORDER: GameAxisOptions = {
    endpoint: '/api/wishlist',
    loadFailed: status => `Failed to load your wishlist (${status})`,
    loadUnreachable: 'Failed to load your wishlist.',
    mutationFailed: 'Failed to update your wishlist. Please try again.',
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('useGameAxis', () => {
    it('refuses a move on an axis with no order, and sends nothing', async () => {
        const items = [
            { game: game({ id: 1, title: 'Hades' }), addedAt: '2026-03-01T00:00:00+00:00' },
            { game: game({ id: 2, title: 'Tunic' }), addedAt: '2026-02-01T00:00:00+00:00' },
        ];
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(items), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => useGameAxis(NO_ORDER));
        await waitFor(() => expect(result.current.items).toHaveLength(2));

        let moved: boolean | undefined;
        await act(async () => {
            moved = await result.current.moveInOrder(2, null);
        });

        expect(moved).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.current.items.map(item => item.game.title)).toEqual(['Hades', 'Tunic']);
        expect(result.current.mutationError).toBeNull();
    });
});
