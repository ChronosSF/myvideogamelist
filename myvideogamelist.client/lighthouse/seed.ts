import { randomBytes } from 'node:crypto';
import { request } from '@playwright/test';

/** The run's throwaway account. */
export interface Account {
    userName: string;
    email: string;
    password: string;
}

/**
 * The library the account is given: every list, scores across the range, a shelf of favourites, a
 * wishlist, playthroughs with hours and two public reviews. That is what the public profile and the
 * lists page render, so it is what makes them worth auditing; an empty account would audit an empty
 * state. Every game is one the stand-in for IGDB knows (`igdb.json`), so each renders with its cover.
 *
 * Written through the API, as the site writes it, rather than as SQL like
 * `scripts/seed-demo-history.mjs`: the audit then needs nothing but the harness, here and in CI. The
 * cost is that every status change is dated today, so the profile's activity chart has one month
 * of data rather than a year's.
 */
const LISTS: readonly (readonly [gameId: number, status: string, score?: number])[] = [
    [119133, 'playing', 10],
    [119171, 'playing'],
    [25076, 'playing'],
    [114283, 'on_hold'],
    [103337, 'on_hold'],
    [1942, 'finished', 10],
    [7346, 'finished', 9],
    [26226, 'finished', 8],
    [14593, 'finished', 9],
    [113112, 'finished', 9],
    [72, 'finished', 8],
    [19560, 'finished', 9],
    [12517, 'finished', 7],
    [26758, 'finished', 8],
    [7342, 'finished', 7],
    [1009, 'finished', 10],
    [141503, 'dropped', 4],
    [36926, 'dropped', 5],
    [112875, 'backlog'],
    [26845, 'backlog'],
    [203722, 'backlog'],
    [195517, 'backlog'],
    [31551, 'backlog'],
    [75235, 'backlog'],
    [134606, 'backlog'],
];

const FAVOURITES = [1942, 119133, 14593, 1009, 7346, 113112];

const WISHLIST = [144024, 112874, 168670, 122238, 19686];

const PLAYTHROUGHS = [
    { gameId: 1942, type: 'completionist', platformId: 6, minutesPlayed: 7260, startedOn: '2025-08-02', finishedOn: '2025-09-28' },
    { gameId: 7346, type: 'normally', platformId: 130, minutesPlayed: 3180, startedOn: '2025-07-20', finishedOn: '2025-08-14' },
    { gameId: 14593, type: 'normally', platformId: 6, minutesPlayed: 2340, startedOn: '2025-10-05', finishedOn: '2025-10-27' },
    { gameId: 119133, type: null, platformId: 6, minutesPlayed: 900, startedOn: '2026-08-25', finishedOn: null },
] as const;

const REVIEWS = [
    {
        gameId: 1942,
        body: 'The best side quests in the genre, and it is not close. The main story is the least of '
            + 'it: what stays is a village, a family and a bargain that goes wrong in a way nobody in '
            + 'it deserved.',
    },
    {
        gameId: 14593,
        body: 'A map that rewards getting lost, and a difficulty that is fair once you stop fighting '
            + 'it. Hallownest is the best-drawn place in the genre.',
    },
];

/** The header `apiFetch` adds to every write. The API refuses a write without it (ADR 0033). */
const WRITE = { 'X-MVGL-Request': '1' };

/**
 * A username no other run has taken: `lh_`, the time in base 36 and four random hex digits, fifteen
 * characters of the twenty allowed. From `node:crypto`, as the smoke test's is, because CodeQL flags
 * `Math.random` wherever its value meets a sign-up form.
 */
function newUserName(): string {
    return `lh_${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
}

/**
 * Registers the run's account through the distribution, as the sign-up dialog does, and gives it its
 * library and a public profile. Called from the global setup, once the servers and the stand-ins are
 * up, so that every test in the run audits the same account.
 */
export async function seedAccount(site: string): Promise<Account> {
    const userName = newUserName();
    const account = { userName, email: `${userName}@test.local`, password: 'lighthouse-1' };
    const api = await request.newContext({ baseURL: site, extraHTTPHeaders: WRITE });

    const write = async (method: 'post' | 'put', path: string, data: unknown) => {
        const response = await api[method](path, { data });
        if (!response.ok()) {
            throw new Error(`${method.toUpperCase()} ${path} answered ${response.status()}: ${await response.text()}`);
        }
    };

    try {
        await write('post', '/api/auth/register', account);
        try {
            await write('put', '/api/user/privacy', { profileVisibility: 'public' });

            for (const [gameId, status, score] of LISTS) {
                await write('put', `/api/lists/${gameId}`, { status });
                if (score !== undefined) await write('put', `/api/entries/${gameId}/score`, { score });
            }

            for (const gameId of FAVOURITES) await write('put', `/api/favourites/${gameId}`, {});
            for (const gameId of WISHLIST) await write('put', `/api/wishlist/${gameId}`, {});

            for (const { gameId, ...playthrough } of PLAYTHROUGHS) {
                await write('post', `/api/entries/${gameId}/playthroughs`, { ...playthrough, notes: null });
            }

            for (const { gameId, body } of REVIEWS) {
                await write('put', `/api/entries/${gameId}/review`, { body, hasSpoilers: false, visibility: 'public' });
            }
        } catch (error) {
            // Half a library is nobody's: the account goes, so that it is not on the next run's pages.
            await api.delete('/api/user', { data: { password: account.password } });
            throw error;
        }
    } finally {
        await api.dispose();
    }

    return account;
}

/**
 * Deletes the run's account, as its owner would, which takes its whole library with it. So the next
 * run's game page counts the same one member as this run's did, here as in CI, where the database is
 * new every time.
 */
export async function deleteAccount(site: string, account: Account) {
    const api = await request.newContext({ baseURL: site, extraHTTPHeaders: WRITE });
    try {
        const signedIn = await api.post('/api/auth/login', { data: { email: account.email, password: account.password } });
        if (!signedIn.ok()) throw new Error(`Signing in to delete ${account.userName} answered ${signedIn.status()}.`);
        const deleted = await api.delete('/api/user', { data: { password: account.password } });
        if (!deleted.ok()) throw new Error(`Deleting ${account.userName} answered ${deleted.status()}.`);
    } finally {
        await api.dispose();
    }
}

/** Where the global setup leaves the account for the tests, which run in workers of their own. */
const ACCOUNT_VARIABLE = 'LIGHTHOUSE_ACCOUNT';

export function shareAccount(account: Account) {
    process.env[ACCOUNT_VARIABLE] = JSON.stringify(account);
}

/** The account the global setup registered. */
export function seededAccount(): Account {
    const shared = process.env[ACCOUNT_VARIABLE];
    if (shared === undefined) throw new Error('No account was seeded: the global setup did not run.');
    return JSON.parse(shared) as Account;
}
