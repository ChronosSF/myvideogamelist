import { expect, test, type Page } from '@playwright/test';
import { newUserName, WRITE } from './accounts';
import { confirmationIn, confirmationLinkFor, outboxFor, resetLinkFor } from './outbox';
import { PORTS, SITE } from './stand-ins';

/** What the account is made with, and what the reset replaces it with: a digit, lower case, eight or more. */
const PASSWORD = 'reset-test-1';
const CHOSEN = 'reset-test-2';

/** The API's answer to the next `POST` to `path`, so that a step fails on what it said, not on a wait. */
function answerTo(page: Page, path: string) {
    return page.waitForResponse(response =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === path);
}

/**
 * A forgotten password, end to end (ADR 0090): asked for from the sign-in dialog, the link read from the
 * API's outbox as the email has it, a new password set on the page it opens, and a sign-in with it.
 *
 * Beside the smoke test rather than in it, so that each says which of the two broke. Every request
 * reaches the API from the edge stand-in's one address, so the two share the ten auth writes the limiter
 * allows it in five minutes (ADR 0033): the smoke test spends two, and this four.
 */
test('a forgotten password is reset from the email, and the new one signs in', async ({ page }) => {
    await page.context().route(url => url.origin !== SITE, route => route.abort('blockedbyclient'));

    const userName = newUserName('pwr_');
    const email = `${userName}@test.local`;
    const outbox = outboxFor(PORTS);

    await test.step('an account, confirmed, through the API', async () => {
        // The sign-up dialog is the smoke test's. This one starts from an account that already exists.
        const registered = await page.request.post('/api/auth/register', {
            headers: WRITE,
            data: { email, password: PASSWORD, userName },
        });
        expect(registered.status(), 'what the API answered the sign-up').toBe(200);

        const confirmed = await page.request.post('/api/auth/confirm-email', {
            headers: WRITE,
            data: confirmationIn(confirmationLinkFor(outbox, email)),
        });
        expect(confirmed.status(), 'what the API answered the confirmation').toBe(204);
    });

    await test.step('ask for a link from the sign-in dialog', async () => {
        await page.goto('/');
        await page.getByRole('button', { name: 'Sign In', exact: true }).click();

        const login = page.getByRole('dialog', { name: 'Sign In' });
        await login.getByLabel('Email or username').fill(userName);
        await login.getByRole('button', { name: 'Forgot password?' }).click();

        // What was typed comes along, so it is not typed twice.
        const forgot = page.getByRole('dialog', { name: 'Forgot your password?' });
        await expect(forgot.getByLabel('Email or username')).toHaveValue(userName);

        const requested = answerTo(page, '/api/auth/forgot-password');
        await forgot.getByRole('button', { name: 'Send the link' }).click();
        expect((await requested).status(), 'what the API answered the request').toBe(202);
        await expect(page.getByRole('dialog', { name: 'Check your inbox' })).toBeVisible();
    });

    await test.step('set a new password on the page the link opens', async () => {
        await page.goto(resetLinkFor(outbox, email));

        // Out of the address bar before anything is typed: a link left in the history sets the password.
        await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
        await expect(page).toHaveURL(`${SITE}/reset-password`);

        await page.getByLabel('New password', { exact: true }).fill(CHOSEN);
        await page.getByLabel('Confirm new password', { exact: true }).fill(CHOSEN);
        const reset = answerTo(page, '/api/auth/reset-password');
        await page.getByRole('button', { name: 'Set the new password' }).click();
        expect((await reset).status(), 'what the API answered the reset').toBe(204);
        await expect(page.getByText(/your password is changed/i)).toBeVisible();
    });

    await test.step('sign in with the new password', async () => {
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        const login = page.getByRole('dialog', { name: 'Sign In' });
        await login.getByLabel('Email or username').fill(userName);
        await login.getByLabel('Password', { exact: true }).fill(CHOSEN);

        const signedIn = answerTo(page, '/api/auth/login');
        await login.getByRole('button', { name: 'Sign In', exact: true }).click();
        expect((await signedIn).status(), 'what the API answered the sign-in').toBe(200);

        await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    });
});
