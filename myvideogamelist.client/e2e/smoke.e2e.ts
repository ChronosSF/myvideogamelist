import { expect, test } from '@playwright/test';
import { GAME, SITE } from './stand-ins';

/** A digit, lower case, eight or more: what `Program.cs` asks of a password. */
const PASSWORD = 'smoke-test-1';

/**
 * A username no earlier run has taken: the database keeps every account a run registers. `e2e_`, then
 * the time and four random characters in base 36, is sixteen characters of the twenty allowed.
 */
function newUserName(): string {
    return `e2e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
}

test('a new account adds a game to a list, and it is still there after a reload', async ({ page }) => {
    // The browser talks to the distribution and to nothing else, so no third party a page might one
    // day load from can make this test slow or flaky. Nothing does today.
    await page.context().route(url => url.origin !== SITE, route => route.abort('blockedbyclient'));

    // Rendered on the server, from the stand-in's game: the loader reaches the API directly.
    await page.goto(`/games/${GAME.id}`);
    await expect(page.getByRole('heading', { level: 1, name: GAME.title })).toBeVisible();

    await test.step('sign up', async () => {
        // Shown once the page has hydrated and asked the API who is signed in, through the
        // distribution, which is the first request ADR 0003's failure breaks.
        await page.getByRole('button', { name: 'Sign Up' }).click();

        const userName = newUserName();
        const form = page.getByRole('dialog', { name: 'Create Account' });
        await form.getByLabel('Username').fill(userName);
        await form.getByLabel('Email').fill(`${userName}@test.local`);
        await form.getByLabel('Password', { exact: true }).fill(PASSWORD);
        await form.getByLabel('Confirm Password').fill(PASSWORD);
        await form.getByRole('button', { name: 'Create Account' }).click();

        await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    });

    await test.step('add the game to Playing', async () => {
        // The button shows the move before the API has answered — the update is optimistic — so the
        // answer is what is waited for. A reload before it would race the write.
        const saved = page.waitForResponse(response =>
            response.request().method() === 'PUT'
            && new URL(response.url()).pathname === `/api/lists/${GAME.id}`);
        await page.getByRole('button', { name: 'Playing', exact: true }).click();
        expect((await saved).ok()).toBe(true);
    });

    await test.step('reload, and it is still there', async () => {
        // A new document, so nothing survives from the page that made the write but the session
        // cookie: what the panel shows now is what the API stored.
        await page.reload();
        await expect(page.getByRole('button', { name: 'Playing', exact: true, pressed: true })).toBeVisible();

        // And on the list itself, which renders the game from the API's own copy of it.
        await page.goto('/lists');
        await expect(page.getByRole('link', { name: GAME.title, exact: true })).toBeVisible();
    });
});
