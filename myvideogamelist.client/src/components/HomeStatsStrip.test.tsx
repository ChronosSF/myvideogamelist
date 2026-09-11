import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HomeStatsStrip } from '@/components/HomeStatsStrip';
import type { UserStats } from '@/types/stats';

/** The current year, so the "this year" fixture does not go stale in January. */
const YEAR = new Date().getUTCFullYear();

function stats(overrides: Partial<UserStats> = {}): UserStats {
    return {
        library: {
            tracked: 12,
            recorded: 14,
            wishlisted: 2,
            byStatus: { backlog: 5, playing: 2, on_hold: 1, finished: 5, dropped: 1 },
            completionRate: 0.83,
        },
        scores: { scored: 4, mean: 8, distribution: [0, 0, 0, 0, 0, 0, 0, 4, 0, 0] },
        activity: {
            logStartedAt: `${YEAR - 1}-11-02T09:00:00+00:00`,
            months: [
                { month: `${YEAR - 1}-11`, started: 2, finished: 3, dropped: 0 },
                { month: `${YEAR - 1}-12`, started: 1, finished: 4, dropped: 0 },
                { month: `${YEAR}-01`, started: 3, finished: 2, dropped: 1 },
                { month: `${YEAR}-02`, started: 1, finished: 5, dropped: 0 },
            ],
            transitions: 22,
            currentStreakMonths: 2,
            longestStreakMonths: 4,
            timeToFinish: null,
        },
        playtime: { playthroughs: 6, totalMinutes: 600, withHours: 5, byPlatform: [] },
        ...overrides,
    };
}

function mockStats(body: UserStats | null, ok = true) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok,
        status: ok ? 200 : 500,
        json: async () => body,
    })));
}

beforeEach(() => mockStats(stats()));
afterEach(() => vi.unstubAllGlobals());

describe('HomeStatsStrip', () => {
    it('counts finishes in the current year only', async () => {
        // The API returns up to twelve months, which straddles a year boundary for most of the
        // year — summing them all would silently roll last year's finishes into this year's figure.
        render(<HomeStatsStrip userId="user-1" />);

        await waitFor(() => expect(screen.getByText('finished this year')).toBeInTheDocument());
        // 2 in January plus 5 in February; the two months of last year in the fixture are not
        // counted.
        expect(screen.getByText('7')).toBeInTheDocument();
    });

    it('shows the hours logged', async () => {
        render(<HomeStatsStrip userId="user-1" />);

        await waitFor(() => expect(screen.getByText('10 hours')).toBeInTheDocument());
    });

    it('shows a dash rather than a zero when nothing has hours on it', async () => {
        // Nobody has logged zero hours; they have logged nothing, and the two read very
        // differently under a number.
        mockStats(stats({
            playtime: { playthroughs: 2, totalMinutes: 0, withHours: 0, byPlatform: [] },
        }));
        render(<HomeStatsStrip userId="user-1" />);

        await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument());
    });

    it('shows the current streak', async () => {
        render(<HomeStatsStrip userId="user-1" />);

        await waitFor(() =>
            expect(screen.getByText('month finishing streak')).toBeInTheDocument());
    });
});

describe('HomeStatsStrip when there is nothing to show', () => {
    it('renders nothing for an account that has recorded nothing', async () => {
        // Three zeroes would be a scoreboard of failure on somebody's first visit.
        mockStats(stats({
            library: {
                tracked: 0,
                recorded: 0,
                wishlisted: 0,
                byStatus: { backlog: 0, playing: 0, on_hold: 0, finished: 0, dropped: 0 },
                completionRate: null,
            },
            activity: {
                logStartedAt: null,
                months: [],
                transitions: 0,
                currentStreakMonths: 0,
                longestStreakMonths: 0,
                timeToFinish: null,
            },
        }));

        const { container } = render(<HomeStatsStrip userId="user-1" />);

        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });

    it('stays silent when the request fails', async () => {
        // This is encouragement above a page that works fine without it, so an error banner here
        // would be louder than the thing it is reporting. The profile page, where these figures
        // are the entire point, does say so.
        mockStats(null, false);

        const { container } = render(<HomeStatsStrip userId="user-1" />);

        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });
});
