import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { CompletionTimes } from '@/components/CompletionTimes';
import { MIN_PLAYTHROUGH_SAMPLES } from '@/lib/score';
import type { TimeToBeatDto } from '@/types/game';
import type { CommunityTimeBucket, CommunityTimes } from '@/types/playthrough';

/** IGDB's figures are in seconds; ours are in minutes. Both round the same way. */
const IGDB: TimeToBeatDto = {
    hastily: 45 * 3600,
    normally: 119 * 3600,
    completely: 174 * 3600,
    count: 312,
};

function bucket(
    type: CommunityTimeBucket['type'],
    samples: number,
    medianMinutes: number | null,
): CommunityTimeBucket {
    return { type, samples, medianMinutes };
}

/** All three tiers, as the API always sends them. */
function communityTimes(...buckets: CommunityTimeBucket[]): CommunityTimes {
    return { buckets };
}

/** The component fetches its own community figures, so every test stubs that one endpoint. */
function stubCommunityFetch(times: CommunityTimes | null, ok = true) {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
        ok && times !== null
            ? new Response(JSON.stringify(times), { status: 200 })
            : new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** A fetch that rejects, which is what an unreachable API does — not a bad response. */
function stubUnreachableApi() {
    const fetchMock = vi.fn(() => Promise.reject(new Error('Network down')));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** The row for one source, found by its own heading. */
function row(title: string): HTMLElement {
    return screen.getByRole('heading', { name: title }).parentElement as HTMLElement;
}

/**
 * Waits for the component's own fetch to land before asserting.
 *
 * Without this a synchronous assertion races it and React reports a state update outside
 * `act(...)` — a warning that goes on to mask real ones.
 */
async function settled() {
    await act(async () => {});
}

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe('CompletionTimes with IGDB figures only', () => {
    it("shows IGDB's three tiers", async () => {
        stubCommunityFetch(communityTimes());
        render(<CompletionTimes timeToBeat={IGDB} gameId={1} />);
        await settled();

        const igdb = row('IGDB community');
        expect(within(igdb).getByText('45h')).toBeInTheDocument();
        expect(within(igdb).getByText('119h')).toBeInTheDocument();
        expect(within(igdb).getByText('174h')).toBeInTheDocument();
    });

    it('says how many submissions back them', async () => {
        // ADR 0016: these averages frequently rest on single digits, so the count is never off
        // screen.
        stubCommunityFetch(communityTimes());
        render(<CompletionTimes timeToBeat={IGDB} gameId={1} />);
        await settled();

        expect(screen.getByText(/averaged from 312 community submissions/i)).toBeInTheDocument();
    });

    it('shows no members row when nobody has logged anything', async () => {
        stubCommunityFetch(communityTimes(
            bucket('rushed', 0, null),
            bucket('normally', 0, null),
            bucket('completionist', 0, null),
        ));
        render(<CompletionTimes timeToBeat={IGDB} gameId={1} />);
        await settled();

        expect(screen.queryByRole('heading', { name: 'MyVideoGameList members' }))
            .not.toBeInTheDocument();
    });
});

describe('CompletionTimes with both sources', () => {
    const POPULATED = communityTimes(
        bucket('rushed', 5, 51 * 60),
        bucket('normally', 8, 130 * 60),
        bucket('completionist', 4, 200 * 60),
    );

    it('renders one row per source', async () => {
        // The whole point of matching IGDB's tiers: two readable rows from two sources rather than
        // one blend of unclear provenance.
        stubCommunityFetch(POPULATED);
        render(<CompletionTimes timeToBeat={IGDB} gameId={1} />);

        await waitFor(() =>
            expect(screen.getByRole('heading', { name: 'MyVideoGameList members' })).toBeInTheDocument());
        expect(screen.getByRole('heading', { name: 'IGDB community' })).toBeInTheDocument();
    });

    it("shows members' medians in the same units as IGDB's averages", async () => {
        stubCommunityFetch(POPULATED);
        render(<CompletionTimes timeToBeat={IGDB} gameId={1} />);

        await waitFor(() => expect(screen.getByRole('heading', { name: 'MyVideoGameList members' })).toBeInTheDocument());
        const members = row('MyVideoGameList members');
        expect(within(members).getByText('51h')).toBeInTheDocument();
        expect(within(members).getByText('130h')).toBeInTheDocument();
        expect(within(members).getByText('200h')).toBeInTheDocument();
    });

    it('says how many playthroughs are behind each figure', async () => {
        stubCommunityFetch(POPULATED);
        render(<CompletionTimes timeToBeat={IGDB} gameId={1} />);

        await waitFor(() => expect(screen.getByText('From 8 playthroughs')).toBeInTheDocument());
    });

    it('keeps the same three columns in both rows', async () => {
        // They have to line up for the comparison to be readable at all, so a tier is never
        // dropped from one row and kept in the other.
        stubCommunityFetch(POPULATED);
        render(<CompletionTimes timeToBeat={IGDB} gameId={1} />);
        await waitFor(() => expect(screen.getByRole('heading', { name: 'MyVideoGameList members' })).toBeInTheDocument());

        for (const label of ['Rushed', 'Normally', 'Completionist']) {
            expect(within(row('IGDB community')).getByText(label)).toBeInTheDocument();
            expect(within(row('MyVideoGameList members')).getByText(label)).toBeInTheDocument();
        }
    });
});

describe('CompletionTimes sample-size floor', () => {
    it('shows a dash rather than a median for a tier below the floor', async () => {
        // A median over two members is exactly as uninformative as a critic score from one review.
        stubCommunityFetch(communityTimes(
            bucket('rushed', MIN_PLAYTHROUGH_SAMPLES - 1, 40 * 60),
            bucket('normally', 9, 130 * 60),
            bucket('completionist', 0, null),
        ));
        render(<CompletionTimes timeToBeat={IGDB} gameId={1} />);
        await waitFor(() => expect(screen.getByRole('heading', { name: 'MyVideoGameList members' })).toBeInTheDocument());

        const members = row('MyVideoGameList members');
        expect(within(members).queryByText('40h')).not.toBeInTheDocument();
        expect(within(members).getAllByText('—')).toHaveLength(2);
    });

    it('says how many there are and why there is no number', async () => {
        stubCommunityFetch(communityTimes(
            bucket('rushed', 2, 40 * 60),
            bucket('normally', 9, 130 * 60),
            bucket('completionist', 0, null),
        ));
        render(<CompletionTimes timeToBeat={IGDB} gameId={1} />);
        await waitFor(() => expect(screen.getByRole('heading', { name: 'MyVideoGameList members' })).toBeInTheDocument());

        expect(screen.getByText(/only 2 playthroughs so far — too few to average/i)).toBeInTheDocument();
        expect(screen.getByText(/nobody has logged one yet/i)).toBeInTheDocument();
    });

    it('hides the members row entirely when nothing clears the floor', async () => {
        // Three dashes saying "too few" three times is noise rather than information.
        stubCommunityFetch(communityTimes(
            bucket('rushed', 1, 40 * 60),
            bucket('normally', 2, 130 * 60),
            bucket('completionist', 0, null),
        ));
        render(<CompletionTimes timeToBeat={IGDB} gameId={1} />);
        await settled();

        expect(screen.queryByRole('heading', { name: 'MyVideoGameList members' }))
            .not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'IGDB community' })).toBeInTheDocument();
    });
});

describe('CompletionTimes without IGDB figures', () => {
    it('still shows the section when members have logged enough', async () => {
        // Plenty of games IGDB reports no completion times for have been played by members.
        stubCommunityFetch(communityTimes(
            bucket('rushed', 0, null),
            bucket('normally', 6, 90 * 60),
            bucket('completionist', 0, null),
        ));
        render(<CompletionTimes timeToBeat={null} gameId={1} />);

        await waitFor(() => expect(screen.getByRole('heading', { name: 'MyVideoGameList members' })).toBeInTheDocument());
        expect(screen.getByRole('heading', { name: 'How long to beat' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'IGDB community' })).not.toBeInTheDocument();
        expect(screen.getByText('90h')).toBeInTheDocument();
    });

    it('renders nothing at all when neither source has anything', async () => {
        stubCommunityFetch(communityTimes());
        const { container } = render(<CompletionTimes timeToBeat={null} gameId={1} />);
        await settled();

        expect(container).toBeEmptyDOMElement();
    });
});

describe('CompletionTimes when the community figures fail to load', () => {
    it('keeps the IGDB row and shows no error', async () => {
        // A community row that did not load is not worth an error banner on a page that rendered
        // perfectly well.
        stubCommunityFetch(null, false);
        render(<CompletionTimes timeToBeat={IGDB} gameId={1} />);
        await settled();

        expect(screen.getByRole('heading', { name: 'IGDB community' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'MyVideoGameList members' }))
            .not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('survives an unreachable API, which rejects rather than returning a bad response', async () => {
        stubUnreachableApi();
        render(<CompletionTimes timeToBeat={IGDB} gameId={1} />);
        await settled();

        expect(screen.getByRole('heading', { name: 'IGDB community' })).toBeInTheDocument();
    });

    it('renders nothing when IGDB has nothing either', async () => {
        stubUnreachableApi();
        const { container } = render(<CompletionTimes timeToBeat={null} gameId={1} />);
        await settled();

        expect(container).toBeEmptyDOMElement();
    });
});

describe('CompletionTimes fetching', () => {
    it('asks the public community-times endpoint for the game', async () => {
        const fetchMock = stubCommunityFetch(communityTimes());
        render(<CompletionTimes timeToBeat={IGDB} gameId={1942} />);
        await settled();

        expect(String(fetchMock.mock.calls[0][0])).toBe('/api/games/1942/community-times');
    });
});
