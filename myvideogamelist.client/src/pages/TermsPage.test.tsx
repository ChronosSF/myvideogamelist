import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import TermsPage, { headers, meta } from '@/pages/TermsPage';
import { CACHE_STATIC_PAGE } from '@/lib/cache';
import { DISCORD_INVITE_URL } from '@/lib/links';
import type { Route } from './+types/TermsPage';

const SITE = { siteUrl: 'https://myvideogamelist.net', indexable: true };

type Tag = Record<string, string>;

describe('TermsPage', () => {
    it('is one indexable page with its own canonical URL, cached at the edge', () => {
        const tags = meta({ loaderData: { site: SITE } } as unknown as Route.MetaArgs) as Tag[];

        expect(tags).toContainEqual({ title: 'Terms of use - MyVideoGameList' });
        expect(tags).toContainEqual({ tagName: 'link', rel: 'canonical', href: 'https://myvideogamelist.net/terms' });
        expect(headers()).toEqual({ 'Cache-Control': CACHE_STATIC_PAGE });
    });

    it('says how to keep a copy of your data, and where to ask', () => {
        const router = createMemoryRouter([{ path: '*', element: <TermsPage /> }]);
        render(<RouterProvider router={router} />);

        expect(screen.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Your data, and keeping a copy' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'your profile page' })).toHaveAttribute('href', '/user');
        expect(screen.getByRole('link', { name: 'our Discord server' })).toHaveAttribute('href', DISCORD_INVITE_URL);
    });
});
