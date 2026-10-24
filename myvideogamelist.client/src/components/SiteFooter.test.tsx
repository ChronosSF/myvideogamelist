import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { SiteFooter } from '@/components/SiteFooter';
import { DISCORD_INVITE_URL } from '@/lib/links';

function renderFooter() {
    const router = createMemoryRouter([{ path: '*', element: <SiteFooter /> }]);
    render(<RouterProvider router={router} />);
}

/**
 * A link out of the site, by its name and the words that say it opens a new tab. Those words keep
 * their space inside the hidden text, which Testing Library's name computation trims; and jsdom, which
 * does no layout, leaves the absolutely positioned text inline, so nothing separates it from the name,
 * where a browser lays it out as a box of its own and does.
 */
const outside = (name: string) => (accessibleName: string) =>
    accessibleName === `${name} (opens in a new tab)` || accessibleName === `${name}(opens in a new tab)`;

describe('SiteFooter', () => {
    it('credits IGDB and Steam, with links a crawler may follow', () => {
        renderFooter();

        const igdb = screen.getByRole('link', { name: outside('IGDB.com') });
        const steam = screen.getByRole('link', { name: outside('Steam') });
        expect(igdb).toHaveAttribute('href', 'https://www.igdb.com');
        expect(steam).toHaveAttribute('href', 'https://store.steampowered.com');
        // Steam's terms forbid a nofollow on a link to it.
        for (const link of [igdb, steam]) expect(link.getAttribute('rel')).not.toMatch(/nofollow/);
        expect(screen.getByText(/Not affiliated with or endorsed by Valve/)).toBeInTheDocument();
    });

    it('opens the Discord invite in a new tab, as every link out of the site opens', () => {
        renderFooter();

        const discord = screen.getByRole('link', { name: outside('Discord') });
        expect(discord).toHaveAttribute('href', DISCORD_INVITE_URL);
        expect(discord).toHaveAttribute('target', '_blank');
        expect(discord).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('links the pages of the site, the terms among them', () => {
        renderFooter();

        const footer = screen.getByRole('navigation', { name: 'Footer' });
        expect(footer).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Browse games' })).toHaveAttribute('href', '/games');
        expect(screen.getByRole('link', { name: 'Release calendar' })).toHaveAttribute('href', '/calendar');
        expect(screen.getByRole('link', { name: 'Game news' })).toHaveAttribute('href', '/news');
        expect(screen.getByRole('link', { name: 'Terms of use' })).toHaveAttribute('href', '/terms');
    });
});
