import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useReleaseLine } from '@/hooks/useReleaseLine';
import { calendarEvents, connectedRelease, releaseEntry } from '@/test/factories';
import type { CalendarEvents, ReleaseEntry } from '@/types/releases';

const WINDOW = 'from=2026-10-06&to=2026-10-20';

type Answer<T> = T | 'fail' | 'unreachable';

/** Answers the line's two reads from a script, and fails the test on anything else. */
function stubApi(releases: Answer<ReleaseEntry[]>, events: Answer<CalendarEvents>) {
    const answer = (value: Answer<unknown>) => {
        if (value === 'unreachable') return Promise.reject(new TypeError('Failed to fetch'));
        if (value === 'fail') return Promise.resolve(new Response('{}', { status: 502 }));
        return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
    };

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === `/api/user/releases?${WINDOW}`) return answer(releases);
        if (url === `/api/calendar/events?${WINDOW}`) return answer(events);
        throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function Probe({ account }: { account: string | null }) {
    const { today, releases, events } = useReleaseLine(account);
    return (
        <div>
            <span data-testid="today">{today}</span>
            <span data-testid="releases">
                {releases.loading ? 'loading' : releases.error ?? releases.data?.map(e => e.releases[0].title).join(',')}
            </span>
            <span data-testid="events">
                {events.loading ? 'loading' : events.error ?? events.data?.curated.map(e => e.name).join(',')}
            </span>
        </div>
    );
}

const RE2 = releaseEntry('2026-10-16', [connectedRelease({ gameId: 19686, title: 'Resident Evil 2' })]);

const SALE = calendarEvents({
    curated: [{
        id: 1, kind: 'sale', store: 'steam', name: 'Steam Autumn Sale',
        startsOn: '2026-10-01', endsOn: '2026-10-15', url: 'https://partner.steamgames.com/',
    }],
});

beforeEach(() => {
    // The line starts on the reader's own today, so the clock is pinned to a known day.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 6, 12));
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('useReleaseLine', () => {
    it('asks both endpoints about today and the thirteen days after it', async () => {
        const fetchMock = stubApi([RE2], SALE);

        render(<Probe account="user-1" />);

        await waitFor(() => expect(screen.getByTestId('releases')).toHaveTextContent('Resident Evil 2'));
        expect(screen.getByTestId('events')).toHaveTextContent('Steam Autumn Sale');
        expect(screen.getByTestId('today')).toHaveTextContent('2026-10-06');

        // The releases carry the session; `apiFetch` sends it on both, which is also what lets the
        // events through the dev site's basic auth.
        for (const [, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
            expect(init.credentials).toBe('include');
        }
    });

    it('asks for nothing with nobody signed in', () => {
        const fetchMock = stubApi([], calendarEvents());

        render(<Probe account={null} />);

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps the sales when the releases fail, since only one of them needs IGDB', async () => {
        stubApi('fail', SALE);

        render(<Probe account="user-1" />);

        await waitFor(() => expect(screen.getByTestId('releases')).toHaveTextContent('could not be loaded (502)'));
        expect(screen.getByTestId('events')).toHaveTextContent('Steam Autumn Sale');
    });

    it('keeps the releases when the events cannot be reached', async () => {
        stubApi([RE2], 'unreachable');

        render(<Probe account="user-1" />);

        await waitFor(() => expect(screen.getByTestId('events')).toHaveTextContent('Failed to fetch'));
        expect(screen.getByTestId('releases')).toHaveTextContent('Resident Evil 2');
    });

    it("drops one account's releases the moment another signs in", async () => {
        stubApi([RE2], SALE);
        const { rerender } = render(<Probe account="user-1" />);
        await waitFor(() => expect(screen.getByTestId('releases')).toHaveTextContent('Resident Evil 2'));

        rerender(<Probe account="user-2" />);

        // Cleared on the transition, before the second account's answer has arrived.
        expect(screen.getByTestId('releases')).toHaveTextContent('loading');
        await waitFor(() => expect(screen.getByTestId('releases')).toHaveTextContent('Resident Evil 2'));
    });
});
