import { expect, test } from '@playwright/test';
import { newUserName } from './accounts';
import { confirmationLinkFor, outboxFor } from './outbox';
import { GAMES, PORTS, SITE, standInForTurnstile } from './stand-ins';

/** A digit, lower case, eight or more: what `Program.cs` asks of a password. */
const PASSWORD = 'smoke-test-1';

/**
 * A game no earlier run has looked at, among the stand-in's: the time in milliseconds, which repeats
 * only after more than a day, by when the API's copy of that game is due to be asked for again anyway.
 */
function newGameId(): number {
    return GAMES.firstId + (Date.now() % 100_000_000);
}

test('a new account adds a game to a list, and it is still there after a reload', async ({ page }) => {
    // The browser talks to the stand-in for the edge and to nothing else, so no third party a page
    // loads from can make this test slow or flaky. The one that loads anything is Cloudflare, whose
    // Turnstile script on the sign-up form is stood in for, after the refusal so that it goes first.
    await page.context().route(url => url.origin !== SITE, route => route.abort('blockedbyclient'));
    await standInForTurnstile(page.context());

    const gameId = newGameId();

    // Rendered on the server, from the stand-in's game: the loader reaches the API directly.
    await page.goto(`/games/${gameId}`);
    await expect(page.getByRole('heading', { level: 1, name: GAMES.title })).toBeVisible();

    const userName = newUserName('e2e_');
    const email = `${userName}@test.local`;

    await test.step('sign up', async () => {
        // Shown once the page has hydrated and asked the API who is signed in, through the edge,
        // which is the first request ADR 0003's failure breaks.
        await page.getByRole('button', { name: 'Sign Up' }).click();

        const form = page.getByRole('dialog', { name: 'Create Account' });
        await form.getByLabel('Username').fill(userName);
        await form.getByLabel('Email').fill(email);
        await form.getByLabel('Password', { exact: true }).fill(PASSWORD);
        await form.getByLabel('Confirm Password').fill(PASSWORD);
        // Drawn with the site key the API handed the page, and passed (ADR 0092).
        await expect(form.getByText('Turnstile stand-in: passed')).toBeVisible();

        // The answer, not only the screen: a 405 is the SSR server answering for the API, a 429 the
        // sign-up limit, a 400 a name refused, and each would otherwise be the same ten-second wait
        // for a dialog that never changes.
        const registered = page.waitForResponse(response =>
            response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/auth/register');
        await form.getByRole('button', { name: 'Create Account' }).click();
        expect((await registered).status(), 'what the API answered the sign-up').toBe(200);

        // Nobody is signed in yet: the account waits for its confirmation (ADR 0089).
        await expect(page.getByRole('dialog', { name: 'Check your inbox' })).toBeVisible();
    });

    await test.step('confirm the address from the email, and sign in', async () => {
        // The link as the email has it, read from the API's outbox. The account and token are after its
        // `#`, which no request carries, so it is the page that posts them.
        const confirmed = page.waitForResponse(response =>
            response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/auth/confirm-email');
        await page.goto(confirmationLinkFor(outboxFor(PORTS), email));
        expect((await confirmed).status(), 'what the API answered the confirmation').toBe(204);
        await expect(page.getByText(/your email address is confirmed/i)).toBeVisible();

        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        const login = page.getByRole('dialog', { name: 'Sign In' });
        await login.getByLabel('Email or username').fill(userName);
        await login.getByLabel('Password').fill(PASSWORD);
        const signedIn = page.waitForResponse(response =>
            response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/auth/login');
        await login.getByRole('button', { name: 'Sign In', exact: true }).click();
        expect((await signedIn).status(), 'what the API answered the sign-in').toBe(200);

        await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    });

    await test.step('back to the game', async () => {
        await page.goto(`/games/${gameId}`);
        await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    });

    await test.step('add the game to Playing', async () => {
        // The hero's list control shows the move before the API has answered — the update is optimistic —
        // so the answer is what is waited for. A reload before it would race the write. A game in no list
        // offers the Backlog in one press and the other lists in a select beside it (ADR 0084).
        const saved = page.waitForResponse(response =>
            response.request().method() === 'PUT'
            && new URL(response.url()).pathname === `/api/lists/${gameId}`);
        await page.getByLabel('Add to another list').selectOption('playing');

        // The status says which part broke: a 401 is a lost cookie, a 403 a lost X-MVGL-Request, and
        // a 404 or a 405 the SSR server answering for the API.
        expect((await saved).status(), 'what the API answered the write').toBe(204);
    });

    await test.step('reload, and it is still there', async () => {
        // A new document, so nothing survives from the page that made the write but the session
        // cookie: what the page shows now is what the API stored.
        await page.reload();
        await expect(page.getByLabel('Your list')).toHaveValue('playing');

        // And on the list itself, which renders the game from the API's own copy of it, made when
        // the reload first asked for it.
        await page.goto('/lists');
        await expect(page.getByRole('link', { name: GAMES.title, exact: true })).toBeVisible();
    });
});
