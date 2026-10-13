import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ACCOUNT, SIGNED_IN } from './sign-in';

/** The pages, signed out and signed in, by the name their screenshots go under. */
const SIGNED_OUT: [string, string][] = [
    ['home', '/'],
    ['games', '/games'],
    ['game', '/games/19560'],
    // Baldur's Gate 3, for the multiplayer section God of War does not have.
    ['game-multiplayer', '/games/119171'],
    ['news', '/news'],
    ['terms', '/terms'],
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

    test('sign-up dialog', async ({ page }) => {
        await page.goto('/');
        await settle(page);
        await page.getByRole('button', { name: 'Sign Up' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page).toHaveScreenshot('out-sign-up.png');
    });

    test('profile', async ({ page }) => {
        // The signed-in account's own, as anybody else sees it.
        const { userName, profileVisibility } = JSON.parse(readFileSync(ACCOUNT, 'utf8')) as { userName: string; profileVisibility: string };
        test.skip(profileVisibility !== 'public', 'The account\'s profile is private, so nobody else has a page to see.');
        await page.goto(`/u/${userName}`);
        await settle(page);
        await expect(page).toHaveScreenshot('out-profile.png', { fullPage: true });
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

    test('game card under the pointer', async ({ page }) => {
        await page.goto('/games');
        await settle(page);
        const card = page.getByRole('article').first();
        await card.hover();
        await expect(card).toHaveScreenshot('games-card-hover.png');
    });

    test('lists filter', async ({ page }) => {
        await page.goto('/lists');
        await settle(page);
        const filter = page.getByRole('button', { name: 'All platforms' });
        test.skip(await filter.count() === 0, 'The list the page opens on has games on one platform at most, so no filter.');
        await filter.click();
        // One platform unticked, so the filter's pressed state shows beside its open panel. Nothing is saved.
        await page.locator('.list-toolbar-panel').getByRole('checkbox').first().uncheck();
        await expect(page).toHaveScreenshot('lists-filter.png');
    });

    test('username form', async ({ page }) => {
        await page.goto('/user');
        await settle(page);
        await page.getByRole('button', { name: 'Change' }).click();
        await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
        await expect(page).toHaveScreenshot('user-renaming.png', { fullPage: true });
    });

    test('delete-account dialog', async ({ page }) => {
        // Opened only: it asks for the password before anything is deleted, and nothing is typed.
        await page.goto('/user');
        await settle(page);
        await page.getByRole('button', { name: 'Delete my account' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page).toHaveScreenshot('delete-account.png');
    });
});
