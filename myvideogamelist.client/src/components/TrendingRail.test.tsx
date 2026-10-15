import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TrendingRail } from '@/components/TrendingRail';
import type { FavouritesContextValue } from '@/contexts/FavouritesContext';
import { game } from '@/test/factories';

/**
 * The reader's favourites, as far as the rosette reads them. One module-level object handed back
 * every call, never a fresh literal — a new object per render re-runs any effect depending on it.
 */
const favoured = new Set<number>();
const favourites = {
    isFavourite: (gameId: number) => favoured.has(gameId),
} as unknown as FavouritesContextValue;

vi.mock('@/hooks/useFavourites', () => ({ useFavourites: () => favourites }));

const HADES = game({ id: 1, title: 'Hades' });
const TUNIC = game({ id: 2, title: 'Tunic' });

beforeEach(() => {
    favoured.clear();
});

describe('TrendingRail', () => {
    it("marks one of the reader's favourites among what is trending, in the name of its link", () => {
        // The rail is the same for everybody and server-rendered; the mark is the reader's own, read
        // after hydration like every other rosette (ADR 0064).
        favoured.add(TUNIC.id);
        render(<MemoryRouter><TrendingRail games={[HADES, TUNIC]} /></MemoryRouter>);

        expect(screen.getByRole('link', { name: 'Tunic, one of your favourites' })).toHaveAttribute('href', '/games/2');
        expect(screen.getByRole('link', { name: 'Hades' })).toBeInTheDocument();
    });
});
