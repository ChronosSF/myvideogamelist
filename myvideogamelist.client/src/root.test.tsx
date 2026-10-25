import { useContext, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider, UNSAFE_ErrorResponseImpl } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SearchPacerContext } from '@/contexts/SearchPacerContext';
import Root, { ErrorBoundary } from '@/root';
import type { Route } from './+types/root';

/** The pacer each part of the page found, by name: the navbar's, and a page's. */
const pacers = vi.hoisted(() => new Map<string, unknown>());

// Every provider stands aside, since each of the real ones fetches, and the navbar is a probe for
// the pacer it would search with.
vi.mock('@/contexts/AuthProvider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/contexts/ListsProvider', () => ({ ListsProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/contexts/WishlistProvider', () => ({ WishlistProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/contexts/FavouritesProvider', () => ({ FavouritesProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/contexts/TagsProvider', () => ({ TagsProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/Navbar', async () => {
    const { useContext: read } = await import('react');
    const { SearchPacerContext: context } = await import('@/contexts/SearchPacerContext');
    return {
        Navbar: () => {
            pacers.set('navbar', read(context));
            return null;
        },
    };
});

function Page() {
    pacers.set('page', useContext(SearchPacerContext));
    return <p>A page</p>;
}

/**
 * The page every failure lands on, over each shape of error it is given: what a loader throws when
 * the API failed it, a plain-text Response, an empty one, something else entirely, and an exception.
 * The reference is shown for the first and for nothing else.
 */
function renderBoundary(error: unknown) {
    const props = { error, params: {} } as unknown as Route.ErrorBoundaryProps;
    render(<MemoryRouter><ErrorBoundary {...props} /></MemoryRouter>);
}

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

const reference = () => screen.queryByText(/If you report this/);

describe('the error page', () => {
    it('asks a reader to quote the id of a failure the API caused', () => {
        renderBoundary(new UNSAFE_ErrorResponseImpl(502, 'Bad Gateway', {
            message: 'Failed to load game.',
            traceId: TRACE_ID,
        }));

        expect(screen.getByRole('heading', { level: 1, name: '502 Bad Gateway' })).toBeInTheDocument();
        expect(screen.getByText('Failed to load game.')).toBeInTheDocument();
        expect(reference()).toHaveTextContent(`If you report this, quote ${TRACE_ID}.`);
    });

    it('shows no reference for a page that does not exist', () => {
        renderBoundary(new UNSAFE_ErrorResponseImpl(404, 'Not Found', 'Not Found'));

        expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
        expect(screen.getByText("We couldn't find the page you were looking for.")).toBeInTheDocument();
        expect(reference()).not.toBeInTheDocument();
    });

    it('shows the sentence a plain-text failure carries, with no reference', () => {
        renderBoundary(new UNSAFE_ErrorResponseImpl(503, 'Service Unavailable', 'Browsing is busy.'));

        expect(screen.getByText('Browsing is busy.')).toBeInTheDocument();
        expect(reference()).not.toBeInTheDocument();
    });

    it.each([
        ['an empty body', ''],
        ['a body that is not a failure of ours', { title: 'Something else' }],
    ])('falls back to its own sentence for %s', (_, data) => {
        renderBoundary(new UNSAFE_ErrorResponseImpl(500, 'Internal Server Error', data));

        expect(screen.getByText('An unexpected error occurred. Please try again.')).toBeInTheDocument();
        expect(reference()).not.toBeInTheDocument();
    });

    it('shows no reference for an exception, which never says which request it was', () => {
        renderBoundary(new Error('Unexpected Server Error'));

        expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument();
        expect(reference()).not.toBeInTheDocument();
    });
});

describe('the root', () => {
    it('gives the navbar and every page one search pacer', async () => {
        // The navbar's typeahead and an import review's row searches keep to one budget only
        // because both sit under the root's provider. Each search keeps a pacer of its own outside
        // it, so a navbar moved out from under it would fail nothing else.
        const router = createMemoryRouter([{ path: '/', element: <Root />, children: [{ index: true, element: <Page /> }] }]);
        render(<RouterProvider router={router} />);

        expect(await screen.findByText('A page')).toBeInTheDocument();
        expect(pacers.get('navbar')).toBeTruthy();
        expect(pacers.get('page')).toBe(pacers.get('navbar'));
    });
});
