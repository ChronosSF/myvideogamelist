import { expect, test, type Page } from '@playwright/test';
import { SIGNED_IN } from './sign-in';

/** The pages, signed out and signed in, by the name their screenshots go under. */
const SIGNED_OUT: [string, string][] = [
    ['home', '/'],
    ['games', '/games'],
    ['game', '/games/19560'],
    ['not-found', '/no-such-page'],
];

const SIGNED_IN_PAGES: [string, string][] = [
    ['home', '/'],
    ['games', '/games'],
    ['game', '/games/19560'],
    ['lists', '/lists'],
    ['wishlist', '/wishlist'],
    ['calendar', '/calendar'],
    ['calendar-later', '/calendar?month=2027-01'],
    ['news', '/news'],
    ['user', '/user'],
    ['import', '/import'],
];

/** Until nothing is still loading: the signed-in parts of a page fetch after it hydrates. */
async function settle(page: Page) {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
}

test.beforeEach(async ({ page }) => {
    // The home page's Play next picks a game at random. The same "random" every time picks the same game.
    await page.addInitScript(() => {
        Math.random = () => 0.42;
    });
});

test.describe('signed out', () => {
    for (const [name, path] of SIGNED_OUT) {
        test(name, async ({ page }) => {
            await page.goto(path);
            await settle(page);
            await expect(page).toHaveScreenshot(`out-${name}.png`, { fullPage: true });
        });
    }

    test('sign-in dialog', async ({ page }) => {
        await page.goto('/');
        await settle(page);
        await page.getByRole('button', { name: 'Sign In' }).click();
        await expect(page).toHaveScreenshot('out-sign-in.png');
    });
});

test.describe('signed in', () => {
    test.use({ storageState: SIGNED_IN });

    for (const [name, path] of SIGNED_IN_PAGES) {
        test(name, async ({ page }) => {
            await page.goto(path);
            await settle(page);
            await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
        });
    }

    test('user menu', async ({ page }) => {
        await page.goto('/games');
        await settle(page);
        await page.getByRole('button', { name: 'User menu' }).click();
        await expect(page).toHaveScreenshot('user-menu.png');
    });

    test('main menu', async ({ page, viewport }) => {
        test.skip((viewport?.width ?? 0) >= 768, 'The main menu is the navigation below md only.');
        await page.goto('/games');
        await settle(page);
        await page.getByRole('button', { name: 'Main menu' }).click();
        await expect(page).toHaveScreenshot('main-menu.png');
    });
});
