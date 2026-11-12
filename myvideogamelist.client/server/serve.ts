import { createServer, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { createRequestHandler } from '@react-router/express';
import compression from 'compression';
import express, { type Express, type Request, type Response } from 'express';
import morgan from 'morgan';
import type { ServerBuild } from 'react-router';

/**
 * The variable that tells this server how long the balancer keeps an idle connection open, in seconds.
 * The App stack sets it from the same constant it gives the balancer (`BalancerIdleTimeoutSeconds` in
 * `infra/src/Infra/AppStack.cs`), so the two cannot disagree when deployed (ADR 0093).
 */
export const BALANCER_IDLE_TIMEOUT_VARIABLE = 'BALANCER_IDLE_TIMEOUT_SECONDS';

/** The range a balancer's idle timeout can take, in seconds, as AWS states it. */
const BALANCER_IDLE_TIMEOUT_RANGE = { min: 1, max: 4_000 };

/**
 * The balancer's idle timeout, in milliseconds, from the variable's value. There is no default: a server
 * started without it does not start, so that a misspelt name fails the deploy that brought it, which the
 * circuit breaker rolls back, rather than leaving the server on a guess that the balancer may outgrow.
 */
export function balancerIdleTimeoutMs(value: string | undefined): number {
    const seconds = Number(value);
    if (
        value === undefined ||
        value.trim() === '' ||
        !Number.isInteger(seconds) ||
        seconds < BALANCER_IDLE_TIMEOUT_RANGE.min ||
        seconds > BALANCER_IDLE_TIMEOUT_RANGE.max
    ) {
        throw new Error(
            `${BALANCER_IDLE_TIMEOUT_VARIABLE} has to be the balancer's idle timeout, a whole number of seconds ` +
                `from ${BALANCER_IDLE_TIMEOUT_RANGE.min} to ${BALANCER_IDLE_TIMEOUT_RANGE.max}, and is ` +
                `${value === undefined ? 'unset' : `"${value}"`} (ADR 0093).`,
        );
    }
    return seconds * 1_000;
}

/**
 * How long this server keeps a connection open after its last response, waiting for the next request:
 * five seconds longer than the balancer, so that the balancer is always the side that closes an idle
 * connection. Node's default is five seconds. When this server closes first, the balancer can send a
 * request down the connection while the close is still on its way, and the viewer gets a 502.
 */
export function keepAliveTimeoutMs(balancerIdleTimeout: number): number {
    return balancerIdleTimeout + 5_000;
}

/**
 * How long a request's headers may take to arrive. Node 24 starts this clock at a request's first
 * bytes, so an idle connection never meets it. It is kept above the keep-alive anyway, as a guard
 * should that ever change: Node's default, sixty seconds, is below it.
 */
export function headersTimeoutMs(keepAliveTimeout: number): number {
    return keepAliveTimeout + 1_000;
}

/** How often a closing server ends the connections that have finished their last response. */
const CLOSE_SWEEP_MS = 1_000;

/**
 * The application. These are the pieces `react-router-serve` 8.5 assembles, in the same order, so the
 * files, their headers and the log are what they were (ADR 0093).
 *
 * `assetsDirectory` is where the build put the browser's files, `build/client`.
 */
export function createApp(build: ServerBuild, assetsDirectory: string): Express {
    const app = express();
    app.disable('x-powered-by');
    app.use(compression());

    // The hashed bundles, whose names change whenever their contents do: immutable for a year, which
    // the distribution's cache behaviour for /assets/* relies on (infra/src/Infra/Edge.cs).
    app.use(path.posix.join(build.publicPath, 'assets'), express.static(path.join(assetsDirectory, 'assets'), {
        immutable: true,
        maxAge: '1y',
    }));
    // Everything else in build/client: what Vite copied from public/, with Express's default policy.
    // react-router-serve also served ./public itself, for an hour, behind this. The image has no
    // public/, and Vite has already copied every file in it here, so nothing ever reached that.
    app.use(build.publicPath, express.static(assetsDirectory));
    // Express's static files ignore a path with any part that starts with a dot, so this directory is
    // a root of its own, where its name is not part of the path.
    app.use('/.well-known', express.static(path.join(assetsDirectory, '.well-known')));

    // One line per request that reaches the application. The static files above are not logged.
    app.use(requestLog());
    app.all('/{*splat}', createRequestHandler({ build, mode: process.env.NODE_ENV }));

    return app;
}

/**
 * A request's path, for the log, and never its query string: that holds whatever somebody typed into a
 * search, an email address included (ADR 0059). `originalUrl`, because Express rewrites `url` under a mount.
 */
morgan.token<Request, Response>('path', request => request.originalUrl.split('?', 1)[0]);

/**
 * One line per request: morgan's `tiny`, which `react-router-serve` logged, with the path where `tiny` has
 * the whole URL (ADR 0093).
 */
export function requestLog(stream: { write(line: string): void } = process.stdout) {
    return morgan<Request, Response>(':method :path :status :res[content-length] - :response-time ms', { stream });
}

/** Where the server listens, and the balancer in front of it. */
export interface ListenOptions {
    port: number;
    /** The address to listen on; every interface when undefined. */
    host: string | undefined;
    /** The balancer's idle timeout, in milliseconds, which the server's keep-alive has to outlast. */
    balancerIdleTimeout: number;
}

/** What `close` needs to know of a server `listen` started. */
interface Shutdown {
    closing: boolean;
    /** The responses not yet closed, so that closing can reach the ones whose headers are not out. */
    underWay: Set<ServerResponse>;
}

const shutdowns = new WeakMap<Server, Shutdown>();

/**
 * Makes a response the last on its connection, if its headers are not out yet: Node then ends the
 * connection once it has answered, and the client, told so, sends nothing more down it. Once the headers
 * are out, they have already promised the client the connection.
 */
function lastOnItsConnection(response: ServerResponse): void {
    if (!response.headersSent) response.setHeader('Connection', 'close');
}

/** An HTTP server for the application with the timeouts above, listening. */
export function listen(app: Express, { port, host, balancerIdleTimeout }: ListenOptions): Promise<Server> {
    const server = createServer();
    server.keepAliveTimeout = keepAliveTimeoutMs(balancerIdleTimeout);
    server.headersTimeout = headersTimeoutMs(server.keepAliveTimeout);

    const shutdown: Shutdown = { closing: false, underWay: new Set() };
    shutdowns.set(server, shutdown);
    // Before the application, so that a request reaching a closing server is answered as the last on its
    // connection whatever the application writes first.
    server.on('request', (_request, response: ServerResponse) => {
        if (shutdown.closing) lastOnItsConnection(response);
        shutdown.underWay.add(response);
        response.once('close', () => {
            shutdown.underWay.delete(response);
            // Its connection has just gone idle. Ended now, not at the next sweep: a response whose
            // headers promised the client the connection leaves it free to send on it at any moment.
            if (shutdown.closing) server.closeIdleConnections();
        });
    });
    server.on('request', app);

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ port, host }, () => {
            server.off('error', reject);
            resolve(server);
        });
    });
}

/**
 * Stops listening, and settles once every connection has ended.
 *
 * `server.close()` ends the connections that are idle at that moment, and leaves alone any still
 * answering a request. Left at that, such a connection would answer with a promise to stay open, go idle,
 * and then either stay open for the whole keep-alive, which is longer than ECS waits after `SIGTERM`
 * before it kills the task, or be ended by a sweep just as the client sends its next request down it,
 * which is the 502 this server's keep-alive exists to prevent (ADR 0093). So:
 *
 * - a response whose headers are not out yet, or that starts after this, says `Connection: close`, and
 *   Node ends its connection once it has answered;
 * - a response whose headers are already out has its connection ended the moment it finishes (in
 *   `listen`), the least that can be done once a header has promised otherwise;
 * - and every second until the last connection has gone, whatever has gone idle any other way is ended.
 */
export function close(server: Server): Promise<void> {
    const shutdown = shutdowns.get(server);
    if (shutdown !== undefined) {
        shutdown.closing = true;
        for (const response of shutdown.underWay) lastOnItsConnection(response);
    }

    return new Promise((resolve, reject) => {
        const sweep = setInterval(() => server.closeIdleConnections(), CLOSE_SWEEP_MS);
        server.close(error => {
            clearInterval(sweep);
            if (error) reject(error);
            else resolve();
        });
    });
}
