import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { NewsPage } from '@/pages/NewsPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { UserProfile } from '@/types/auth';
import type { NewsItemDto } from '@/types/news';
import { userProfile } from '@/test/factories';

/**
 * Auth, mocked rather than provided: the real provider fetches, and the page only reads `user` and
 * `loading`. One module-level object handed back on every call and never a fresh literal — a new
 * object per render re-runs any effect depending on it, which ends in a heap crash rather than an
 * assertion failure.
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
    deleteAccount: vi.fn(async () => {}),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const PATCH: NewsItemDto = {
    id: 'gid-1',
    gameId: 1145360,
    gameTitle: 'Hades II',
    gameCoverUrl: null,
    title: 'Patch 1.1 is live',
    url: 'https://store.steampowered.com/news/1',
    source: 'Steam Community Announcements',
    excerpt: 'New weapons and a rebalanced Underworld.',
    publishedAt: '2026-09-14T10:00:00+00:00',
};

type Answer = NewsItemDto[] | 'fail';

/** Answers `/api/user/news` from a script, one entry per request, repeating the last. */
function stubNews(answers: Answer[]) {
    let index = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url !== '/api/user/news') throw new Error(`unexpected fetch: ${url}`);

        const answer = answers[Math.min(index++, answers.length - 1)];
        return answer === 'fail'
            ? new Response('nope', { status: 500 })
            : new Response(JSON.stringify(answer), { status: 200 });
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
    return render(<MemoryRouter><NewsPage /></MemoryRouter>);
}

beforeEach(() => {
    vi.unstubAllGlobals();
    auth.user = null;
    auth.loading = true;
});

describe('NewsPage before the account is known', () => {
    it('says it is loading rather than that nobody is signed in', () => {
        const fetchMock = stubNews([[PATCH]]);
        renderPage();

        expect(screen.getByRole('status')).toHaveTextContent(/loading news/i);
        expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('asks a signed-out visitor to sign in, and asks the API for nothing', () => {
        authAnswered(null);
        const fetchMock = stubNews([[PATCH]]);
        renderPage();

        expect(screen.getByText(/sign in to see news for the games you track/i)).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('NewsPage signed in', () => {
    beforeEach(() => authAnswered(userProfile()));

    it('shows the news for the games the user tracks', async () => {
        stubNews([[PATCH]]);
        renderPage();

        const headline = await screen.findByRole('link', { name: 'Patch 1.1 is live' });
        expect(headline).toHaveAttribute('href', PATCH.url);
        expect(screen.getByRole('link', { name: 'Hades II' })).toBeInTheDocument();
        // The list is not everything, and says which end a busy library loses.
        expect(screen.getByText(/finished and dropped games are the ones left out/i)).toBeInTheDocument();
    });

    it('explains an empty answer rather than showing an empty page', async () => {
        // Tracking nothing, tracking only games with no Steam page, and a quiet week all arrive as
        // the same empty list, so one explanation has to cover all three.
        stubNews([[]]);
        renderPage();

        expect(await screen.findByText('No news for your games right now.')).toBeInTheDocument();
        expect(screen.getByText(/a game with no steam page never has any/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Browse games' })).toHaveAttribute('href', '/games');
    });

    it('reports a failure, and tries again when asked', async () => {
        const actor = userEvent.setup();
        const fetchMock = stubNews(['fail', [PATCH]]);
        renderPage();

        expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load news/i);

        await actor.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByRole('link', { name: 'Patch 1.1 is live' })).toBeInTheDocument();
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
