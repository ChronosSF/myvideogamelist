import { defineConfig } from '@playwright/test';

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
 * Signed in as `VISUAL_EMAIL` and `VISUAL_PASSWORD`, a seeded `@test.local` account
 * (`scripts/seed-demo-history.mjs`). Pinned to the version whose browsers are installed, since
 * `npx playwright install` is a download nothing else here needs.
 */
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
        // mixed one way rather than another shows up as noise.
        toHaveScreenshot: { maxDiffPixels: 0, threshold: 0.02, animations: 'disabled', caret: 'hide' },
    },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
        { name: 'phone', use: { viewport: { width: 375, height: 812 } } },
    ],
});
