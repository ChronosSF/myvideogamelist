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

        // The rosette itself, by its class: it is deliberately outside the accessibility tree.
        const marks = document.querySelectorAll('.favourite-mark-cover');
        expect(marks).toHaveLength(1);
        expect(screen.getByRole('link', { name: /Tunic/ })).toContainElement(marks[0] as HTMLElement);
    });
});

const EIGHT = Array.from({ length: 8 }, (_, index) => game({
    id: index + 1,
    title: `Game ${index + 1}`,
    coverImageUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/co${index + 1}.jpg`,
}));

const SIZES = '(min-width: 40rem) calc(9rem - 2px), calc(8rem - 2px)';

describe('TrendingRail covers', () => {
    it('loads the first row with the page, and lets the rest wait until they are scrolled to', () => {
        // The first covers are in view on most screens and can be the page's largest first paint,
        // which a lazy image delays rather than speeds up.
        const { container } = render(<MemoryRouter><TrendingRail games={EIGHT} /></MemoryRouter>);

        const covers = [...container.querySelectorAll('img')];
        expect(covers.map(cover => cover.getAttribute('loading')))
            .toEqual([...Array<string>(6).fill('eager'), 'lazy', 'lazy']);
        expect(covers.map(cover => cover.getAttribute('decoding')))
            .toEqual([...Array<null>(6).fill(null), 'async', 'async']);
    });

    it("offers each cover at the sizes IGDB has, for the card's width at each breakpoint", () => {
        const { container } = render(<MemoryRouter><TrendingRail games={EIGHT} /></MemoryRouter>);

        const covers = [...container.querySelectorAll('img')];
        expect(covers[0].getAttribute('srcset')).toContain('/t_cover_small_2x/co1.jpg 180w');
        expect(covers[0]).toHaveAttribute('sizes', SIZES);
        expect(covers[7]).toHaveAttribute('sizes', `auto, ${SIZES}`);
    });
});
