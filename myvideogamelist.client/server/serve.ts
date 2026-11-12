import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { createRequestHandler } from '@react-router/express';
import compression from 'compression';
import express, { type Express } from 'express';
import morgan from 'morgan';
import type { ServerBuild } from 'react-router';

/**
 * The balancer's idle timeout: `IdleTimeout` in `infra/src/Infra/AppStack.cs`, how long it keeps a
 * connection to this server open with nothing on it. `serve.test.ts` reads that file and fails when the
 * two differ, so neither moves without the other.
 */
export const BALANCER_IDLE_TIMEOUT_MS = 60_000;

/**
 * How long this server keeps a connection open after its last response, waiting for the next request.
 * Longer than the balancer's, so that the balancer is always the side that closes an idle connection.
 * Node's default is five seconds. When this server closes first, the balancer can send a request down
 * the connection while the close is still on its way, and the viewer gets a 502 (ADR 0093).
 */
export const KEEP_ALIVE_TIMEOUT_MS = BALANCER_IDLE_TIMEOUT_MS + 5_000;

/**
 * How long a request's headers may take to arrive. Node 24 starts this clock at a request's first
 * bytes, so an idle connection never meets it. It is kept above the keep-alive anyway, as a guard
 * should that ever change: Node's default, sixty seconds, is below it.
 */
export const HEADERS_TIMEOUT_MS = KEEP_ALIVE_TIMEOUT_MS + 1_000;

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
    app.use(morgan('tiny'));
    app.all('/{*splat}', createRequestHandler({ build, mode: process.env.NODE_ENV }));

    return app;
}

/**
 * An HTTP server for the application with the timeouts above, listening on `port`, and on `host` when
 * one is given, every interface otherwise.
 */
export function listen(app: Express, port: number, host: string | undefined): Promise<Server> {
    const server = createServer(app);
    server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    server.headersTimeout = HEADERS_TIMEOUT_MS;

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
 * answering a request. Such a connection goes idle when it has answered, and would then stay open for
 * the whole keep-alive, which is longer than ECS waits after `SIGTERM` before it kills the task. So
 * every second until the last one has gone, the connections that have gone idle are ended too.
 */
export function close(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        const sweep = setInterval(() => server.closeIdleConnections(), CLOSE_SWEEP_MS);
        server.close(error => {
            clearInterval(sweep);
            if (error) reject(error);
            else resolve();
        });
    });
}
