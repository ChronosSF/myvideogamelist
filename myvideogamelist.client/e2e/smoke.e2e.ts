import { expect, test } from '@playwright/test';
import { GAMES, SITE } from './stand-ins';

/** A digit, lower case, eight or more: what `Program.cs` asks of a password. */
const PASSWORD = 'smoke-test-1';

/**
 * A username no earlier run has taken: the database keeps every account a run registers. `e2e_`, then
 * the time and four random characters in base 36, is sixteen characters of the twenty allowed.
 */
function newUserName(): string {
    return `e2e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
}

/**
 * A game no earlier run has looked at, among the stand-in's: the time in milliseconds, which repeats
 * only after more than a day, by when the API's copy of that game is due to be asked for again anyway.
 */
function newGameId(): number {
    return GAMES.firstId + (Date.now() % 100_000_000);
}

test('a new account adds a game to a list, and it is still there after a reload', async ({ page }) => {
    // The browser talks to the stand-in for the edge and to nothing else, so no third party a page
    // might one day load from can make this test slow or flaky. Nothing does today.
    await page.context().route(url => url.origin !== SITE, route => route.abort('blockedbyclient'));

    const gameId = newGameId();

    // Rendered on the server, from the stand-in's game: the loader reaches the API directly.
    await page.goto(`/games/${gameId}`);
    await expect(page.getByRole('heading', { level: 1, name: GAMES.title })).toBeVisible();

    await test.step('sign up', async () => {
        // Shown once the page has hydrated and asked the API who is signed in, through the edge,
        // which is the first request ADR 0003's failure breaks.
        await page.getByRole('button', { name: 'Sign Up' }).click();

        const userName = newUserName();
        const form = page.getByRole('dialog', { name: 'Create Account' });
        await form.getByLabel('Username').fill(userName);
        await form.getByLabel('Email').fill(`${userName}@test.local`);
        await form.getByLabel('Password', { exact: true }).fill(PASSWORD);
        await form.getByLabel('Confirm Password').fill(PASSWORD);

        // The answer, not only the screen: a 405 is the SSR server answering for the API, a 429 the
        // sign-up limit, a 400 a name refused, and each would otherwise be the same ten-second wait
        // for a menu that never appears.
        const registered = page.waitForResponse(response =>
            response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/auth/register');
        await form.getByRole('button', { name: 'Create Account' }).click();
        expect((await registered).status(), 'what the API answered the sign-up').toBe(200);

        await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    });

    await test.step('add the game to Playing', async () => {
        // The button shows the move before the API has answered — the update is optimistic — so the
        // answer is what is waited for. A reload before it would race the write.
        const saved = page.waitForResponse(response =>
            response.request().method() === 'PUT'
            && new URL(response.url()).pathname === `/api/lists/${gameId}`);
        await page.getByRole('button', { name: 'Playing', exact: true }).click();

        // The status says which part broke: a 401 is a lost cookie, a 403 a lost X-MVGL-Request, and
        // a 404 or a 405 the SSR server answering for the API.
        expect((await saved).status(), 'what the API answered the write').toBe(204);
    });

    await test.step('reload, and it is still there', async () => {
        // A new document, so nothing survives from the page that made the write but the session
        // cookie: what the panel shows now is what the API stored.
        await page.reload();
        await expect(page.getByRole('button', { name: 'Playing', exact: true, pressed: true })).toBeVisible();

        // And on the list itself, which renders the game from the API's own copy of it, made when
        // the reload first asked for it.
        await page.goto('/lists');
        await expect(page.getByRole('link', { name: GAMES.title, exact: true })).toBeVisible();
    });
});
