import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { PublicReviewList } from '@/components/PublicReviewList';
import type { PublicReview, PublicReviews } from '@/types/profile';
import { game } from '@/test/factories';

function review(overrides: Partial<PublicReview> = {}): PublicReview {
    return {
        game: game({ id: 1, title: 'A Game' }),
        body: 'It was good.',
        hasSpoilers: false,
        score: null,
        createdAt: '2026-08-01T10:00:00+00:00',
        updatedAt: '2026-08-01T10:00:00+00:00',
        ...overrides,
    };
}

function page(overrides: Partial<PublicReviews> = {}): PublicReviews {
    return {
        userName: 'alex',
        reviews: [review()],
        total: 1,
        page: 1,
        pageSize: 20,
        ...overrides,
    };
}

function renderList(props: Partial<Parameters<typeof PublicReviewList>[0]> = {}) {
    return render(
        <MemoryRouter>
            <PublicReviewList userName="alex" reviews={page()} total={1} {...props} />
        </MemoryRouter>,
    );
}

describe('PublicReviewList', () => {
    it('shows the review and links it to the game', () => {
        renderList();

        expect(screen.getByText('It was good.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'A Game' }))
            .toHaveAttribute('href', '/games/1');
    });

    it("shows the author's own score out of ten, never as a percentage", () => {
        // A percentage in this app means a figure averaged from other people (ADR 0021), and this
        // is one person's own score on the scale they entered it.
        renderList({ reviews: page({ reviews: [review({ score: 9 })] }) });

        expect(screen.getByText('9/10')).toBeInTheDocument();
    });

    it('says the person has written none, in their name', () => {
        renderList({ reviews: page({ reviews: [], total: 0 }), total: 0 });

        expect(screen.getByText(/alex has not published any reviews yet/i))
            .toBeInTheDocument();
    });
});

describe('PublicReviewList spoilers', () => {
    it('hides a spoiler review behind a control until it is asked for', async () => {
        const user = userEvent.setup();
        renderList({
            reviews: page({ reviews: [review({ hasSpoilers: true, body: 'The dog dies.' })] }),
        });

        // Not merely visually obscured: the text must not be in the document at all, or it is one
        // text selection away from being read.
        expect(screen.queryByText('The dog dies.')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /spoilers/i }));

        expect(screen.getByText('The dog dies.')).toBeInTheDocument();
    });

    it('shows a review with no spoiler flag straight away', () => {
        renderList();

        expect(screen.queryByRole('button', { name: /spoilers/i })).not.toBeInTheDocument();
    });
});

describe('PublicReviewList when the reviews could not be loaded', () => {
    it('says so rather than claiming the person has written none', () => {
        // The figures above this list come from our own tables and are fine; only the game titles
        // need IGDB. "No reviews" here would be a claim about the person rather than a report
        // about an outage.
        renderList({ reviews: null, total: 4 });

        expect(screen.getByText(/has written 4 reviews/i)).toBeInTheDocument();
        expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
        expect(screen.getByText(/everything above is unaffected/i)).toBeInTheDocument();
    });

    it('still says nothing when there were none to load', () => {
        renderList({ reviews: null, total: 0 });

        expect(screen.getByText(/has not published any reviews yet/i)).toBeInTheDocument();
    });
});

describe('PublicReviewList counts', () => {
    it('says which slice of the total is on screen', () => {
        // A full page — pageSize matches what came back — so nothing was dropped and the caption
        // is purely about there being more.
        renderList({
            reviews: page({
                reviews: [review(), review({ game: game({ id: 2, title: 'Another' }) })],
                total: 30,
                pageSize: 2,
            }),
            total: 30,
        });

        expect(screen.getByText(/showing the 2 most recent of 30/i)).toBeInTheDocument();
    });

    it('explains a short page rather than letting the numbers disagree', () => {
        // A review whose game IGDB no longer returns is dropped from the page but still counted in
        // the total, so the two figures differ by design. Unexplained, that reads as a bug.
        renderList({
            reviews: page({ reviews: [review()], total: 3, pageSize: 20 }),
            total: 3,
        });

        expect(screen.getByText(/some could not be matched to a game/i)).toBeInTheDocument();
    });

    it('says nothing about counts when the whole set is on screen', () => {
        renderList();

        expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();
    });
});
