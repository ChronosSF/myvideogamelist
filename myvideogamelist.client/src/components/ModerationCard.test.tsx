import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ModerationCard } from '@/components/ModerationCard';
import { useModerationAdmin } from '@/hooks/useModerationAdmin';
import { empty, expectSentThroughApiFetch, json, stubApi, tearDownApi, type ApiRoutes } from '@/test/api';
import type { HiddenReview, ModerationQueue, ReportedProfile, ReportedReview } from '@/types/moderation';

function reportedReview(overrides: Partial<ReportedReview> = {}): ReportedReview {
    return {
        reviewId: 7,
        userName: 'alex',
        displayName: null,
        gameId: 1942,
        gameTitle: 'Halo',
        body: 'Buy gold at example.test',
        hasSpoilers: false,
        published: true,
        reports: [
            { reason: 'spam', note: null, reportedAt: '2026-11-01T12:00:00Z' },
            { reason: 'abuse', note: 'And rude with it.', reportedAt: '2026-11-02T09:00:00Z' },
        ],
        ...overrides,
    };
}

function reportedProfile(overrides: Partial<ReportedProfile> = {}): ReportedProfile {
    return {
        accountId: 'acc-sam',
        userName: 'sam',
        displayName: 'Support',
        avatarUrl: null,
        bio: 'Official help desk.',
        published: true,
        reports: [{ reason: 'impersonation', note: null, reportedAt: '2026-11-01T12:00:00Z' }],
        ...overrides,
    };
}

function hiddenReview(overrides: Partial<HiddenReview> = {}): HiddenReview {
    return {
        reviewId: 3,
        userName: 'nadia',
        gameId: 7,
        gameTitle: null,
        body: 'Hidden words.',
        hasSpoilers: false,
        hiddenAt: '2026-10-30T12:00:00Z',
        ...overrides,
    };
}

function queue(overrides: Partial<ModerationQueue> = {}): ModerationQueue {
    const reviews = overrides.reviews ?? [];
    const profiles = overrides.profiles ?? [];
    const hidden = overrides.hidden ?? [];
    return {
        reviews,
        reviewsTotal: reviews.length,
        profiles,
        profilesTotal: profiles.length,
        hidden,
        hiddenTotal: hidden.length,
        ...overrides,
    };
}

/** The card as the admin page mounts it, on the real hook. */
function Harness() {
    const moderation = useModerationAdmin('admin-1');
    return <ModerationCard moderation={moderation} />;
}

/** The queue answered from what the test hands in, then from `after` once anything has been written. */
function renderCard(first: ModerationQueue, routes: ApiRoutes = {}, after: ModerationQueue = queue()) {
    let written = false;
    const api = stubApi({
        'GET /api/admin/moderation': () => json(written ? after : first),
        ...Object.fromEntries(Object.entries(routes).map(([key, answer]) => [key, (call: Parameters<typeof answer>[0]) => {
            written = true;
            return answer(call);
        }])),
    });
    render(<MemoryRouter><Harness /></MemoryRouter>);
    return api;
}

afterEach(tearDownApi);

describe('ModerationCard', () => {
    it('shows a reported review as written, with each report and no reporter', async () => {
        renderCard(queue({ reviews: [reportedReview()] }));

        const item = (await screen.findByText('Buy gold at example.test')).closest('li')!;
        expect(within(item).getByRole('link', { name: 'Halo' })).toHaveAttribute('href', '/games/1942');
        expect(within(item).getByRole('link', { name: '@alex' })).toHaveAttribute('href', '/u/alex');
        expect(within(item).getByText(/2 reports/)).toBeInTheDocument();
        expect(within(item).getByText('Spam')).toBeInTheDocument();
        expect(within(item).getByText('Hateful, harassing or offensive')).toBeInTheDocument();
        expect(within(item).getByText('And rude with it.')).toBeInTheDocument();
    });

    it('hides a review through apiFetch, takes it off the list, and reads the queue again', async () => {
        const api = renderCard(
            queue({ reviews: [reportedReview()] }),
            { 'PUT /api/admin/moderation/reviews/7/hidden': () => empty(204) },
            queue({ hidden: [hiddenReview({ reviewId: 7, userName: 'alex', gameTitle: 'Halo', body: 'Buy gold at example.test' })] }),
        );

        await userEvent.click(await screen.findByRole('button', { name: "Hide @alex's review of Halo" }));

        expectSentThroughApiFetch(api.callsTo('PUT', '/api/admin/moderation/reviews/7/hidden')[0]);
        const hidden = await screen.findByRole('list', { name: 'Hidden reviews' });
        expect(within(hidden).getByRole('button', { name: "Show @alex's review of Halo again" })).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Reported' })).not.toBeInTheDocument();
        expect(screen.getByText(/nothing reported/i)).toBeInTheDocument();
    });

    it('says so when the review went before it could be hidden', async () => {
        renderCard(
            queue({ reviews: [reportedReview()] }),
            { 'PUT /api/admin/moderation/reviews/7/hidden': () => empty(404) },
            queue({ reviews: [reportedReview()] }),
        );

        await userEvent.click(await screen.findByRole('button', { name: "Hide @alex's review of Halo" }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/not there any more/i);
    });

    it('clears only the fields ticked, offering none that is empty', async () => {
        const api = renderCard(
            queue({ profiles: [reportedProfile()] }),
            { 'POST /api/admin/moderation/profiles/acc-sam/clear': () => empty(204) },
        );

        const clear = await screen.findByRole('button', { name: 'Clear' });
        expect(clear).toBeDisabled();
        expect(screen.getByRole('checkbox', { name: 'Picture' })).toBeDisabled();

        await userEvent.click(screen.getByRole('checkbox', { name: 'Display name' }));
        await userEvent.click(clear);

        const [call] = api.callsTo('POST', '/api/admin/moderation/profiles/acc-sam/clear');
        expectSentThroughApiFetch(call);
        expect(call.body).toEqual({ displayName: true, avatarUrl: false, bio: false });
        expect(await screen.findByText(/nothing reported/i)).toBeInTheDocument();
    });

    it('says when the owner saved their profile meanwhile, and clears nothing', async () => {
        renderCard(
            queue({ profiles: [reportedProfile()] }),
            { 'POST /api/admin/moderation/profiles/acc-sam/clear': () => empty(409) },
            queue({ profiles: [reportedProfile({ bio: 'Changed just now.' })] }),
        );

        await userEvent.click(await screen.findByRole('checkbox', { name: 'Bio' }));
        await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/saved their profile just now/i);
        expect(await screen.findByText('Changed just now.')).toBeInTheDocument();
    });

    it('dismisses the reports of a profile, changing nothing else', async () => {
        const api = renderCard(
            queue({ profiles: [reportedProfile()] }),
            { 'DELETE /api/admin/moderation/profiles/acc-sam/reports': () => empty(204) },
        );

        await userEvent.click(await screen.findByRole('button', { name: "Dismiss the reports of @sam's profile" }));

        expectSentThroughApiFetch(api.callsTo('DELETE', '/api/admin/moderation/profiles/acc-sam/reports')[0]);
        expect(await screen.findByText(/nothing reported/i)).toBeInTheDocument();
    });

    it('shows a hidden review again', async () => {
        const api = renderCard(
            queue({ hidden: [hiddenReview()] }),
            { 'DELETE /api/admin/moderation/reviews/3/hidden': () => empty(204) },
        );

        // A game the cache has nothing for is named by its id.
        await userEvent.click(await screen.findByRole('button', { name: "Show @nadia's review of Game 7 again" }));

        expectSentThroughApiFetch(api.callsTo('DELETE', '/api/admin/moderation/reviews/3/hidden')[0]);
        expect(await screen.findByText(/none hidden/i)).toBeInTheDocument();
    });

    it('says a reported review is not published any more when its author withdrew it', async () => {
        renderCard(queue({ reviews: [reportedReview({ published: false })] }));

        expect(await screen.findByText(/not published any more/i)).toBeInTheDocument();
    });

    it('says how many more wait beyond the page', async () => {
        renderCard(queue({ reviews: [reportedReview()], reviewsTotal: 51 }));

        expect(await screen.findByText(/showing 1 of 51/i)).toBeInTheDocument();
    });

    it('says so above what it kept when the queue cannot be read again after an act, and tries again', async () => {
        // What the act took off is right; what a failed re-read leaves out is not, so it is said rather
        // than shown as though it were the queue.
        let reads = 0;
        stubApi({
            'GET /api/admin/moderation': () => {
                reads++;
                if (reads === 1) return json(queue({ reviews: [reportedReview()] }));
                if (reads === 2) return empty(500);
                return json(queue({ hidden: [hiddenReview({ reviewId: 7, userName: 'alex', gameTitle: 'Halo' })] }));
            },
            'PUT /api/admin/moderation/reviews/7/hidden': () => empty(204),
        });
        render(<MemoryRouter><Harness /></MemoryRouter>);

        await userEvent.click(await screen.findByRole('button', { name: "Hide @alex's review of Halo" }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not be read again just now/i);
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('button', { name: "Show @alex's review of Halo again" })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('offers to try again when the reports cannot be read', async () => {
        stubApi({ 'GET /api/admin/moderation': () => empty(500) });
        render(<MemoryRouter><Harness /></MemoryRouter>);

        expect(await screen.findByText('The reports could not be loaded.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
});
