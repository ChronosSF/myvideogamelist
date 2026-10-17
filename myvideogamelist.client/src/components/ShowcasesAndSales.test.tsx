import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { render, screen, within } from '@testing-library/react';
import { ShowcasesAndSales } from '@/components/ShowcasesAndSales';
import { startTime } from '@/lib/calendarEvents';
import { calendarEvents } from '@/test/factories';
import type { CalendarCuratedEvent, CalendarEvents, CalendarShowcase } from '@/types/releases';

/** The day the loader ran on, which the server render counts from. */
const TODAY = '2026-10-17';

const NEXT_FEST: CalendarCuratedEvent = {
    id: 2,
    kind: 'fest',
    store: 'steam',
    name: 'Steam Next Fest',
    startsOn: '2026-10-19',
    endsOn: '2026-10-26',
    url: 'https://partner.steamgames.com/doc/marketing/upcoming_events',
};

const AUTUMN_SALE: CalendarCuratedEvent = {
    id: 1,
    kind: 'sale',
    store: 'steam',
    name: 'Steam Autumn Sale',
    startsOn: '2026-10-01',
    endsOn: '2026-10-15',
    url: 'https://partner.steamgames.com/doc/marketing/upcoming_events',
};

/** IGDB's live row on 2026-10-17, which had no stream yet, at a local hour so the test means the same everywhere. */
const ID_AT_XBOX: CalendarShowcase = {
    id: 1197,
    name: 'ID@Xbox October 2026 Showcase',
    startsAt: new Date(2026, 9, 20, 19).toISOString(),
    endsAt: new Date(2026, 9, 20, 20).toISOString(),
    url: null,
};

/** A card's lines, less whatever `leaveOut` selects, each with its whitespace as a browser shows it. */
function lines(card: HTMLElement, leaveOut: string): string[] {
    return [...card.children].map(line => {
        const copy = line.cloneNode(true) as HTMLElement;
        copy.querySelectorAll(leaveOut).forEach(node => node.remove());
        return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    });
}

/** What a sighted reader sees: less what is there only for a screen reader. */
const seen = (card: HTMLElement) => lines(card, '.sr-only');

/** What a screen reader says: less what is hidden from it. */
const heard = (card: HTMLElement) => lines(card, '[aria-hidden="true"]');

beforeEach(() => {
    // Midday on the 17th on the reader's clock, whatever timezone the tests run in: what the panel
    // reads once it is hydrated. Only the date is faked, so nothing waiting on a timer stalls.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 17, 12));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('ShowcasesAndSales', () => {
    it('is not drawn when nothing is on in the two weeks', () => {
        const { container } = render(<ShowcasesAndSales events={calendarEvents()} today={TODAY} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('is not drawn when all it was sent has already ended', () => {
        // The composite's window runs from a day before everybody's two weeks: a sale that ended two days
        // ago is in no reader's.
        const { container } = render(
            <ShowcasesAndSales events={calendarEvents({ curated: [AUTUMN_SALE] })} today={TODAY} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('lists each event with what it is, where it is, its name and a countdown to it', () => {
        render(<ShowcasesAndSales events={calendarEvents({ curated: [NEXT_FEST], showcases: [ID_AT_XBOX] })} today={TODAY} />);

        const panel = screen.getByRole('region', { name: 'Showcases and sales' });
        const [fest, show] = within(panel).getAllByRole('listitem');

        expect(within(fest).getByRole('link', { name: 'Steam Next Fest (opens in a new tab)' }))
            .toHaveAttribute('href', NEXT_FEST.url);
        expect(seen(fest)).toEqual(['Fest · Steam', 'Steam Next Fest', 'Starts in 2 days · Oct 19 – 26']);
        expect(heard(fest)).toEqual(['Fest, Steam', 'Steam Next Fest (opens in a new tab)', 'Starts in 2 days, Oct 19 – 26']);

        // No stream yet, so the name is not a link, and its start is on the reader's own clock.
        const time = startTime(ID_AT_XBOX.startsAt);
        expect(within(show).queryByRole('link')).toBeNull();
        expect(seen(show)).toEqual(['Showcase', 'ID@Xbox October 2026 Showcase', `Starts in 3 days · Tue, Oct 20, ${time}`]);
        expect(within(show).getByText(`Tue, Oct 20, ${time}`)).toHaveAttribute('dateTime', ID_AT_XBOX.startsAt);
    });

    it('opens a link in a new tab without handing the page to it', () => {
        render(<ShowcasesAndSales events={calendarEvents({ curated: [NEXT_FEST] })} today={TODAY} />);

        const link = screen.getByRole('link', { name: /Steam Next Fest/ });
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('shows the sales it has when the showcases could not be asked for, and says nothing of them', () => {
        // Silent, as the page is about the news when only the covers came back: the panel is a glance,
        // not a section anybody has learned to expect, and the page is not cached while it lasts.
        const events: CalendarEvents = calendarEvents({ curated: [NEXT_FEST], degraded: true });

        render(<ShowcasesAndSales events={events} today={TODAY} />);

        expect(screen.getAllByRole('listitem')).toHaveLength(1);
        expect(screen.queryByText(/could not be loaded/)).toBeNull();
    });

    it('renders on the server from UTC’s day, with no time, and hydrates without a mismatch', async () => {
        // A show at 20:30 UTC on the 20th: the server cannot know whose evening that is, so it says the
        // 20th to everybody and leaves the time to the browser.
        const show: CalendarShowcase = {
            ...ID_AT_XBOX,
            startsAt: '2026-10-20T20:30:00.000Z',
            endsAt: '2026-10-20T21:30:00.000Z',
        };
        const element = <ShowcasesAndSales events={calendarEvents({ curated: [NEXT_FEST], showcases: [show] })} today={TODAY} />;

        const html = renderToString(element);
        expect(html).toContain('Starts in 3 days');
        expect(html).toContain('Tue, Oct 20');
        expect(html).not.toContain(startTime(show.startsAt));

        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container);

        const recoverable = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const root = await act(async () => hydrateRoot(container, element, { onRecoverableError: recoverable }));

        // Hydrated with nothing to mend, and then given the reader's own clock.
        expect(recoverable).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
        expect(container).toHaveTextContent(startTime(show.startsAt));

        act(() => root.unmount());
        container.remove();
    });
});
