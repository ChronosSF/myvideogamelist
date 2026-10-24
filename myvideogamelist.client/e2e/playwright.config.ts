import { defineConfig, devices } from '@playwright/test';
import { serversUnderTest } from './servers';
import { PORTS, SITE } from './stand-ins';

/**
 * The browser smoke test (#105, ADR 0060): sign up, add a game to a list, reload, and it is still
 * there. It runs the two-process shape that is deployed — the front end's production build under
 * `react-router-serve` and the API under `dotnet run`, processes that know nothing of each other — with
 * a stand-in in front of both for what routes between them, and one behind the API for IGDB.
 *
 * `npm run e2e` builds the front end and then runs this; `dotnet run` builds the API. PostgreSQL has
 * to be up already: `docker compose up -d --wait` here, a service container in CI. The API migrates its
 * own database as it starts, `mvgl_e2e` on that server — beside a developer's own `myvideogamelist`,
 * never in it — creating it on the first run; `E2E_CONNECTION_STRING` points it anywhere else. Each run
 * registers an account and looks at a game of its own, so the database is never reset, and no run reads
 * a row another left.
 */
const DATABASE = process.env.E2E_CONNECTION_STRING
    ?? 'Host=localhost;Port=5432;Database=mvgl_e2e;Username=mvgl;Password=localdev';

export default defineConfig({
    testDir: '.',
    testMatch: '*.e2e.ts',
    outputDir: './test-results',
    // Starts the two stand-ins, once both servers below are answering.
    globalSetup: './stand-ins.ts',
    forbidOnly: !!process.env.CI,
    // None. The test either works or names the step that did not, and a retry would hide the second.
    // Repeating it is no soak test either, past ten: one invocation is one API process, every sign-up
    // reaches it from the stand-in's one address, and signing up is limited to ten an address in five
    // minutes (ADR 0033). Run it again instead.
    retries: 0,
    workers: 1,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: process.env.CI ? [['list'], ['github']] : 'list',
    use: {
        baseURL: SITE,
        // Kept only for a failure, and uploaded from CI as the job's artifact.
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: serversUnderTest(PORTS, { database: DATABASE }),
});
