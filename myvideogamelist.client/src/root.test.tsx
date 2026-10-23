import { render, screen } from '@testing-library/react';
import { MemoryRouter, UNSAFE_ErrorResponseImpl } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ErrorBoundary } from '@/root';
import type { Route } from './+types/root';

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
