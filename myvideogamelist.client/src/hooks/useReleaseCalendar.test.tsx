import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useReleaseCalendar } from '@/hooks/useReleaseCalendar';
import { calendarEvents, connectedRelease, releaseEntry } from '@/test/factories';
import type { CalendarEvents, ReleaseEntry, UndatedEntry } from '@/types/releases';

// The month the reader is in and the twelve after it.
const WINDOW = 'from=2026-10-01&to=2027-11-01';

type Answer<T> = T | 'fail' | 'unreachable';

/** Answers the calendar's three reads from a script, and fails the test on anything else. */
function stubApi(releases: Answer<ReleaseEntry[]>, events: Answer<CalendarEvents>, undated: Answer<UndatedEntry[]>) {
    const answer = (value: Answer<unknown>) => {
        if (value === 'unreachable') return Promise.reject(new TypeError('Failed to fetch'));
        if (value === 'fail') return Promise.resolve(new Response('{}', { status: 502 }));
        return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
    };

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === `/api/user/releases?${WINDOW}&precision=any`) return answer(releases);
        if (url === `/api/calendar/events?${WINDOW}`) return answer(events);
        if (url === '/api/user/releases/undated') return answer(undated);
        throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function Probe({ account }: { account: string | null }) {
    const { today, releases, events, undated } = useReleaseCalendar(account);

    return (
        <div>
            <button type="button" onClick={releases.reload}>Ask for the releases again</button>
            <span data-testid="today">{today}</span>
            <span data-testid="releases">
                {releases.loading ? 'loading' : releases.error ?? releases.data?.map(e => e.releases[0].title).join(',')}
            </span>
            <span data-testid="events">
                {events.loading ? 'loading' : events.error ?? events.data?.curated.map(e => e.name).join(',')}
            </span>
            <span data-testid="undated">
                {undated.loading ? 'loading' : undated.error ?? undated.data?.map(e => e.releases[0].title).join(',')}
            </span>
        </div>
    );
}

const LAUFEY = { ...releaseEntry('2027-02-16', [connectedRelease({ gameId: 389000, title: 'God of War Laufey' })]) };
const ERDTREE = { ...releaseEntry('2026-01-01', [connectedRelease({ gameId: 252000, title: 'Shadow of the Erdtree' })]), precision: 'year' as const };
const ELDER_SCROLLS_VI: UndatedEntry = { groupName: null, releases: [connectedRelease({ gameId: 81249, title: 'The Elder Scrolls VI' })] };

const SALE = calendarEvents({
    curated: [{
        id: 1, kind: 'sale', store: 'steam', name: 'Steam Autumn Sale',
        startsOn: '2026-10-01', endsOn: '2026-10-15', url: 'https://partner.steamgames.com/',
    }],
});

beforeEach(() => {
    // The calendar opens on the reader's own month, so the clock is pinned to a known day.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 8, 12));
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('useReleaseCalendar', () => {
    it('asks for the whole year at once, every precision, beside its events and what has no date', async () => {
        const fetchMock = stubApi([LAUFEY, ERDTREE], SALE, [ELDER_SCROLLS_VI]);

        render(<Probe account="user-1" />);

        await waitFor(() => expect(screen.getByTestId('releases')).toHaveTextContent('God of War Laufey,Shadow of the Erdtree'));
        await waitFor(() => expect(screen.getByTestId('undated')).toHaveTextContent('The Elder Scrolls VI'));
        expect(screen.getByTestId('events')).toHaveTextContent('Steam Autumn Sale');
        expect(screen.getByTestId('today')).toHaveTextContent('2026-10-08');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('asks for nothing with nobody signed in', () => {
        const fetchMock = stubApi([], calendarEvents(), []);

        render(<Probe account={null} />);

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps the sales and what has no date when the releases fail, and asks again when told to', async () => {
        stubApi('fail', SALE, [ELDER_SCROLLS_VI]);

        render(<Probe account="user-1" />);

        await waitFor(() => expect(screen.getByTestId('releases')).toHaveTextContent('could not be loaded (502)'));
        expect(screen.getByTestId('events')).toHaveTextContent('Steam Autumn Sale');
        await waitFor(() => expect(screen.getByTestId('undated')).toHaveTextContent('The Elder Scrolls VI'));

        const again = stubApi([LAUFEY], SALE, [ELDER_SCROLLS_VI]);
        fireEvent.click(screen.getByRole('button', { name: 'Ask for the releases again' }));

        await waitFor(() => expect(screen.getByTestId('releases')).toHaveTextContent('God of War Laufey'));
        // Only the read that failed is asked again.
        expect(again).toHaveBeenCalledTimes(1);
    });

    it('keeps the releases when what has no date cannot be reached', async () => {
        stubApi([LAUFEY], SALE, 'unreachable');

        render(<Probe account="user-1" />);

        await waitFor(() => expect(screen.getByTestId('undated')).toHaveTextContent('Failed to fetch'));
        expect(screen.getByTestId('releases')).toHaveTextContent('God of War Laufey');
    });

    it("drops one account's calendar the moment another signs in", async () => {
        stubApi([LAUFEY], SALE, [ELDER_SCROLLS_VI]);
        const { rerender } = render(<Probe account="user-1" />);
        await waitFor(() => expect(screen.getByTestId('undated')).toHaveTextContent('The Elder Scrolls VI'));

        rerender(<Probe account="user-2" />);

        // Cleared on the transition, before the second account's answers have arrived.
        expect(screen.getByTestId('releases')).toHaveTextContent('loading');
        expect(screen.getByTestId('undated')).toHaveTextContent('loading');
        await waitFor(() => expect(screen.getByTestId('releases')).toHaveTextContent('God of War Laufey'));
    });
});
