import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { PlayNextPicker } from '@/components/PlayNextPicker';
import { ListsProvider } from '@/contexts/ListsProvider';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { FavouritesContextValue } from '@/contexts/FavouritesContext';
import { entry, userProfile } from '@/test/factories';

/**
 * Starting the pick with the real `ListsProvider` behind the card, and the save held open until a test
 * answers it. `PlayNextPicker.test.tsx` mocks the lists, and a mock hands the card the backlog and the lock
 * in one render — where the provider moves the game out of the backlog in one render and publishes its lock
 * as that render is laid out, so a card that asked the lock whether to keep its pick asked one render too
 * early (`docs/decisions/0086-*`).
 *
 * Every object handed back is hoisted, never a fresh literal per call.
 */
const auth: AuthContextValue = {
    user: userProfile(),
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    updateProfileDetails: vi.fn(async () => {}),
    updateLook: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const favourites = { isFavourite: () => false } as unknown as FavouritesContextValue;
vi.mock('@/hooks/useFavourites', () => ({ useFavourites: () => favourites }));

const HADES = entry({ game: { id: 1, title: 'Hades' } });
const CELESTE = entry({ game: { id: 2, title: 'Celeste' } });

/** Answers the start, which until then is out. */
let answerStart: (status: number) => void;

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url === '/api/lists') {
            return new Response(JSON.stringify({ lists: { backlog: [HADES, CELESTE] } }), { status: 200 });
        }
        if (method === 'GET') return new Response(JSON.stringify({ view: 'tiles', sorts: {} }), { status: 200 });
        return new Promise<Response>(resolve => {
            answerStart = status => resolve(new Response(status === 204 ? null : 'nope', { status }));
        });
    }));
    // The first draw lands on the first game.
    vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** The title link, which is the one link on the card a screen reader is given. */
const pickedTitle = () => screen.getByRole('link').textContent;

async function startThePick() {
    const actor = userEvent.setup();
    render(<MemoryRouter><ListsProvider><PlayNextPicker /></ListsProvider></MemoryRouter>);
    await screen.findByRole('button', { name: 'Start playing' });
    expect(pickedTitle()).toBe('Hades');

    await actor.click(screen.getByRole('button', { name: 'Start playing' }));
}

describe('PlayNextPicker starting the pick, with the lists provider', () => {
    it('stays on the game while its start is out', async () => {
        await startThePick();

        expect(pickedTitle()).toBe('Hades');
        expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Pick another' })).toBeDisabled();
    });

    it('is still on the game when the start fails and the game is back in the backlog', async () => {
        await startThePick();

        await act(async () => answerStart(500));

        expect(pickedTitle()).toBe('Hades');
        expect(screen.getByRole('button', { name: 'Start playing' })).toBeEnabled();
        expect(screen.getByText('Picked from the 2 games in your backlog.')).toBeInTheDocument();
    });

    it('moves on to another game once the start has saved', async () => {
        await startThePick();

        await act(async () => answerStart(204));

        expect(pickedTitle()).toBe('Celeste');
        expect(screen.getByText('The only game in your backlog.')).toBeInTheDocument();
    });
});
