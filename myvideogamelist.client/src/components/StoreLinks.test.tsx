import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StoreLinks } from '@/components/StoreLinks';
import type { StoreLinkDto } from '@/types/game';

/** Celeste's, as the API gives them for its page: in the API's order, which is the page's. */
const CELESTE_STORES: StoreLinkDto[] = [
    { store: 'Steam', url: 'https://store.steampowered.com/app/504230' },
    { store: 'Nintendo eShop', url: 'https://www.nintendo.com/games/detail/celeste-switch/' },
    { store: 'itch.io', url: 'https://mattmakesgames.itch.io/celeste' },
];

describe('StoreLinks', () => {
    it('lists a link to each store under its heading, in the order it was given', () => {
        render(<StoreLinks stores={CELESTE_STORES} />);

        const row = screen.getByRole('list', { name: 'Where to play' });
        const links = within(row).getAllByRole('link');

        expect(links.map(link => link.getAttribute('href'))).toEqual(CELESTE_STORES.map(store => store.url));
    });

    it("names each link for its store, and says that it leaves for a new tab", () => {
        render(<StoreLinks stores={CELESTE_STORES} />);

        expect(screen.getByRole('link', { name: 'Steam (opens in a new tab)' }))
            .toHaveAttribute('href', 'https://store.steampowered.com/app/504230');
        expect(screen.getByRole('link', { name: 'Nintendo eShop (opens in a new tab)' }))
            .toHaveAttribute('href', 'https://www.nintendo.com/games/detail/celeste-switch/');
    });

    it('opens each store in a new tab that cannot reach back and is sent no referrer, as every link out does', () => {
        render(<StoreLinks stores={CELESTE_STORES} />);

        for (const link of screen.getAllByRole('link')) {
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        }
    });

    it('never marks a store link nofollow, because Steam forbids it on a page showing its news', () => {
        render(<StoreLinks stores={CELESTE_STORES} />);

        for (const link of screen.getAllByRole('link')) expect(link.getAttribute('rel')).not.toMatch(/nofollow/);
    });

    it('renders nothing when IGDB names no store, rather than a heading over an empty row', () => {
        const { container } = render(<StoreLinks stores={[]} />);

        expect(container).toBeEmptyDOMElement();
    });
});
