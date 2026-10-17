import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { GameNewsPanel } from '@/components/GameNewsPanel';
import type { NewsItemDto } from '@/types/news';
import { type ApiRoutes, empty, held, json, stubApi, unreachable } from '@/test/api';

/**
 * The game page's news, fetched after hydration so the page's own render never waits on Steam. A
 * game with no Steam presence is the normal case for a console exclusive, so nothing to show — and a
 * failure to fetch it — is no panel at all rather than an empty or alarming one.
 */

function news(id: string, gameId: number, title: string): NewsItemDto {
    return {
        id,
        gameId,
        gameTitle: 'Celeste',
        gameCoverUrl: null,
        title,
        url: `https://store.steampowered.com/news/${id}`,
        source: 'Steam',
        excerpt: null,
        publishedAt: '2026-09-01T12:00:00Z',
    };
}

function renderPanel(routes: ApiRoutes, gameId = 1) {
    const api = stubApi(routes);
    const { rerender } = render(<MemoryRouter><GameNewsPanel gameId={gameId} /></MemoryRouter>);
    return { api, showGame: (next: number) => rerender(<MemoryRouter><GameNewsPanel gameId={next} /></MemoryRouter>) };
}

const heading = () => screen.queryByRole('heading', { name: /latest news/i });

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('GameNewsPanel', () => {
    it("shows the game's news under its heading once it arrives", async () => {
        renderPanel({ 'GET /api/news/game/1': () => json([news('a', 1, 'Patch 1.4: Farewell')]) });

        expect(await screen.findByRole('heading', { name: 'Latest news & patch notes' })).toBeInTheDocument();
        expect(screen.getByText('Patch 1.4: Farewell')).toBeInTheDocument();
    });

    it('renders nothing for a game with no news, nor when the news cannot be had', async () => {
        for (const answer of [() => json([]), () => empty(502), unreachable]) {
            const { api } = renderPanel({ 'GET /api/news/game/1': answer });

            await waitFor(() => expect(api.calls).toHaveLength(1));
            await act(async () => {});
            expect(heading()).not.toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            vi.unstubAllGlobals();
        }
    });

    it("takes one game's news down as soon as the page moves to the next game", async () => {
        // The page stays mounted from one game to the next; its headlines must not sit under
        // another game's title while that game's are on their way.
        const next = held();
        const { showGame } = renderPanel({
            'GET /api/news/game/1': () => json([news('a', 1, 'Celeste news')]),
            'GET /api/news/game/2': () => next.answer,
        });
        await screen.findByText('Celeste news');

        showGame(2);

        expect(screen.queryByText('Celeste news')).not.toBeInTheDocument();
        await act(async () => next.release(json([news('b', 2, 'Hades news')])));
        expect(await screen.findByText('Hades news')).toBeInTheDocument();
    });
});
