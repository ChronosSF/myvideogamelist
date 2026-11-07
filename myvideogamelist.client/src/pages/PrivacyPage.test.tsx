import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import PrivacyPage, { headers, meta } from '@/pages/PrivacyPage';
import { CACHE_STATIC_PAGE } from '@/lib/cache';
import { DISCORD_INVITE_URL } from '@/lib/links';
import type { Route } from './+types/PrivacyPage';

const SITE = { siteUrl: 'https://myvideogamelist.net', indexable: true };

type Tag = Record<string, string>;

function renderPage() {
    const router = createMemoryRouter([{ path: '*', element: <PrivacyPage /> }]);
    render(<RouterProvider router={router} />);
}

describe('PrivacyPage', () => {
    it('is one indexable page with its own canonical URL, cached at the edge', () => {
        const tags = meta({ loaderData: { site: SITE } } as unknown as Route.MetaArgs) as Tag[];

        expect(tags).toContainEqual({ title: 'Privacy policy - MyVideoGameList' });
        expect(tags).toContainEqual({ tagName: 'link', rel: 'canonical', href: 'https://myvideogamelist.net/privacy' });
        expect(headers()).toEqual({ 'Cache-Control': CACHE_STATIC_PAGE });
    });

    it('names the two cookies the site sets, by the names the server gives them', () => {
        renderPage();

        expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Cookies' })).toBeInTheDocument();
        // `SignedInFlag.CookieName` on the server, and Identity's own name for the session's.
        expect(screen.getByText('.AspNetCore.Identity.Application')).toBeInTheDocument();
        expect(screen.getByText('mvgl_signed_in')).toBeInTheDocument();
    });

    it('links the terms, the page that exports and deletes an account, and where to ask', () => {
        renderPage();

        expect(screen.getByRole('link', { name: 'terms of use' })).toHaveAttribute('href', '/terms');
        expect(screen.getByRole('heading', { name: 'Your rights' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'your profile page' })).toHaveAttribute('href', '/user');
        // The words that say it opens a new tab keep their space inside the hidden text, ahead of the
        // full stop, as on the terms page.
        expect(screen.getByRole('link', { name: /^our Discord server ?\(opens in a new tab\)$/ }))
            .toHaveAttribute('href', DISCORD_INVITE_URL);
    });
});
