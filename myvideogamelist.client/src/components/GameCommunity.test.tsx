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

/** A picture on one of the avatar hosts, as the API carries it. */
const PICTURE = 'https://avatars.githubusercontent.com/u/9919?v=4';

function review(overrides: Partial<GameReview> = {}): GameReview {
    return {
        userName: 'alex',
        displayName: null,
        avatarUrl: null,
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
        reloading: false,
        loadMore: vi.fn(),
        reload: vi.fn(),
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

/**
 * The section's body: the box below the heading that holds whichever state it is in. Found through the
 * heading's section because jsdom lays nothing out, so its least height can only be read as a class.
 */
const body = () => heading()!.closest('section')!.children[1];

/** The body's least height, as the `min-h-*` class it carries. */
const leastHeight = () => [...body().classList].find(name => name.startsWith('min-h-'));

describe('GameCommunity before it has answered', () => {
    it('holds its place with a skeleton, and says in words what it is waiting for', () => {
        // Every server render is in this state, and so is the first client render.
        renderSection(community({ settled: false }));

        expect(heading()).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Loading member scores and reviews…');
        expect(body()).toContainElement(screen.getByRole('status'));
    });

    it('is as tall waiting as it is with nothing to show or after a failure, so neither moves the page', () => {
        // For most games the answer is "nothing yet", so the skeleton is that state's height. The
        // failure fits inside the same height at a phone's width; both were measured in a browser.
        const heights = [
            community({ settled: false }),
            community({ scores: NOBODY, total: 0 }),
            community({ scores: null, total: null }),
        ].map(state => {
            const { unmount } = renderSection(state);
            const height = leastHeight();
            unmount();
            return height;
        });

        expect(heights[0]).toBeDefined();
        expect(new Set(heights).size).toBe(1);
    });
});

/*
 * These replaced tests that pinned "renders nothing" for the cases below, which ADR 0028 §3 chose as
 * the quieter answer. ADR 0070 amends it: once the section holds its place with a skeleton, nothing
 * after it would be a blank where the skeleton was, which a reader cannot tell from a failure.
 */
describe('GameCommunity when there is nothing to show yet', () => {
    it('says what would put something here, for a game nobody has scored or reviewed', () => {
        renderSection(community({ scores: NOBODY, total: 0 }));

        expect(screen.getByText('No member score or reviews yet.')).toBeInTheDocument();
        expect(screen.getByText(
            `A member score is shown once ${MIN_MEMBER_SCORES} members have scored this. `
                + 'Reviews show here as members publish them.',
        )).toBeInTheDocument();
    });

    it('counts the members who have scored it, while there are too few for a score', () => {
        // Under the floor a score is a count and never a number (ADR 0016), and the count is part of
        // what tells the reader how far off one is.
        renderSection(community({ scores: { ...SCORED, scored: MIN_MEMBER_SCORES - 1 }, total: 0 }));

        expect(screen.getByText('No member score or reviews yet.')).toBeInTheDocument();
        expect(screen.getByText(
            `Only ${MIN_MEMBER_SCORES - 1} members have scored this so far. `
                + `A member score is shown once ${MIN_MEMBER_SCORES} have. Reviews show here as members publish them.`,
        )).toBeInTheDocument();
        expect(screen.queryByText(/^Member score:/)).not.toBeInTheDocument();
    });

    it('says there are no reviews yet beside a score that cleared the floor', () => {
        renderSection(community({ total: 0 }));

        expect(screen.getByText('Member score: 84 out of 100, from 23 scores')).toBeInTheDocument();
        expect(screen.getByText('No reviews yet. They show here as members publish them.')).toBeInTheDocument();
    });
});

describe('GameCommunity when it could not load', () => {
    it('says so and offers to ask again when both requests failed, without raising an alert', async () => {
        // An alert would interrupt a screen reader to announce a side section of a page that
        // rendered perfectly well. Silence, which this used to be, cannot be told from no reviews.
        const reload = vi.fn();
        renderSection(community({ scores: null, total: null, reload }));

        expect(screen.getByText('Member scores and reviews could not be loaded just now')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("moves focus to the section's heading when it asks again, since the button gives way", async () => {
        // The skeleton takes the failure's place, button and all; focus would otherwise fall to the
        // page's body halfway down a long page.
        renderSection(community({ scores: null, total: null }));

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(heading()).toHaveFocus();
    });

    it('offers to ask again when only the reviews failed', async () => {
        const reload = vi.fn();
        renderSection(community({ total: null, reload }));

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('says the member score failed rather than leaving a blank where it would be', async () => {
        // Silence there would read as nobody having scored the game.
        const reload = vi.fn();
        renderSection(community({ scores: null, total: 0, reload }));

        expect(screen.getByText('The member score could not be loaded just now.')).toBeInTheDocument();
        expect(screen.getByText('No reviews yet. They show here as members publish them.')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('says the member score failed above the reviews that did load', () => {
        renderSection(community({ scores: null, reviews: [review()], total: 1 }));

        expect(screen.getByText('The member score could not be loaded just now.')).toBeInTheDocument();
        expect(screen.getByText('The best side quests in the genre.')).toBeInTheDocument();
    });

    it('says it is trying again while a reload is out, and does not ask twice', async () => {
        const reload = vi.fn();
        renderSection(community({ total: null, reloading: true, reload }));

        const button = screen.getByRole('button', { name: 'Trying again…' });
        expect(button).toHaveAttribute('aria-disabled', 'true');

        await userEvent.click(button);
        expect(reload).not.toHaveBeenCalled();
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

    it('says the count to a screen reader once, not twice', () => {
        // The badge's accessible name already ends with the count, so the caption beside it is for
        // the eye; read out as well, it would repeat "from 23 scores" straight after itself.
        renderSection(community());

        expect(screen.getByText('from 23 scores')).toHaveAttribute('aria-hidden', 'true');
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

    it("puts the author's display name beside their handle, never in its place", () => {
        // As on the profile (ADR 0056): the handle is what says whose review it is. The name is in
        // a bdi, so one written right to left cannot reorder the handle after it.
        renderSection(community({ reviews: [review({ userName: 'Nadia', displayName: 'Nadia Ali' })], total: 1 }));

        const link = screen.getByRole('link', { name: 'Nadia Ali @Nadia' });
        expect(link).toHaveAttribute('href', '/u/Nadia');
        expect(link.querySelector('bdi')).toHaveTextContent(/^Nadia Ali$/);
    });

    it('names the handle alone when the API sends no display name', () => {
        // An API a release behind, during a rolling deploy, sends neither new field. Absent has to
        // read as unset, not as the word "undefined" beside the handle.
        renderSection(community({
            reviews: [review({ userName: 'Nadia', displayName: undefined, avatarUrl: undefined })],
            total: 1,
        }));

        expect(screen.getByRole('link', { name: 'Nadia' })).toBeInTheDocument();
        expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    });

    it("shows the author's picture, asked for as the profile asks for it", () => {
        // Through Avatar, so with no referrer and anonymously (ADR 0056). Found inside the card
        // rather than by a role: the picture is decorative, and the name beside it is what is read.
        renderSection(community({ reviews: [review({ avatarUrl: PICTURE })], total: 1 }));

        const image = within(screen.getByRole('list', { name: 'Member reviews' })).getByRole('listitem').querySelector('img');
        expect(image).toHaveAttribute('src', PICTURE);
        expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
        expect(image).toHaveAttribute('crossorigin', 'anonymous');
    });

    it("shows the handle's initial for an author with no picture", () => {
        renderSection(community({ reviews: [review({ userName: 'nadia' })], total: 1 }));

        const card = within(screen.getByRole('list', { name: 'Member reviews' })).getByRole('listitem');
        expect(card.querySelector('img')).toBeNull();
        expect(card.querySelector('.avatar')).toHaveTextContent(/^N$/);
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

    it('names the handle on the spoiler control, even beside a display name', () => {
        // The control's text is its whole accessible name, and a display name is anybody's to
        // choose: two "Sam"s could share one, never a handle.
        renderSection(community({
            reviews: [review({ userName: 'sam', displayName: 'Sam Rivera', hasSpoilers: true })],
            total: 1,
        }));

        expect(screen.getByRole('button', { name: /^Show sam's review/ })).toBeInTheDocument();
    });

    it('says the reviews failed rather than implying there are none, when the score loaded', () => {
        renderSection(community({ total: null }));

        expect(screen.getByText(/^Reviews could not be loaded just now\./)).toBeInTheDocument();
        expect(screen.queryByText(/no reviews yet/i)).not.toBeInTheDocument();
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

    it('holds the button while a page is on its way, without letting go of its focus', async () => {
        // aria-disabled rather than disabled: a disabled button drops the keyboard focus it holds.
        const loadMore = vi.fn();
        renderSection(community({ reviews: TEN, total: 12, hasMore: true, loadingMore: true, loadMore }));
        const button = screen.getByRole('button', { name: 'Loading…' });

        await userEvent.click(button);

        expect(button).toHaveAttribute('aria-disabled', 'true');
        expect(button).toHaveFocus();
        expect(loadMore).not.toHaveBeenCalled();
    });

    it('hands keyboard focus to the first review the page it asked for adds', async () => {
        const TWELVE = [...TEN, review({ userName: 'member10' }), review({ userName: 'member11' })];
        const view = renderSection(community({ reviews: TEN, total: 12, hasMore: true }));
        const rerender = (value: UseGameCommunityResult) =>
            view.rerender(<MemoryRouter><GameCommunity community={value} viewer={null} /></MemoryRouter>);

        await userEvent.click(screen.getByRole('button', { name: 'Show more reviews' }));
        rerender(community({ reviews: TEN, total: 12, hasMore: true, loadingMore: true }));
        // Enabled to the DOM as well as focused: jsdom keeps the focus of a button that turns disabled,
        // where a browser lets it go, so the focus alone would not show the button had stayed usable.
        expect(screen.getByRole('button', { name: 'Loading…' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Loading…' })).toHaveFocus();

        // The last page: the button goes, and focus with it unless something takes it first.
        rerender(community({ reviews: TWELVE, total: 12, hasMore: false }));

        const list = screen.getByRole('list', { name: 'Member reviews' });
        expect(within(list).getAllByRole('listitem')[10]).toHaveFocus();
    });

    it('hands keyboard focus to the last review when the last page adds nothing', async () => {
        // Its reviews withdrawn since the count was taken: the button goes all the same, and the last
        // review takes the focus rather than the body.
        const view = renderSection(community({ reviews: TEN, total: 12, hasMore: true }));
        const rerender = (value: UseGameCommunityResult) =>
            view.rerender(<MemoryRouter><GameCommunity community={value} viewer={null} /></MemoryRouter>);

        await userEvent.click(screen.getByRole('button', { name: 'Show more reviews' }));
        rerender(community({ reviews: TEN, total: 12, hasMore: true, loadingMore: true }));
        rerender(community({ reviews: TEN, total: 10, hasMore: false }));

        const list = screen.getByRole('list', { name: 'Member reviews' });
        expect(within(list).getAllByRole('listitem')[9]).toHaveFocus();
    });

    it('leaves keyboard focus where the reader put it, if they moved on while the page loaded', async () => {
        const TWELVE = [...TEN, review({ userName: 'member10' }), review({ userName: 'member11' })];
        const view = renderSection(community({ reviews: TEN, total: 12, hasMore: true }));
        const rerender = (value: UseGameCommunityResult) =>
            view.rerender(<MemoryRouter><GameCommunity community={value} viewer={null} /></MemoryRouter>);

        await userEvent.click(screen.getByRole('button', { name: 'Show more reviews' }));
        rerender(community({ reviews: TEN, total: 12, hasMore: true, loadingMore: true }));
        // Back to the last review's author, as a reader might while waiting; anywhere else would do.
        await userEvent.tab({ shift: true });
        expect(screen.getByRole('link', { name: 'member9' })).toHaveFocus();
        rerender(community({ reviews: TWELVE, total: 12, hasMore: false }));

        expect(screen.getByRole('link', { name: 'member9' })).toHaveFocus();
    });

    it('says when a page failed, beside the button that tries again', () => {
        renderSection(community({ reviews: TEN, total: 12, hasMore: true, moreFailed: true }));

        expect(screen.getByRole('alert')).toHaveTextContent(/could not load more reviews/i);
        expect(screen.getByRole('button', { name: 'Show more reviews' })).toHaveAttribute('aria-disabled', 'false');
    });

    it('leaves keyboard focus on the button when the page it asked for fails', async () => {
        // The page added nothing, and the button is still there to try again.
        const view = renderSection(community({ reviews: TEN, total: 12, hasMore: true }));
        const rerender = (value: UseGameCommunityResult) =>
            view.rerender(<MemoryRouter><GameCommunity community={value} viewer={null} /></MemoryRouter>);

        await userEvent.click(screen.getByRole('button', { name: 'Show more reviews' }));
        rerender(community({ reviews: TEN, total: 12, hasMore: true, loadingMore: true }));
        rerender(community({ reviews: TEN, total: 12, hasMore: true, moreFailed: true }));

        expect(screen.getByRole('button', { name: 'Show more reviews' })).toHaveFocus();
    });
});
