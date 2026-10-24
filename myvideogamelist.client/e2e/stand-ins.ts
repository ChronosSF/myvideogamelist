import {
    createServer,
    request,
    type IncomingHttpHeaders,
    type IncomingMessage,
    type OutgoingHttpHeaders,
    type Server,
    type ServerResponse,
} from 'node:http';

/**
 * What surrounds the stack under test: the two things a runner cannot have, stood in for. In front of
 * the two processes, what routes between them when deployed, the distribution and the balancer behind
 * it; behind the API, IGDB. Both run in the test runner's own process as its global setup, which
 * Playwright starts once the two servers are answering and stops before it stops them. The API and the
 * SSR server are processes of their own, as they are deployed (ADR 0060).
 */

/**
 * Fixed rather than picked by the system, because the API is told where IGDB is as it starts, before
 * these stand-ins exist. Nothing already running is reused: Playwright refuses to start the run when
 * something answers on the API's or the SSR server's port, and the stand-ins' ports are taken by
 * listening on them, so one already in use fails the run when it reaches the global setup.
 *
 * Clear of `dotnet run` and `npm run dev` (5039, 58546) and of the ports a worktree previews on (5139,
 * 58646). And below 32768, out of the range Windows and Linux hand out for outgoing connections, where
 * Windows also reserves blocks of ports at boot for Hyper-V.
 */
export const PORTS = { api: 5180, igdb: 5181, ssr: 5182, distribution: 5183 } as const;

/**
 * Loopback by address rather than by name, so that nothing depends on which of IPv4 and IPv6 a name
 * resolves to first. The browser is the exception: it opens `localhost`, as an address bar would.
 */
const loopback = (port: number) => `http://127.0.0.1:${port}`;

export const API = loopback(PORTS.api);
export const SSR = loopback(PORTS.ssr);
export const IGDB = loopback(PORTS.igdb);
export const SITE = `http://localhost:${PORTS.distribution}`;

/** What the API is given to sign in to IGDB with. The stand-in accepts these and nothing else. */
export const IGDB_CLIENT = { id: 'smoke-test', secret: 'smoke-test-secret' } as const;

const TOKEN = 'smoke-test-token';

/**
 * The games this IGDB knows: every id from two billion up, each with the same title. That is far past
 * any real IGDB id, and still an `int` to the API. A run asks for an id no earlier run has, so the
 * API's own copy of a game an earlier run looked at (ADR 0035) can never answer for this one.
 */
export const GAMES = { firstId: 2_000_000_000, title: 'Smoke Test Quest' } as const;

/**
 * A game as IGDB sends one: snake_case, with only the fields this test reads, whatever fields a query
 * asks for. No cover, artwork or video, so the browser is never sent to IGDB's image host or to
 * YouTube.
 */
const gameRow = (id: number) => ({
    id,
    name: GAMES.title,
    summary: 'A game that exists only in the browser smoke test, answered by its stand-in for IGDB.',
});

/**
 * Hop-by-hop headers, which describe one connection rather than the request, so a proxy does not pass
 * them on. Everything else is passed on, `Host` and cookies included, as the distribution forwards
 * every viewer header on its way to the API.
 */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function endToEnd(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
    return Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name)));
}

/** The same for a response's raw headers, which keep every `Set-Cookie` as a header of its own. */
function endToEndRaw(raw: string[]): string[] {
    const kept: string[] = [];
    for (let i = 0; i < raw.length; i += 2) {
        if (!HOP_BY_HOP.has(raw[i].toLowerCase())) kept.push(raw[i], raw[i + 1]);
    }
    return kept;
}

/**
 * Where a request goes when deployed. The balancer routes (`infra/src/Infra/AppStack.cs`): `/api/*` to
 * the API and everything else to the SSR server, as its first and last rules do. The rule between them,
 * `/healthz` and `/readyz` to the API, is left out, since no page asks for either. In front of it the
 * distribution (`Edge.cs`) has one origin and decides what is cached and forwarded, and outside `/api/*`
 * it allows only GET and HEAD, so anything else there is refused here too. Nothing else of the two —
 * no cache, no basic auth, no TLS. The routing is what ADR 0003's failure is about: without it the pages
 * still render, since their loaders reach the API directly, and every request the browser makes to the
 * API fails on the SSR server, a read with a 404 and a write with a 405.
 */
function forwardAsTheEdge(viewer: IncomingMessage, reply: ServerResponse) {
    const path = viewer.url ?? '/';
    const toApi = path.startsWith('/api/');

    if (!toApi && viewer.method !== 'GET' && viewer.method !== 'HEAD') {
        reply.writeHead(403).end();
        return;
    }

    const origin = new URL(toApi ? API : SSR);
    const forwarded = request(
        { host: origin.hostname, port: origin.port, method: viewer.method, path, headers: endToEnd(viewer.headers) },
        answer => {
            reply.writeHead(answer.statusCode ?? 502, answer.statusMessage, endToEndRaw(answer.rawHeaders));
            // Either side going away mid-answer ends the other. The browser drops a page's requests
            // when it reloads, and the servers are stopped at the end of a run; unhandled, the error
            // an interrupted answer raises would fail a run whose test had passed.
            answer.on('error', () => reply.destroy());
            reply.on('close', () => answer.destroy());
            answer.pipe(reply);
        },
    );

    forwarded.on('error', () => {
        // Cut off mid-answer: destroyed rather than ended, so the browser cannot take half a body
        // for all of it. Not reached at all: a 502, as CloudFront answers an origin it cannot reach.
        if (reply.headersSent) reply.destroy();
        else reply.writeHead(502).end();
    });
    viewer.on('error', () => forwarded.destroy());
    viewer.pipe(forwarded);
}

async function readBody(message: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of message) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
}

function json(reply: ServerResponse, status: number, body: unknown) {
    reply.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

/**
 * The games a query looks up by id, among the ones this IGDB knows: the game page's lookup and the game
 * cache's, `where id = 2000000123;` and `where id = (2000000123,…);`.
 */
function gamesLookedUp(query: string): object[] {
    const ids = /where id = \(?([\d,]+)\)?;/.exec(query)?.[1].split(',').map(Number) ?? [];
    return ids.filter(id => id >= GAMES.firstId).map(gameRow);
}

/**
 * IGDB, as far as this test reaches it, at the two addresses the API is configured with: Twitch's
 * token endpoint, and the query endpoints under `/v4`. A query needs the token the stand-in issued.
 * It answers a lookup of its games with those games, and everything else — a Steam id, completion
 * times, a release date — with nothing, which is what IGDB says of a game it knows little about. So
 * no Steam id is found, and the API never asks Steam for news.
 */
async function answerAsIgdb(asked: IncomingMessage, reply: ServerResponse) {
    const body = await readBody(asked);
    const path = asked.url ?? '/';

    const refuse = (status: number, message: string) => {
        console.warn(`[IGDB stand-in] ${asked.method} ${path}: ${status} ${message}`);
        json(reply, status, { message });
    };

    if (asked.method === 'POST' && path === '/oauth2/token') {
        const form = new URLSearchParams(body);
        if (form.get('grant_type') !== 'client_credentials'
            || form.get('client_id') !== IGDB_CLIENT.id
            || form.get('client_secret') !== IGDB_CLIENT.secret) {
            return refuse(400, 'invalid client');
        }
        return json(reply, 200, { access_token: TOKEN, expires_in: 3600, token_type: 'bearer' });
    }

    const endpoint = asked.method === 'POST' ? /^\/v4\/(\w+)$/.exec(path)?.[1] : undefined;
    if (endpoint === undefined) return refuse(404, 'not an IGDB endpoint');

    if (asked.headers.authorization !== `Bearer ${TOKEN}` || asked.headers['client-id'] !== IGDB_CLIENT.id) {
        return refuse(401, 'not the token this stand-in issued');
    }

    json(reply, 200, endpoint === 'games' ? gamesLookedUp(body) : []);
}

function listen(server: Server, port: number): Promise<Server> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            server.off('error', reject);
            resolve(server);
        });
    });
}

function close(server: Server): Promise<void> {
    server.closeAllConnections();
    return new Promise(resolve => server.close(() => resolve()));
}

/** The run's global setup. What it returns is the run's teardown. */
export default async function startStandIns(): Promise<() => Promise<void>> {
    const igdb = await listen(
        createServer((asked, reply) => void answerAsIgdb(asked, reply).catch(() => reply.destroy())),
        PORTS.igdb,
    );

    try {
        const edge = await listen(createServer(forwardAsTheEdge), PORTS.distribution);
        return async () => {
            await Promise.all([close(edge), close(igdb)]);
        };
    } catch (error) {
        await close(igdb);
        throw error;
    }
}
