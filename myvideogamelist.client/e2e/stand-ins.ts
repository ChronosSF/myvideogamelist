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
 * the two processes, the distribution that routes between them; behind the API, IGDB. Both run in the
 * test runner's own process, started before the test and stopped after it — the run's global setup —
 * while the API and the SSR server run as the processes they are when deployed (ADR 0060).
 */

/**
 * Fixed rather than picked by the system, because the API is told where IGDB is as it starts, before
 * these stand-ins exist. Each is checked to be free before anything starts — nothing already running
 * is reused, so a port somebody else holds fails the run rather than putting their server under test.
 * Clear of the 5039 and 58546 that `dotnet run` and `npm run dev` take.
 */
export const PORTS = { api: 5120, distribution: 58620, ssr: 58621, igdb: 58622 } as const;

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
 * The one game this IGDB knows. Its id is far past any real one, so it can never be mistaken for a
 * real game in a database a real IGDB has also written to.
 */
export const GAME = { id: 2_000_000_105, title: 'Smoke Test Quest' } as const;

/**
 * The game as IGDB sends one: snake_case, with only the fields this test reads. No cover, artwork or
 * video, so the browser is never sent to IGDB's image host or to YouTube.
 */
const GAME_ROW = {
    id: GAME.id,
    name: GAME.title,
    summary: 'A game that exists only in the smoke test, answered by its stand-in for IGDB.',
};

/**
 * Hop-by-hop headers, which describe one connection rather than the request, so a proxy does not pass
 * them on. Everything else is passed on, `Host` and cookies included, as the distribution forwards
 * every viewer header to the API.
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
 * The distribution's two behaviours (`infra/src/Infra/Edge.cs`, and the balancer's rules in
 * `AppStack.cs`): `/api/*` to the API, everything else to the SSR server. Nothing else of it — no
 * cache, no basic auth, no TLS — because the first behaviour is what ADR 0003's failure is about.
 * Without it the pages still render, since their loaders reach the API directly, and every request
 * the browser makes to the API 404s.
 */
function forwardAsTheDistribution(viewer: IncomingMessage, reply: ServerResponse) {
    const path = viewer.url ?? '/';
    const origin = new URL(path.startsWith('/api/') ? API : SSR);

    const forwarded = request(
        { host: origin.hostname, port: origin.port, method: viewer.method, path, headers: endToEnd(viewer.headers) },
        answer => {
            reply.writeHead(answer.statusCode ?? 502, answer.statusMessage, endToEndRaw(answer.rawHeaders));
            answer.pipe(reply);
        },
    );

    // An origin that cannot be reached is a 502, as CloudFront answers it.
    forwarded.on('error', () => {
        if (!reply.headersSent) reply.writeHead(502);
        reply.end();
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

/** Whether a query looks the game up by id: the game page's, and the game cache's for the lists. */
function namesTheGame(query: string): boolean {
    const ids = /where id = \(?([\d,]+)\)?;/.exec(query)?.[1];
    return ids !== undefined && ids.split(',').map(Number).includes(GAME.id);
}

/**
 * IGDB, as far as this test reaches it, at the two addresses the API is configured with: Twitch's
 * token endpoint, and the query endpoints under `/v4`. A query needs the token the stand-in issued.
 * It answers a lookup of its one game with that game, and everything else — a Steam id, completion
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

    json(reply, 200, endpoint === 'games' && namesTheGame(body) ? [GAME_ROW] : []);
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
        const distribution = await listen(createServer(forwardAsTheDistribution), PORTS.distribution);
        return async () => {
            await Promise.all([close(distribution), close(igdb)]);
        };
    } catch (error) {
        await close(igdb);
        throw error;
    }
}
