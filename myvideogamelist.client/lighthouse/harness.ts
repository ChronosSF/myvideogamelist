import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { idsIn, startStandIns, type HarnessPorts, type IgdbAnswer } from '../e2e/stand-ins';
import { deleteAccount, seedAccount, shareAccount } from './seed';

/**
 * The Lighthouse audit's harness (ADR 0068) is the smoke test's (ADR 0060): the front end's production
 * build under `react-router-serve` and the API under `dotnet run`, with a stand-in for the distribution
 * in front of both and one for IGDB behind the API. Two things differ. It listens on ports of its own,
 * so the two can run side by side, and its IGDB knows enough real games for the audited pages to look
 * as they do deployed: covers in every grid, a hero image on the home page, a game page with all of
 * its detail.
 */

/**
 * Beside the smoke test's 5180–5183, so that the two can run at once, and chosen as it chose those: clear
 * of `dotnet run`, `npm run dev` and a worktree's preview, and below the range Windows reserves for
 * Hyper-V (`e2e/stand-ins.ts`).
 */
export const PORTS = { api: 5190, igdb: 5191, ssr: 5192, distribution: 5193 } as const satisfies HarnessPorts;

/** What the browser opens, and what the front end is told is the public origin (`SITE_URL`). */
export const SITE = `http://localhost:${PORTS.distribution}`;

/** Where a run leaves its reports and its summary, emptied as it starts. CI uploads it as an artifact. */
export const REPORTS = fileURLToPath(new URL('./reports/', import.meta.url));

interface IgdbRow {
    id: number;
    [field: string]: unknown;
}

/**
 * Real IGDB rows, recorded from IGDB on 2026-10-17 with the field lists `IgdbService` asks for. The
 * games are the ones `scripts/seed-demo-history.mjs` names, in order of how many ratings they hold,
 * which is the order the browse page's default sort and the trending rail both come out in here.
 *
 * A listing row keeps what a grid, a list or a profile renders. It drops the websites and videos, which
 * only the game page reads, and every artwork but the first, which is the only one the API reads. It
 * keeps the ESRB rating, the only one the site shows, and drops the other boards'. The Witcher 3's row
 * is the game page's whole answer, detail fields included, as IGDB sent it.
 *
 * Every cover and artwork is a real image id, so the browser loads real images from IGDB's image host
 * and the largest contentful paint is measured on them rather than on an empty box.
 */
const RECORDED = JSON.parse(readFileSync(new URL('./igdb.json', import.meta.url), 'utf8')) as {
    games: IgdbRow[];
    timeToBeat: (IgdbRow & { game_id: number })[];
    genres: IgdbRow[];
};

/** The game page under audit, the one game recorded with its detail fields. */
export const GAME_ID = 1942;

/** The games this IGDB knows, which are the games a seeded library can hold. */
export const GAME_IDS: readonly number[] = RECORDED.games.map(game => game.id);

const byId = new Map(RECORDED.games.map(game => [game.id, game]));

/** The page of `rows` a query's `limit` and `offset` ask for. */
function page<T>(query: string, rows: readonly T[]): T[] {
    const limit = Number(/limit (\d+);/.exec(query)?.[1] ?? 10);
    const offset = Number(/offset (\d+);/.exec(query)?.[1] ?? 0);
    return rows.slice(offset, offset + limit);
}

/**
 * A lookup by id gets the rows it names. Any other query for games — the browse page's, a search — gets
 * a page of all of them, whatever it filtered or sorted by: this is not a model of IGDB. The trending
 * rail's popularity is the same order. A query for anything else gets nothing, as in the smoke test, so
 * no Steam id is found and the API never asks Steam for news: the home page's news rail is empty.
 */
const answer: IgdbAnswer = (endpoint, query) => {
    switch (endpoint) {
        case 'games': {
            const ids = idsIn(query);
            return ids.length > 0 ? ids.flatMap(id => byId.get(id) ?? []) : page(query, RECORDED.games);
        }
        case 'popularity_primitives':
            return page(query, RECORDED.games.map((game, rank) => ({
                id: rank + 1,
                game_id: game.id,
                value: RECORDED.games.length - rank,
            })));
        case 'genres':
            return RECORDED.genres;
        case 'game_time_to_beats': {
            const id = Number(/where game_id = (\d+);/.exec(query)?.[1]);
            return RECORDED.timeToBeat.filter(row => row.game_id === id);
        }
        default:
            return [];
    }
};

/**
 * The run's global setup: both stand-ins, on the audit's ports, and then the account every test audits.
 * What it returns is the run's teardown, which deletes the account and stops the stand-ins.
 */
export default async function setUp(): Promise<() => Promise<void>> {
    // Retried, because Windows refuses to delete a folder for a moment while something reads it.
    rmSync(REPORTS, { recursive: true, force: true, maxRetries: 5 });
    const stop = await startStandIns(PORTS, answer);
    try {
        const account = await seedAccount(SITE);
        shareAccount(account);
        return async () => {
            try {
                await deleteAccount(SITE, account);
            } finally {
                await stop();
            }
        };
    } catch (error) {
        await stop();
        throw error;
    }
}
