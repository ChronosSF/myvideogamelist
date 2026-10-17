import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * Before-and-after screenshots, for a change that should look the same or differ only where it says
 * (#209). Not something CI runs: it needs two dev servers and the data in them.
 *
 * 1. Serve master and the branch side by side: master from the main checkout as usual, the branch's
 *    client from a worktree on another port (`DEV_SERVER_PORT=58646`). Point both clients at the same
 *    API (`API_BASE_URL`), so both pages are drawn from the same answers.
 * 2. With `VISUAL_BASE_URL` at master: `npm run visual -- --update-snapshots`. That is the baseline.
 * 3. With `VISUAL_BASE_URL` at the branch: `npm run visual`. Every page that differs fails, and
 *    `npx playwright show-report visual/report` shows each difference beside the baseline.
 *
 * Signed in as `VISUAL_EMAIL` and `VISUAL_PASSWORD`, a local `@test.local` account with games in its
 * lists, its wishlist and its reviews. Set them in the shell, or keep them in `visual/.env`, one
 * `NAME=value` line each, which git ignores as it does every `.env`: then every run finds them and the
 * password never passes through a command line. A variable set in the shell wins over the file's.
 *
 * Pinned to the version whose browsers are installed, since `npx playwright install` is a download
 * to take on purpose. The smoke test in `e2e/` runs on the same version, and CI installs its browser
 * itself.
 */
try {
    process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url)));
} catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

export default defineConfig({
    testDir: '.',
    testMatch: '*.visual.ts',
    globalSetup: './sign-in.ts',
    snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
    outputDir: './test-results',
    reporter: [['list'], ['html', { outputFolder: './report', open: 'never' }]],
    // One at a time: the pages share an account and two dev servers, and nothing is gained by racing them.
    workers: 1,
    use: {
        baseURL: process.env.VISUAL_BASE_URL ?? 'https://localhost:58546',
        ignoreHTTPSErrors: true,
        reducedMotion: 'reduce',
    },
    expect: {
        // No pixel may differ by more than about five levels of grey. Playwright's own default lets a
        // grey move by fifty before a pixel counts, which would wave through a text colour changed for a
        // near neighbour, exactly what this exists to catch; any lower and the rounding of a colour
        // mixed one way rather than another shows up as noise. `screenshot.css` leaves out the one thing
        // that is drawn differently from one load to the next.
        toHaveScreenshot: {
            maxDiffPixels: 0,
            threshold: 0.02,
            animations: 'disabled',
            caret: 'hide',
            stylePath: fileURLToPath(new URL('./screenshot.css', import.meta.url)),
        },
    },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
        { name: 'phone', use: { viewport: { width: 375, height: 812 } } },
    ],
});
