import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { GameNewsPanel } from '@/components/GameNewsPanel';
import type { NewsItemDto } from '@/types/news';
import { type ApiAnswer, type ApiRoutes, empty, held, json, settle, stubApi, tearDownApi, unreachable } from '@/test/api';

/**
 * The game page's news, fetched after hydration so the page's own render never waits on Steam. A
 * game with no Steam presence is the normal case for a console exclusive, so nothing to show — and a
 * failure to fetch it — is no panel at all rather than an empty or alarming one.
 */

/**
 * One headline about a game. Built here rather than in `src/test/factories.ts`, which most of the
 * open PRs are also editing, so that this file adds to it nothing to conflict with.
 */
function news(id: string, gameId: number, gameTitle: string, title: string): NewsItemDto {
    return {
        id,
        gameId,
        gameTitle,
        gameCoverUrl: null,
        title,
        url: `https://store.steampowered.com/news/${id}`,
        source: 'Steam',
        excerpt: null,
        publishedAt: '2026-09-01T12:00:00Z',
    };
}

/** The panel for Celeste, game 1, and a way to move it to another game as the page does. */
function renderPanel(routes: ApiRoutes) {
    const api = stubApi(routes);
    const { rerender } = render(<MemoryRouter><GameNewsPanel gameId={1} /></MemoryRouter>);
    return { api, showGame: (next: number) => rerender(<MemoryRouter><GameNewsPanel gameId={next} /></MemoryRouter>) };
}

afterEach(tearDownApi);

describe('GameNewsPanel', () => {
    it("shows the game's news under its heading once it arrives", async () => {
        renderPanel({ 'GET /api/news/game/1': () => json([news('a', 1, 'Celeste', 'Patch 1.4: Farewell')]) });

        expect(await screen.findByRole('heading', { name: 'Latest news & patch notes' })).toBeInTheDocument();
        expect(screen.getByText('Patch 1.4: Farewell')).toBeInTheDocument();
    });

    it.each<[string, () => ApiAnswer]>([
        ['a game with no news', () => json([])],
        ['news the API failed to fetch', () => empty(502)],
        ['an API that cannot be reached', unreachable],
    ])('renders nothing, and raises nothing, for %s', async (_, answer) => {
        const { api } = renderPanel({ 'GET /api/news/game/1': answer });

        await settle();

        expect(api.calls).toHaveLength(1);
        expect(screen.queryByRole('heading', { name: /latest news/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it("takes one game's news down as soon as the page moves to the next game", async () => {
        // The page stays mounted from one game to the next; its headlines must not sit under
        // another game's title while that game's are on their way.
        const next = held();
        const { showGame } = renderPanel({
            'GET /api/news/game/1': () => json([news('a', 1, 'Celeste', 'Celeste news')]),
            'GET /api/news/game/2': () => next.answer,
        });
        await screen.findByText('Celeste news');

        showGame(2);

        expect(screen.queryByText('Celeste news')).not.toBeInTheDocument();
        await act(async () => next.release(json([news('b', 2, 'Hades', 'Hades news')])));
        expect(await screen.findByText('Hades news')).toBeInTheDocument();
    });
});
