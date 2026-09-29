import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AdminPage } from '@/pages/AdminPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { CuratedEvent, ShowcaseName } from '@/types/calendarAdmin';
import { userProfile } from '@/test/factories';

/**
 * Auth, mocked: the real provider fetches, and the page only reads who is signed in. One
 * module-level object handed back on every call — a fresh literal per render re-runs every effect
 * that depends on it, which ends in a heap crash rather than a failed assertion.
 */
const auth: AuthContextValue = {
    user: null,
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateTheme: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const ADMIN = userProfile({ id: 'admin-1', userName: 'stamen', isAdmin: true });

function event(overrides: Partial<CuratedEvent> = {}): CuratedEvent {
    return {
        id: 1,
        kind: 'sale',
        store: 'steam',
        name: 'Steam Autumn Sale',
        startsOn: '2026-10-01',
        endsOn: '2026-10-08',
        url: 'https://partner.steamgames.com/doc/marketing/upcoming_events',
        updatedAt: '2026-09-28T12:00:00Z',
        ...overrides,
    };
}

/**
 * The admin API, in memory: it answers the page's reads from what it holds and applies its writes,
 * refusing a showcase name it already has in the shape the real one does.
 */
function fakeApi(initial: { events?: CuratedEvent[]; names?: ShowcaseName[]; refuse?: number } = {}) {
    const events = [...(initial.events ?? [])];
    const names = [...(initial.names ?? [])];
    let nextId = 100;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (initial.refuse) return new Response(null, { status: initial.refuse });

        if (url === '/api/admin/calendar/events' && method === 'GET') return Response.json(events);
        if (url === '/api/admin/calendar/showcase-names' && method === 'GET') return Response.json(names);

        if (url === '/api/admin/calendar/events' && method === 'POST') {
            const added = { ...JSON.parse(String(init?.body)), id: nextId++, updatedAt: '2026-09-29T12:00:00Z' };
            events.push(added);
            return Response.json(added);
        }

        if (url.startsWith('/api/admin/calendar/events/') && method === 'DELETE') {
            const id = Number(url.split('/').pop());
            events.splice(events.findIndex(e => e.id === id), 1);
            return new Response(null, { status: 204 });
        }

        if (url === '/api/admin/calendar/showcase-names' && method === 'POST') {
            const { prefix } = JSON.parse(String(init?.body)) as { prefix: string };
            if (names.some(n => n.prefix.toLowerCase() === prefix.toLowerCase())) {
                return Response.json(
                    { title: 'One or more validation errors occurred.', errors: { Prefix: ['That name is already on the list.'] } },
                    { status: 400 });
            }
            const added = { id: nextId++, prefix };
            names.push(added);
            return Response.json(added);
        }

        throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function renderPage() {
    return render(
        <MemoryRouter>
            <AdminPage />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    // Only the clock, so that what counts as past is fixed; the timers userEvent waits on stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 29, 12, 0));
    auth.user = ADMIN;
    auth.loading = false;
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('AdminPage for anybody who is not an admin', () => {
    it('asks a signed-out visitor to sign in, and asks the API for nothing', () => {
        auth.user = null;
        const fetchMock = fakeApi();
        renderPage();

        expect(screen.getByText('Sign in to use this page.')).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('tells a signed-in account it is not an admin, and asks the API for nothing', () => {
        auth.user = userProfile({ isAdmin: false });
        const fetchMock = fakeApi();
        renderPage();

        expect(screen.getByText('Only an admin can use this page.')).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('believes the server over the navbar when the server refuses', async () => {
        // An account the client still thinks is an admin, after its id left the configuration.
        fakeApi({ refuse: 403 });
        renderPage();

        expect(await screen.findByRole('alert')).toHaveTextContent('Only an admin can use this page.');
        // Retrying cannot turn a refusal into an answer, so it is not offered.
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });
});

describe('AdminPage for an admin', () => {
    it('lists what is current or coming first, and folds away what is over', async () => {
        fakeApi({
            events: [
                event({ id: 1, name: 'Steam Summer Sale', startsOn: '2026-06-25', endsOn: '2026-07-09' }),
                event({ id: 2, name: 'Steam Autumn Sale', startsOn: '2026-09-24', endsOn: '2026-10-01' }),
                event({ id: 3, name: 'Epic Holiday Sale', store: 'epic', startsOn: '2026-12-10', endsOn: '2027-01-07' }),
            ],
        });
        renderPage();

        const coming = await screen.findByRole('list', { name: 'Current and upcoming' });
        expect(within(coming).getByText('Steam Autumn Sale')).toBeInTheDocument();
        expect(within(coming).getByText('Epic Holiday Sale')).toBeInTheDocument();
        expect(within(coming).getByText(/Dec 10, 2026 – Jan 7, 2027/)).toBeInTheDocument();
        expect(within(coming).queryByText('Steam Summer Sale')).not.toBeInTheDocument();

        expect(screen.getByText('Past events (1)')).toBeInTheDocument();
    });

    it('adds a one-day event with its first day as its last, and keeps the kind, store and link for the next', async () => {
        const fetchMock = fakeApi();
        const actor = userEvent.setup();
        renderPage();

        const form = await screen.findByRole('form', { name: 'Add an event' });
        await actor.type(within(form).getByLabelText('Name'), 'Steam Next Fest');
        await actor.selectOptions(within(form).getByLabelText('Kind'), 'Fest');
        fireEvent.change(within(form).getByLabelText('First day'), { target: { value: '2026-10-19' } });
        await actor.type(within(form).getByLabelText('Announced at'), 'https://partner.steamgames.com/doc/marketing/upcoming_events');
        await actor.click(within(form).getByRole('button', { name: 'Add event' }));

        const coming = await screen.findByRole('list', { name: 'Current and upcoming' });
        expect(within(coming).getByText('Steam Next Fest')).toBeInTheDocument();

        const [, init] = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
        expect(JSON.parse(String(init?.body))).toMatchObject({
            kind: 'fest',
            store: 'steam',
            startsOn: '2026-10-19',
            endsOn: '2026-10-19',
        });

        expect(within(form).getByLabelText('Name')).toHaveValue('');
        expect(within(form).getByLabelText('Kind')).toHaveValue('fest');
        expect(within(form).getByLabelText('Announced at')).toHaveValue(
            'https://partner.steamgames.com/doc/marketing/upcoming_events');
    });

    it('will not add an event without the page it was announced on', async () => {
        const fetchMock = fakeApi();
        const actor = userEvent.setup();
        renderPage();

        const form = await screen.findByRole('form', { name: 'Add an event' });
        await actor.type(within(form).getByLabelText('Name'), 'Steam Winter Sale');
        fireEvent.change(within(form).getByLabelText('First day'), { target: { value: '2026-12-17' } });
        await actor.click(within(form).getByRole('button', { name: 'Add event' }));

        expect(within(form).getByLabelText('Announced at')).toHaveAttribute('aria-invalid', 'true');
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    });

    it('asks before removing an event', async () => {
        const fetchMock = fakeApi({ events: [event()] });
        const actor = userEvent.setup();
        renderPage();

        await actor.click(await screen.findByRole('button', { name: 'Remove Steam Autumn Sale' }));
        await actor.click(screen.getByRole('button', { name: 'Keep' }));
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

        await actor.click(screen.getByRole('button', { name: 'Remove Steam Autumn Sale' }));
        await actor.click(within(screen.getByRole('group', { name: 'Remove Steam Autumn Sale?' }))
            .getByRole('button', { name: 'Remove' }));

        expect(await screen.findByText('Nothing current or coming up.')).toBeInTheDocument();
    });

    it('adds a showcase name, sending the header every write needs', async () => {
        const fetchMock = fakeApi();
        const actor = userEvent.setup();
        renderPage();

        await actor.type(await screen.findByLabelText('Name starts with'), 'State of Play');
        await actor.click(screen.getByRole('button', { name: 'Add' }));

        const listed = await screen.findByRole('list', { name: 'Showcase names' });
        expect(within(listed).getByText('State of Play')).toBeInTheDocument();
        expect(screen.getByLabelText('Name starts with')).toHaveValue('');

        const [, init] = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
        expect(new Headers(init?.headers).get('X-MVGL-Request')).toBe('1');
    });

    it('says beside the box when a name is already on the list', async () => {
        fakeApi({ names: [{ id: 1, prefix: 'Nintendo Direct' }] });
        const actor = userEvent.setup();
        renderPage();

        const box = await screen.findByLabelText('Name starts with');
        await actor.type(box, 'nintendo direct');
        await actor.click(screen.getByRole('button', { name: 'Add' }));

        expect(await screen.findByText('That name is already on the list.')).toBeInTheDocument();
        expect(box).toHaveAttribute('aria-invalid', 'true');
        expect(box).toHaveValue('nintendo direct');
    });
});
