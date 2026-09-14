import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { GameCommunity } from '@/components/GameCommunity';
import type { UseGameCommunityResult } from '@/hooks/useGameCommunity';
import { MIN_MEMBER_SCORES } from '@/lib/score';
import type { CommunityScores, GameReview } from '@/types/community';

/** Enough members to clear the floor, averaging 8.4, most of them on an 8. */
const SCORED: CommunityScores = {
    scored: 23,
    mean: 8.4,
    distribution: [0, 0, 0, 0, 1, 2, 3, 9, 5, 3],
};

const NOBODY: CommunityScores = { scored: 0, mean: null, distribution: Array<number>(10).fill(0) };

function review(overrides: Partial<GameReview> = {}): GameReview {
    return {
        userName: 'alex',
        body: 'The best side quests in the genre.',
        hasSpoilers: false,
        score: null,
        createdAt: '2026-09-01T10:00:00+00:00',
        updatedAt: '2026-09-01T10:00:00+00:00',
        ...overrides,
    };
}

/**
 * The hook's answer, settled unless a test says otherwise. The component is handed this rather than
 * fetching, because the page shares one fetch between it and the hero — so what is under test here
 * is what it does with each shape of answer, and the fetching has a suite of its own.
 */
function community(overrides: Partial<UseGameCommunityResult> = {}): UseGameCommunityResult {
    return {
        settled: true,
        scores: SCORED,
        reviews: [],
        total: 0,
        hasMore: false,
        loadingMore: false,
        moreFailed: false,
        loadMore: vi.fn(),
        ...overrides,
    };
}

function renderSection(value: UseGameCommunityResult, viewer: string | null = null) {
    return render(
        <MemoryRouter>
            <GameCommunity community={value} viewer={viewer} />
        </MemoryRouter>,
    );
}

const heading = () => screen.queryByRole('heading', { name: 'Member scores & reviews' });

describe('GameCommunity when there is nothing to show', () => {
    it('renders nothing until both requests have answered', () => {
        // Every server render is in this state, and so is the first client render.
        const { container } = renderSection(community({ settled: false }));

        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for a game nobody has scored or reviewed', () => {
        const { container } = renderSection(community({ scores: NOBODY, total: 0 }));

        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when a few members have scored it and nobody has written anything', () => {
        // A section whose only content is "too few to show" is noise rather than information.
        const { container } = renderSection(community({
            scores: { ...SCORED, scored: MIN_MEMBER_SCORES - 1 },
            total: 0,
        }));

        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing, and raises no alert, when both requests failed', () => {
        // A community section that did not load is not worth an error banner on a page that
        // rendered perfectly well.
        const { container } = renderSection(community({ scores: null, total: null }));

        expect(container).toBeEmptyDOMElement();
    });
});

describe("GameCommunity members' score", () => {
    it('shows the score out of 100, in the badge every aggregate wears, with its count', () => {
        // An average of other people, so a percentage and never stars (ADR 0021).
        renderSection(community());

        expect(heading()).toBeInTheDocument();
        expect(screen.getByText('Member score: 84 out of 100, from 23 scores')).toBeInTheDocument();
        expect(screen.getByText('from 23 scores')).toBeInTheDocument();
    });

    it('draws how the scores spread, column by column, counting members', () => {
        renderSection(community());

        const columns = screen.getByRole('list', { name: 'Member scores, from 1 to 10' });
        expect(within(columns).getAllByRole('listitem')).toHaveLength(10);
        expect(within(columns).getByText('8 out of 10: 9 members')).toBeInTheDocument();
        expect(within(columns).getByText('5 out of 10: 1 member')).toBeInTheDocument();
    });

    it('shows neither a number nor a distribution below the floor, only how many there are', () => {
        // The section is here for the review; the score is not ready to be one.
        renderSection(community({
            scores: { scored: 2, mean: 9, distribution: [0, 0, 0, 0, 0, 0, 0, 0, 2, 0] },
            reviews: [review()],
            total: 1,
        }));

        expect(screen.queryByText(/^Member score:/)).not.toBeInTheDocument();
        expect(screen.queryByRole('list', { name: /member scores/i })).not.toBeInTheDocument();
        expect(screen.getByText(/only 2 members have scored this so far/i)).toBeInTheDocument();
        expect(screen.getByText(new RegExp(`shown once ${MIN_MEMBER_SCORES} have`))).toBeInTheDocument();
    });

    it('says nothing about scores when nobody has scored the game but somebody reviewed it', () => {
        renderSection(community({ scores: NOBODY, reviews: [review()], total: 1 }));

        expect(heading()).toBeInTheDocument();
        expect(screen.queryByText(/scored this so far/i)).not.toBeInTheDocument();
    });
});

describe('GameCommunity reviews', () => {
    it("shows each review under its author's name, linked to their profile", () => {
        // Always linkable: only a review on a public profile is ever listed.
        renderSection(community({ reviews: [review({ userName: 'Nadia' })], total: 1 }));

        expect(screen.getByText('The best side quests in the genre.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Nadia' })).toHaveAttribute('href', '/u/Nadia');
    });

    it("shows the author's own score out of ten, never as a percentage", () => {
        renderSection(community({ reviews: [review({ score: 9 })], total: 1 }));

        expect(screen.getByText('9/10')).toBeInTheDocument();
    });

    it("marks the reader's own review as theirs, and nobody else's", () => {
        renderSection(
            community({ reviews: [review({ userName: 'alex' }), review({ userName: 'sam' })], total: 2 }),
            'alex',
        );

        const list = screen.getByRole('list', { name: 'Member reviews' });
        const [alex, sam] = within(list).getAllByRole('listitem');
        expect(within(alex).getByText('You')).toBeInTheDocument();
        expect(within(sam).queryByText('You')).not.toBeInTheDocument();
    });

    it('hides a spoiler review behind a control naming whose review it reveals', async () => {
        const user = userEvent.setup();
        renderSection(community({
            reviews: [review({ userName: 'sam', hasSpoilers: true, body: 'The dog dies.' })],
            total: 1,
        }));

        // Not merely obscured: the text is not in the document until it is asked for.
        expect(screen.queryByText('The dog dies.')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /show sam's review/i }));

        expect(screen.getByText('The dog dies.')).toBeInTheDocument();
    });

    it('says the reviews failed rather than implying there are none, when the score loaded', () => {
        renderSection(community({ total: null }));

        expect(screen.getByText('Reviews could not be loaded just now.')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('GameCommunity more reviews', () => {
    const TEN = Array.from({ length: 10 }, (_, i) => review({ userName: `member${i}` }));

    it('offers the next page, and says how much of the total is on screen', async () => {
        const loadMore = vi.fn();
        renderSection(community({ reviews: TEN, total: 12, hasMore: true, loadMore }));

        expect(screen.getByText('Showing 10 of 12.')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Show more reviews' }));

        expect(loadMore).toHaveBeenCalledTimes(1);
    });

    it('offers nothing further once every page is loaded', () => {
        renderSection(community({ reviews: TEN, total: 10, hasMore: false }));

        expect(screen.queryByRole('button', { name: /show more reviews/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    });

    it('holds the button while a page is on its way', () => {
        renderSection(community({ reviews: TEN, total: 12, hasMore: true, loadingMore: true }));

        expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
    });

    it('says when a page failed, beside the button that tries again', () => {
        renderSection(community({ reviews: TEN, total: 12, hasMore: true, moreFailed: true }));

        expect(screen.getByRole('alert')).toHaveTextContent(/could not load more reviews/i);
        expect(screen.getByRole('button', { name: 'Show more reviews' })).toBeEnabled();
    });
});
