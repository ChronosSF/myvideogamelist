import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStartOver } from '@/hooks/useStartOver';
import { startOver, StartOverUncertainError, type StartOverResult } from '@/lib/startOver';

/** Each provider's reload, held stable: a hook mock that hands back a fresh object per render loops. */
const reloads = vi.hoisted(() => ({
    lists: { reload: vi.fn() },
    wishlist: { reload: vi.fn() },
    favourites: { reload: vi.fn() },
    tags: { reload: vi.fn() },
}));

vi.mock('@/hooks/useLists', () => ({ useLists: () => reloads.lists }));
vi.mock('@/hooks/useWishlist', () => ({ useWishlist: () => reloads.wishlist }));
vi.mock('@/hooks/useFavourites', () => ({ useFavourites: () => reloads.favourites }));
vi.mock('@/hooks/useTags', () => ({ useTags: () => reloads.tags }));
vi.mock('@/lib/startOver', async importOriginal => ({
    ...await importOriginal<typeof import('@/lib/startOver')>(),
    startOver: vi.fn(),
}));

const counts: StartOverResult = { games: 3, wishlist: 1, favourites: 1, importRowsReselected: 0 };

beforeEach(() => {
    for (const provider of Object.values(reloads)) provider.reload.mockReset();
    vi.mocked(startOver).mockReset();
});

describe('useStartOver', () => {
    it('has every provider holding part of the library read it again once it is empty', async () => {
        vi.mocked(startOver).mockResolvedValueOnce(counts);
        const { result } = renderHook(() => useStartOver());

        expect(await result.current('hunter2')).toEqual(counts);

        expect(startOver).toHaveBeenCalledWith('hunter2');
        for (const provider of Object.values(reloads)) expect(provider.reload).toHaveBeenCalledTimes(1);
    });

    it('reads nothing again when the start over was refused, since nothing changed', async () => {
        vi.mocked(startOver).mockRejectedValueOnce(new Error('Password is incorrect.'));
        const { result } = renderHook(() => useStartOver());

        await expect(result.current('wrong')).rejects.toThrow('Password is incorrect.');

        for (const provider of Object.values(reloads)) expect(provider.reload).not.toHaveBeenCalled();
    });

    it('reads the library again when no answer arrived, since it may be gone, and still says it failed', async () => {
        vi.mocked(startOver).mockRejectedValueOnce(new StartOverUncertainError());
        const { result } = renderHook(() => useStartOver());

        await expect(result.current('hunter2')).rejects.toBeInstanceOf(StartOverUncertainError);

        for (const provider of Object.values(reloads)) expect(provider.reload).toHaveBeenCalledTimes(1);
    });
});
