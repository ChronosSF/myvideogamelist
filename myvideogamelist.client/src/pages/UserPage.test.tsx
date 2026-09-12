import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { UserPage } from '@/pages/UserPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { UserProfile } from '@/types/auth';
import type { PlatformDto } from '@/types/game';
import { platform, userProfile } from '@/test/factories';

/**
 * Auth, mocked rather than provided: the real provider fetches, and this page only reads what it
 * holds.
 *
 * One module-level object handed back on every call, never a fresh literal — a new object per
 * render re-runs any effect depending on it, which ends in a heap crash rather than an assertion
 * failure.
 */
const auth: AuthContextValue = {
    user: null,
    loading: true,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateTheme: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

/**
 * The tracking block has its own test file and three requests of its own. These tests are about
 * the states around it — who is signed in, and what the two preference requests did.
 */
vi.mock('@/components/ProfileStats', () => ({
    ProfileStats: ({ userId }: { userId: string }) => <div>tracking for {userId}</div>,
}));

type PlatformsAnswer = PlatformDto[] | 'fail';
type HiddenAnswer = number[] | 'fail';

/**
 * Answers the two requests this page makes and nothing else, so a stray fetch fails loudly. The
 * two fail independently on purpose: the list says what there is to tick, the preference says what
 * is ticked, and the page has a different answer for each.
 */
function stubFetch(
    platforms: PlatformsAnswer = [platform(6, 'PC')],
    hidden: HiddenAnswer = [],
    saveStatus = 204,
) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/platforms/active') {
            return platforms === 'fail'
                ? new Response('nope', { status: 500 })
                : new Response(JSON.stringify(platforms), { status: 200 });
        }

        if (url === '/api/user/hidden-platforms') {
            if (init?.method === 'PUT') return new Response(null, { status: saveStatus });
            return hidden === 'fail'
                ? new Response('nope', { status: 500 })
                : new Response(JSON.stringify(hidden), { status: 200 });
        }

        throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** `/api/auth/me` has come back, with an account or with nobody. */
function authAnswered(user: UserProfile | null) {
    auth.user = user;
    auth.loading = false;
}

function renderPage() {
    return render(<MemoryRouter><UserPage /></MemoryRouter>);
}

const savePreferences = () => screen.queryByRole('button', { name: /save preferences/i });

beforeEach(() => {
    vi.unstubAllGlobals();
    // Where every visit starts, the server render included: nobody known yet.
    auth.user = null;
    auth.loading = true;
    vi.mocked(auth.updateTheme).mockReset();
    vi.mocked(auth.updateTheme).mockResolvedValue(undefined);
});

describe('UserPage before the account is known', () => {
    it('says it is loading rather than that nobody is signed in', () => {
        // The server render never knows who is signed in and neither does the first client render,
        // so without this every visit opened on the signed-out page and then replaced it.
        stubFetch();
        renderPage();

        expect(screen.getByRole('status')).toHaveTextContent(/loading your profile/i);
        expect(screen.queryByText(/sign in to see your profile/i)).not.toBeInTheDocument();
    });

    it('asks a signed-out visitor to sign in once that is settled', () => {
        authAnswered(null);
        stubFetch();
        renderPage();

        expect(screen.getByText(/sign in to see your profile/i)).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('asks for nothing while nobody is signed in', () => {
        authAnswered(null);
        const fetchMock = stubFetch();
        renderPage();

        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('UserPage platform preferences', () => {
    beforeEach(() => authAnswered(userProfile()));

    it('ticks the platforms the user has not hidden', async () => {
        stubFetch([platform(6, 'PC'), platform(48, 'PlayStation 4')], [48]);
        renderPage();

        await waitFor(() => expect(screen.getByRole('checkbox', { name: 'PC' })).toBeChecked());
        expect(screen.getByRole('checkbox', { name: 'PlayStation 4' })).not.toBeChecked();
        expect(savePreferences()).toBeEnabled();
    });

    it('offers nothing to save when the platform list fails to load', async () => {
        // The list comes from IGDB, so "no active platforms" would blame the platforms for an
        // outage — and a grid from a list we do not trust is not worth saving from.
        stubFetch('fail');
        renderPage();

        expect(await screen.findByRole('alert'))
            .toHaveTextContent(/platform list could not be loaded/i);
        expect(screen.queryByRole('checkbox', { name: 'PC' })).not.toBeInTheDocument();
        expect(savePreferences()).not.toBeInTheDocument();
    });

    it('offers nothing to save when the preference fails to load', async () => {
        // The empty set a failed read leaves behind is exactly what "nothing hidden" looks like,
        // so every box would render ticked and one press of Save would write that over whatever
        // the user had chosen.
        stubFetch([platform(6, 'PC')], 'fail');
        renderPage();

        expect(await screen.findByRole('alert'))
            .toHaveTextContent(/hidden platforms could not be loaded/i);
        expect(screen.queryByRole('checkbox', { name: 'PC' })).not.toBeInTheDocument();
        expect(savePreferences()).not.toBeInTheDocument();
    });

    it('says there are none rather than reporting a failure', async () => {
        stubFetch([], []);
        renderPage();

        await waitFor(() => expect(screen.getByText(/no active platforms found/i)).toBeInTheDocument());
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(savePreferences()).not.toBeInTheDocument();
    });

    it('announces a failed save and keeps the set that was being saved', async () => {
        // Nothing else on screen moves when a save fails, so the failure has to announce itself —
        // and the boxes stay as the user ticked them, to retry without doing it all again.
        const actor = userEvent.setup();
        stubFetch([platform(6, 'PC')], [], 500);
        renderPage();

        await waitFor(() => expect(screen.getByRole('checkbox', { name: 'PC' })).toBeChecked());
        await actor.click(screen.getByRole('checkbox', { name: 'PC' }));
        await actor.click(screen.getByRole('button', { name: /save preferences/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/failed to save/i);
        expect(screen.getByRole('checkbox', { name: 'PC' })).not.toBeChecked();
    });
});

describe('UserPage appearance', () => {
    beforeEach(() => authAnswered(userProfile()));

    it('names the switch for the state it turns on, not the action', async () => {
        // "Switch to light mode, checked" says nothing about which mode is on.
        const actor = userEvent.setup();
        stubFetch();
        renderPage();

        const toggle = screen.getByRole('checkbox', { name: 'Light mode' });
        expect(toggle).not.toBeChecked();

        await actor.click(toggle);

        await waitFor(() => expect(auth.updateTheme).toHaveBeenCalledWith('light'));
    });
});
