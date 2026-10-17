import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TrendingRail } from '@/components/TrendingRail';
import { game } from '@/test/factories';

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
