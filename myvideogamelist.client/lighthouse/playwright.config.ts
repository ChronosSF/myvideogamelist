import { defineConfig } from '@playwright/test';
import { serversUnderTest } from '../e2e/servers';
import { PORTS, SITE } from './harness';

/**
 * The Lighthouse audit (ADR 0068): the production build and the API, run as they are deployed behind a
 * stand-in for the distribution (ADR 0060), audited by Lighthouse CI page by page on a phone and on a
 * desktop. Playwright runs it because Playwright already runs this harness: it starts both servers, the
 * global setup starts the stand-ins, and the one test seeds an account and drives `lhci`.
 *
 * `npm run lighthouse` builds the front end and runs this. PostgreSQL has to be up already, as for the
 * smoke test. The API migrates `mvgl_lighthouse`, creating it on the first run; set
 * `LIGHTHOUSE_CONNECTION_STRING` to use another database. Each run registers an account of its own, so
 * the database is never reset.
 */
const DATABASE = process.env.LIGHTHOUSE_CONNECTION_STRING
    ?? 'Host=localhost;Port=5432;Database=mvgl_lighthouse;Username=mvgl;Password=localdev';

export default defineConfig({
    testDir: '.',
    testMatch: '*.lh.ts',
    outputDir: './test-results',
    // Starts the two stand-ins, once both servers below are answering.
    globalSetup: './harness.ts',
    forbidOnly: !!process.env.CI,
    // None: Lighthouse CI already runs every page three times and judges the median.
    retries: 0,
    workers: 1,
    reporter: process.env.CI ? [['list'], ['github']] : 'list',
    use: { baseURL: SITE },
    // The front end is told the browser's origin is the public one, as production is, so that it does
    // not say noindex on every page and a canonical URL names the page it is on (ADR 0036).
    webServer: serversUnderTest(PORTS, { database: DATABASE, site: SITE }),
});
