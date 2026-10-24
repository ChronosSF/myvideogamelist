import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { RouterContextProvider } from 'react-router';
import { within } from '@testing-library/react';
import { ShowcasesAndSales } from '@/components/ShowcasesAndSales';
import { eventDays, startTime } from '@/lib/calendarEvents';
import { localToday, utcDay } from '@/lib/daySpan';
import { loader } from '@/pages/HomePage';
import { calendarEvents } from '@/test/factories';
import type { CalendarShowcase } from '@/types/releases';

/**
 * The panel, its days and its loader in a timezone far from UTC.
 *
 * Everywhere else these tests run in Honolulu (`vitest.config.ts`), ten hours behind UTC all year. This
 * file pins New York instead, before anything is imported — four hours behind UTC in October, so that
 * its evenings are already tomorrow in UTC — because the instants below were chosen for that offset.
 *
 * Pinned through `process.env.TZ`, which Node applies to the whole process the moment it is set. So it
 * needs what `vitest.config.ts` leaves at its defaults: the `forks` pool, and a process for each file
 * (`isolate`), which is what keeps the pin from leaking into the file that runs next — checked. Under
 * worker threads the assignment does not take at all, and the first test below says so rather than
 * letting the rest pass in some other zone.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/New_York';
});

/** A show at 02:00 UTC on the 20th, which is ten in the evening of the 19th in New York. */
const LATE_SHOW: CalendarShowcase = {
    id: 1197,
    name: 'ID@Xbox October 2026 Showcase',
    startsAt: '2026-10-20T02:00:00.000Z',
    endsAt: '2026-10-20T03:00:00.000Z',
    url: null,
};

beforeEach(() => {
    // Half past eight in the evening of the 17th in New York: already the 18th in UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T20:30:00-04:00'));
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('in New York', () => {
    it('is in New York', () => {
        // Everything below means something only if the pin took.
        expect(new Date('2026-10-18T00:30:00Z').getHours()).toBe(20);
    });

    it('tells the reader’s day from UTC’s', () => {
        expect(localToday()).toBe('2026-10-17');
        expect(utcDay(new Date())).toBe('2026-10-18');
    });

    it('puts a late show on the reader’s day by default, and on UTC’s only when asked', () => {
        const events = calendarEvents({ showcases: [LATE_SHOW] });

        expect(eventDays(events)[0]).toMatchObject({ startsOn: '2026-10-19', endsOn: '2026-10-19' });
        expect(eventDays(events, 'utc')[0]).toMatchObject({ startsOn: '2026-10-20', endsOn: '2026-10-20' });
    });

    it('hands the page UTC’s day from the loader, not the server’s own', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            spotlight: null, popular: [], news: [], events: calendarEvents(), degraded: false,
        }))));

        // With a context, which the loader's calls are traced through (ADR 0059).
        const result = await loader({ context: new RouterContextProvider() } as unknown as Parameters<typeof loader>[0]);

        expect(result.data.today).toBe('2026-10-18');
    });

    it('draws the server render on UTC’s days, and the hydrated panel on the reader’s', async () => {
        const element = <ShowcasesAndSales events={calendarEvents({ showcases: [LATE_SHOW] })} today="2026-10-18" />;

        // Counted from the loader's day, the 18th, with the show on UTC's 20th and no time.
        const html = renderToString(element);
        expect(html).toContain('Starts in 2 days');
        expect(html).toContain('Tue, Oct 20');
        expect(html).not.toContain(startTime(LATE_SHOW.startsAt));

        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container);

        const recoverable = vi.fn();
        const root = await act(async () => hydrateRoot(container, element, { onRecoverableError: recoverable }));

        // Then from the reader's 17th, with the show on their 19th, at ten in their evening.
        expect(recoverable).not.toHaveBeenCalled();
        const [show] = within(container).getAllByRole('listitem');
        expect(within(show).getByText('Starts in 2 days')).toBeInTheDocument();
        expect(within(show).getByText(`Mon, Oct 19, ${startTime(LATE_SHOW.startsAt)}`))
            .toHaveAttribute('dateTime', LATE_SHOW.startsAt);

        act(() => root.unmount());
        container.remove();
    });
});
