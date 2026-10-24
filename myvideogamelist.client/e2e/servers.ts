import { fileURLToPath } from 'node:url';
import type { PlaywrightTestConfig } from '@playwright/test';
import { IGDB_CLIENT, loopback, type HarnessPorts } from './stand-ins';

/** Resolved from this file, so that a config anywhere can start the servers. */
const API_PROJECT = fileURLToPath(new URL('../../MyVideoGameList.Server', import.meta.url));
const CLIENT = fileURLToPath(new URL('..', import.meta.url));

/**
 * What Development would log at Information and a failed run's log is better without: every SQL
 * statement, and each IGDB call five times over. Arguments rather than environment variables, because a
 * name with dots in it does not survive the shell the API is started through on Linux.
 */
const QUIETER = ['Microsoft.EntityFrameworkCore.Database.Command', 'System.Net.Http.HttpClient', 'Polly']
    .map(category => `--Logging:LogLevel:${category}=Warning`)
    .join(' ');

/**
 * The two servers under test, started as they are deployed (ADR 0060 §1): the API under `dotnet run`,
 * and the front end's production build under `react-router-serve`, two processes that know nothing of
 * each other. Playwright starts both, waits until each answers, and stops both afterwards. The smoke
 * test and the Lighthouse audit (ADR 0068) start them the same way, each on its own ports and database.
 *
 * `site` is the origin the browser opens, given to the front end as `SITE_URL` with `SITE_INDEXABLE`
 * set, as a production deployment sets both (ADR 0036). Without it the front end says `noindex` on
 * every response, which the smoke test does not mind and an audit of what a crawler is told would.
 */
export function serversUnderTest(
    ports: HarnessPorts,
    { database, site }: { database: string; site?: string },
): NonNullable<PlaywrightTestConfig['webServer']> {
    const api = loopback(ports.api);
    const igdb = loopback(ports.igdb);

    return [
        {
            name: 'API',
            // In CI the job has built the API in the step before. Anywhere else this builds it first, so
            // a run never tests an API older than its sources.
            command: `dotnet run --no-launch-profile${process.env.CI ? ' --no-build' : ''} -- ${QUIETER}`,
            cwd: API_PROJECT,
            // Liveness, which asks nothing of IGDB. It answers once the migrations have run.
            url: `${api}/healthz`,
            // A build, when the API's sources have changed since the last one, and the migrations.
            timeout: 180_000,
            reuseExistingServer: false,
            stdout: 'pipe',
            env: {
                // Development, unlike anything deployed (ADR 0044), for the one thing it does that a
                // deployment's migration task does instead: the API migrates its own database as it
                // starts. ADR 0060 says what else Development changes, and why it is still this.
                ASPNETCORE_ENVIRONMENT: 'Development',
                ASPNETCORE_URLS: api,
                ConnectionStrings__DefaultConnection: database,
                // The stand-in, and credentials only it accepts. Development loads a developer's user
                // secrets, IGDB's real credentials among them, and these take precedence over them, so
                // those are never used and never sent anywhere.
                Igdb__BaseUrl: `${igdb}/v4`,
                Igdb__TokenUrl: `${igdb}/oauth2/token`,
                Igdb__ClientId: IGDB_CLIENT.id,
                Igdb__ClientSecret: IGDB_CLIENT.secret,
            },
        },
        {
            name: 'SSR',
            command: 'npx react-router-serve ./build/server/index.js',
            cwd: CLIENT,
            // A static file, so that being ready asks nothing of the API.
            url: `${loopback(ports.ssr)}/favicon.svg`,
            reuseExistingServer: false,
            stdout: 'pipe',
            env: {
                NODE_ENV: 'production',
                HOST: '127.0.0.1',
                PORT: String(ports.ssr),
                // Where the loaders reach the API: directly, as they do deployed, not through the
                // stand-in in front.
                API_BASE_URL: api,
                ...(site === undefined ? {} : { SITE_URL: site, SITE_INDEXABLE: 'true' }),
            },
        },
    ];
}
