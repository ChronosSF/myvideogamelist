import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ProfileStats } from '@/components/ProfileStats';
import { DEFAULT_SORT } from '@/lib/listSort';
import { emptyLists, type ListEntryDto, type ListId } from '@/types/list';
import type { PlatformDto } from '@/types/game';
import type { UserStats } from '@/types/stats';
import { entry, platform } from '@/test/factories';

/**
 * The lists context, mocked rather than provided: the real provider would fetch, and this component
 * uses it only as a source of already-loaded game metadata.
 *
 * One module-level object handed back every call, never a fresh literal — a new object per render
 * re-runs any effect that depends on it, which ends in a heap crash rather than a failed assertion.
 */
const listsValue = {
    lists: emptyLists() as Record<ListId, ListEntryDto[]>,
    loading: false,
    error: null as string | null,
    mutationError: null,
    isPending: () => false,
    addToList: vi.fn(async () => {}),
    removeFromList: vi.fn(async () => {}),
    isInList: () => false,
    getListFor: () => null,
    scoreFor: () => null,
    setScore: vi.fn(async () => true),
    deleteEntry: vi.fn(async () => {}),
    view: 'tiles' as const,
    setView: vi.fn(),
    sortFor: () => DEFAULT_SORT,
    setSort: vi.fn(),
};

vi.mock('@/hooks/useLists', () => ({ useLists: () => listsValue }));

/** A user with a bit of everything, which each test narrows to what it is about. */
function stats(overrides: Partial<UserStats> = {}): UserStats {
    return {
        library: {
            tracked: 12,
            recorded: 14,
            wishlisted: 3,
            byStatus: { backlog: 5, playing: 2, on_hold: 1, finished: 3, dropped: 1 },
            completionRate: 0.75,
        },
        scores: {
            scored: 4,
            mean: 8.25,
            distribution: [0, 0, 0, 0, 0, 1, 1, 1, 1, 0],
        },
        activity: {
            logStartedAt: '2026-04-02T09:00:00+00:00',
            months: [
                { month: '2026-04', started: 2, finished: 1, dropped: 0 },
                { month: '2026-05', started: 1, finished: 2, dropped: 1 },
                { month: '2026-06', started: 0, finished: 1, dropped: 0 },
            ],
            transitions: 17,
            currentStreakMonths: 3,
            longestStreakMonths: 3,
            timeToFinish: { samples: 3, medianHours: 84, longestHours: 240 },
        },
        playtime: {
            playthroughs: 0,
            totalMinutes: 0,
            withHours: 0,
            byPlatform: [],
        },
        ...overrides,
    };
}

/**
 * Answers the two endpoints this page may call and nothing else, so a stray fetch fails loudly.
 *
 * `platforms` is the fallback lookup the playtime breakdown reaches for when the loaded lists
 * cannot name an id: `null` makes it fail, which is a case with its own copy on screen.
 */
function stubFetch(
    response: UserStats | 'fail' | 'unreachable',
    platforms: PlatformDto[] | null = [],
) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/platforms/active') {
            return platforms === null
                ? new Response('nope', { status: 500 })
                : new Response(JSON.stringify(platforms), { status: 200 });
        }

        if (url !== '/api/user/stats') throw new Error(`unexpected fetch: ${url}`);
        if (response === 'unreachable') throw new TypeError('Failed to fetch');
        if (response === 'fail') return new Response('nope', { status: 500 });
        return new Response(JSON.stringify(response), { status: 200 });
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** Puts entries in the mocked lists context, which is where platform names come from first. */
function withLists(lists: Partial<Record<ListId, ListEntryDto[]>>) {
    listsValue.lists = { ...emptyLists(), ...lists } as Record<ListId, ListEntryDto[]>;
}

function renderStats() {
    return render(<MemoryRouter><ProfileStats userId="user-1" /></MemoryRouter>);
}

const settled = () =>
    waitFor(() => expect(screen.queryByText(/working out your numbers/i)).not.toBeInTheDocument());

beforeEach(() => {
    vi.unstubAllGlobals();
    listsValue.lists = emptyLists();
    listsValue.loading = false;
    listsValue.error = null;
});

describe('ProfileStats while loading and failing', () => {
    it('says it is working rather than rendering zeros', async () => {
        // Zeros during a fetch are a claim about the user that gets retracted a moment later.
        stubFetch(stats());
        renderStats();

        expect(screen.getByText(/working out your numbers/i)).toBeInTheDocument();
        await settled();
    });

    it('offers a retry when the request fails', async () => {
        const fetchMock = stubFetch('fail');
        renderStats();

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/failed to load your stats/i));

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reports an unreachable API rather than leaving the spinner up', async () => {
        // `fetch` rejects when nothing answers; only checking `response.ok` would hang here.
        stubFetch('unreachable');
        renderStats();

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    });
});

describe('ProfileStats with nothing recorded', () => {
    it('teaches instead of drawing an empty chart', async () => {
        stubFetch(stats({
            library: {
                tracked: 0,
                recorded: 0,
                wishlisted: 0,
                byStatus: { backlog: 0, playing: 0, on_hold: 0, finished: 0, dropped: 0 },
                completionRate: null,
            },
            scores: { scored: 0, mean: null, distribution: Array(10).fill(0) },
            activity: {
                logStartedAt: null,
                months: [],
                transitions: 0,
                currentStreakMonths: 0,
                longestStreakMonths: 0,
                timeToFinish: null,
            },
        }));
        renderStats();

        await waitFor(() => expect(screen.getByText(/nothing tracked yet/i)).toBeInTheDocument());
        expect(screen.getByRole('link', { name: 'Browse games' })).toBeInTheDocument();
        expect(screen.queryByText('completion rate')).not.toBeInTheDocument();
    });

    it('still shows the figures for somebody with only a wishlist', async () => {
        // Wishlisting is often the first thing a new user does, and it is not nothing.
        stubFetch(stats({
            library: {
                tracked: 0,
                recorded: 0,
                wishlisted: 2,
                byStatus: { backlog: 0, playing: 0, on_hold: 0, finished: 0, dropped: 0 },
                completionRate: null,
            },
            scores: { scored: 0, mean: null, distribution: Array(10).fill(0) },
            activity: {
                logStartedAt: null,
                months: [],
                transitions: 0,
                currentStreakMonths: 0,
                longestStreakMonths: 0,
                timeToFinish: null,
            },
        }));
        renderStats();

        await settled();

        expect(screen.queryByText(/nothing tracked yet/i)).not.toBeInTheDocument();
        expect(screen.getByText(/plus 2 on your wishlist/i)).toBeInTheDocument();
    });
});

describe('ProfileStats headline figures', () => {
    it('shows the counts and the rate', async () => {
        stubFetch(stats());
        renderStats();
        await settled();

        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('75%')).toBeInTheDocument();
        expect(screen.getByText(/14 recorded in all/)).toBeInTheDocument();
    });

    it('shows a dash and a reason where there is no rate, not a zero', async () => {
        // 0% would say the user finishes nothing. The truth is that nothing has resolved yet.
        stubFetch(stats({
            library: {
                tracked: 2,
                recorded: 2,
                wishlisted: 0,
                byStatus: { backlog: 1, playing: 1, on_hold: 0, finished: 0, dropped: 0 },
                completionRate: null,
            },
        }));
        renderStats();
        await settled();

        // Scoped to the tile: the hours tile shows a dash of its own when nothing is logged.
        const rate = screen.getByText('completion rate').closest('.profile-stat-tile') as HTMLElement;
        expect(within(rate).getByText('—')).toBeInTheDocument();
        expect(within(rate).getByText(/nothing finished or dropped yet/i)).toBeInTheDocument();
    });

    it('shows the mean score against the ten-point scale, never as a percentage', async () => {
        // A percentage in this app means a score averaged from other people (ADR 0021), and stars
        // are the input control. The user's own mean is neither.
        stubFetch(stats());
        renderStats();
        await settled();

        expect(screen.getByText('8.3')).toBeInTheDocument();
        expect(screen.getByText(/out of 10, over 4 games/i)).toBeInTheDocument();
        expect(screen.queryByText('83%')).not.toBeInTheDocument();
    });
});

describe('ProfileStats activity', () => {
    it('says when the log begins, so an absent month is not read as a quiet one', async () => {
        stubFetch(stats());
        renderStats();
        await settled();

        expect(screen.getByText(/17 changes recorded since 2 April 2026/i)).toBeInTheDocument();
        expect(screen.getByText(/months before that are not shown/i)).toBeInTheDocument();
    });

    it('labels every month with all three counts for assistive tech', async () => {
        stubFetch(stats());
        renderStats();
        await settled();

        expect(screen.getByText('2026-05: started 1, finished 2, dropped 1')).toBeInTheDocument();
    });

    it('reports the active time in words, with what it is based on', async () => {
        stubFetch(stats());
        renderStats();
        await settled();

        expect(screen.getByText('3.5 days')).toBeInTheDocument();
        expect(screen.getByText(/over 3 games/i)).toBeInTheDocument();
        expect(screen.getByText(/only the time a game spent in Playing/i)).toBeInTheDocument();
    });

    it('explains the absence when no finished game was ever played', async () => {
        stubFetch(stats({
            activity: { ...stats().activity, timeToFinish: null },
        }));
        renderStats();
        await settled();

        expect(screen.getByText(/mark it finished, and this measures/i)).toBeInTheDocument();
    });
});

describe('ProfileStats library breakdown', () => {
    it('counts platforms from the lists already loaded', async () => {
        // No second fetch for metadata: the lists context has it.
        listsValue.lists = {
            ...emptyLists(),
            playing: [entry({ game: { id: 1, platforms: [platform(6, 'PC')] } })],
            finished: [entry({ game: { id: 2, platforms: [platform(6, 'PC'), platform(167, 'PS5')] } })],
        };
        stubFetch(stats());
        renderStats();
        await settled();

        expect(screen.getByText('PC')).toBeInTheDocument();
        expect(screen.getByText('PS5')).toBeInTheDocument();
    });

    it('keeps every server-derived figure when the metadata fails to load', async () => {
        // The whole reason the page has two sources: an IGDB outage costs these two rows and
        // nothing above them.
        listsValue.error = 'Failed to load lists (502)';
        stubFetch(stats());
        renderStats();
        await settled();

        expect(screen.getByText(/needs game details, which failed to load/i)).toBeInTheDocument();
        expect(screen.getByText('75%')).toBeInTheDocument();
        expect(screen.getByText('3.5 days')).toBeInTheDocument();
    });
});

describe('ProfileStats hours logged', () => {
    it('says so when nothing has been logged, rather than printing a zero', async () => {
        stubFetch(stats());
        renderStats();

        await waitFor(() => expect(screen.getByText('hours logged')).toBeInTheDocument());
        expect(screen.getByText(/log a playthrough with its hours and this fills in/i))
            .toBeInTheDocument();
    });

    it('reports the total the user logged, over the runs that carried one', async () => {
        stubFetch(stats({
            playtime: {
                playthroughs: 4,
                totalMinutes: 60 * 96,
                withHours: 4,
                byPlatform: [{ platformId: 6, minutes: 60 * 96, playthroughs: 4 }],
            },
        }));
        renderStats();

        await waitFor(() => expect(screen.getByText('4 days')).toBeInTheDocument());
        expect(screen.getByText(/you logged, over 4 playthroughs/i)).toBeInTheDocument();
    });

    it('says how many playthroughs recorded no time at all', async () => {
        // The gap is what stops the total reading as though it covered every run.
        stubFetch(stats({
            playtime: {
                playthroughs: 5,
                totalMinutes: 600,
                withHours: 2,
                byPlatform: [{ platformId: 6, minutes: 600, playthroughs: 2 }],
            },
        }));
        renderStats();

        await waitFor(() =>
            expect(screen.getByText(/3 more recorded no time/i)).toBeInTheDocument());
    });
});

/** The "Most played on" section, so its rows are not confused with the game-count breakdown. */
function playedOnSection(): HTMLElement {
    return screen.getByRole('heading', { name: 'Most played on' }).parentElement as HTMLElement;
}

describe('ProfileStats most played on', () => {
    const PLAYED = stats({
        playtime: {
            playthroughs: 3,
            totalMinutes: 60 * 30,
            withHours: 3,
            byPlatform: [
                { platformId: 6, minutes: 60 * 20, playthroughs: 2 },
                { platformId: 48, minutes: 60 * 10, playthroughs: 1 },
            ],
        },
    });

    it('is absent when no playthrough named a platform', async () => {
        stubFetch(stats());
        renderStats();

        await waitFor(() => expect(screen.getByText('hours logged')).toBeInTheDocument());
        expect(screen.queryByRole('heading', { name: 'Most played on' })).not.toBeInTheDocument();
    });

    it('says "played" here, where hours back it', async () => {
        // The other platform row is about library composition and keeps its own wording — a
        // four-platform game counts towards all four there, and no hours are involved.
        withLists({ finished: [entry({ game: { id: 1, platforms: [platform(6, 'PC')] } })] });
        stubFetch(PLAYED);
        renderStats();

        await waitFor(() =>
            expect(screen.getByRole('heading', { name: 'Most played on' })).toBeInTheDocument());
        expect(screen.getByRole('heading', { name: 'Most of your games are on' })).toBeInTheDocument();
    });

    it('names platforms from the games already loaded', async () => {
        withLists({
            finished: [entry({ game: { id: 1, platforms: [platform(6, 'PC'), platform(48, 'PlayStation 4')] } })],
        });
        stubFetch(PLAYED);
        renderStats();

        // Scoped to this section: the same platform names appear in "Most of your games are on"
        // below, which counts games rather than hours.
        await waitFor(() =>
            expect(screen.getByRole('heading', { name: 'Most played on' })).toBeInTheDocument());
        const played = within(playedOnSection());
        expect(played.getByText('PC')).toBeInTheDocument();
        expect(played.getByText('PlayStation 4')).toBeInTheDocument();
        expect(played.getByText('20 hours')).toBeInTheDocument();
        expect(played.getByText('10 hours')).toBeInTheDocument();
    });

    it('falls back to the active platform list for an id the lists cannot name', async () => {
        // Usually a game the user has since deleted: the hours are still theirs.
        withLists({ finished: [entry({ game: { id: 1, platforms: [platform(6, 'PC')] } })] });
        stubFetch(PLAYED, [platform(48, 'PlayStation 4')]);
        renderStats();

        await waitFor(() => expect(screen.getByText('PlayStation 4')).toBeInTheDocument());
    });

    it('prints the id when neither source can name it, and says why', async () => {
        withLists({ finished: [entry({ game: { id: 1, platforms: [platform(6, 'PC')] } })] });
        stubFetch(PLAYED, null);
        renderStats();

        await waitFor(() => expect(screen.getByText('Platform #48')).toBeInTheDocument());
        expect(screen.getByText(/some platform names could not be loaded/i)).toBeInTheDocument();

        // The hours are from our own tables and stand whatever IGDB did.
        expect(screen.getByText('10 hours')).toBeInTheDocument();
    });

    it('asks for the active platform list only when something is unnamed', async () => {
        const fetchMock = stubFetch(PLAYED);
        withLists({
            finished: [entry({ game: { id: 1, platforms: [platform(6, 'PC'), platform(48, 'PS4')] } })],
        });
        renderStats();

        await waitFor(() =>
            expect(screen.getByRole('heading', { name: 'Most played on' })).toBeInTheDocument());
        expect(within(playedOnSection()).getByText('PC')).toBeInTheDocument();
        expect(fetchMock.mock.calls.map(call => String(call[0])))
            .not.toContain('/api/platforms/active');
    });
});
