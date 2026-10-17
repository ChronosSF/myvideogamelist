import { defineConfig, devices } from '@playwright/test';
import { API, IGDB, IGDB_CLIENT, PORTS, SITE, SSR } from './stand-ins';

/**
 * The browser smoke test (#105, ADR 0060): sign up, add a game to a list, reload, and it is still
 * there. It runs the shape that is deployed — the front end's production build under
 * `react-router-serve` and the API under `dotnet run`, two processes that know nothing of each other —
 * with a stand-in for the distribution in front of both and one for IGDB behind the API.
 *
 * `npm run e2e` builds the front end and then runs this; `dotnet run` builds the API. PostgreSQL has
 * to be up already: `docker compose up -d --wait` here, a service container in CI. The API migrates its
 * own database as it starts, `mvgl_e2e` on that server, creating it on the first run; set
 * `E2E_CONNECTION_STRING` to use another. Each run registers an account of its own, so the database is
 * never reset, and nothing in it is read but what the run itself wrote.
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
    webServer: [
        {
            name: 'API',
            command: 'dotnet run --no-launch-profile',
            cwd: '../../MyVideoGameList.Server',
            // Liveness, which asks nothing of IGDB. It answers once the migrations have run.
            url: `${API}/healthz`,
            // A build, when the API's sources have changed since the last one, and the migrations.
            timeout: 180_000,
            reuseExistingServer: false,
            stdout: 'pipe',
            env: {
                // Development for the one thing it does that a deployment's migration task does
                // instead: the API migrates its own database as it starts. Plain HTTP, as the
                // balancer forwards it.
                ASPNETCORE_ENVIRONMENT: 'Development',
                ASPNETCORE_URLS: API,
                ConnectionStrings__DefaultConnection: DATABASE,
                // The stand-in, and credentials only it accepts. Development loads a developer's user
                // secrets, IGDB's real credentials among them, and these take precedence over them, so
                // those are never used and never sent anywhere.
                Igdb__BaseUrl: `${IGDB}/v4`,
                Igdb__TokenUrl: `${IGDB}/oauth2/token`,
                Igdb__ClientId: IGDB_CLIENT.id,
                Igdb__ClientSecret: IGDB_CLIENT.secret,
                // Development logs every SQL statement, and a failed run's log should be about the failure.
                'Logging__LogLevel__Microsoft.EntityFrameworkCore.Database.Command': 'Warning',
            },
        },
        {
            name: 'SSR',
            command: 'npx react-router-serve ./build/server/index.js',
            cwd: '..',
            // A static file, so that being ready asks nothing of the API.
            url: `${SSR}/favicon.svg`,
            reuseExistingServer: false,
            stdout: 'pipe',
            env: {
                NODE_ENV: 'production',
                HOST: '127.0.0.1',
                PORT: String(PORTS.ssr),
                // Where the loaders reach the API: directly, as they do deployed, not through the
                // distribution.
                API_BASE_URL: API,
            },
        },
    ],
});
