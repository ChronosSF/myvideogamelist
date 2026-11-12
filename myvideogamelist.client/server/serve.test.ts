// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request, type IncomingMessage, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { ServerBuild } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import {
    BALANCER_IDLE_TIMEOUT_MS,
    close,
    createApp,
    HEADERS_TIMEOUT_MS,
    KEEP_ALIVE_TIMEOUT_MS,
    listen,
} from './serve.ts';

/**
 * The SSR server's keep-alive against the balancer's idle timeout (ADR 0093). CI's Images job asks the
 * built image the same question over the wire.
 */

let running: Server | undefined;

afterEach(async () => {
    if (running?.listening) {
        running.closeAllConnections();
        await close(running);
    }
    running = undefined;
});

async function serve(app: express.Express): Promise<string> {
    running = await listen(app, 0, '127.0.0.1');
    return `http://127.0.0.1:${(running.address() as AddressInfo).port}`;
}

function get(url: string, headers: Record<string, string> = {}): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
        request(url, { headers }, response => {
            response.resume();
            resolve(response);
        }).on('error', reject).end();
    });
}

describe('the keep-alive', () => {
    it('assumes the balancer idle timeout infra/src/Infra/AppStack.cs gives it', () => {
        const stack = readFileSync(new URL('../../infra/src/Infra/AppStack.cs', import.meta.url), 'utf8');
        const seconds = /IdleTimeout = Duration\.Seconds\((\d+)\)/.exec(stack)?.[1];

        expect(seconds, 'no IdleTimeout in AppStack.cs').toBeDefined();
        expect(Number(seconds) * 1_000).toBe(BALANCER_IDLE_TIMEOUT_MS);
    });

    it('outlasts the balancer, and the headers timeout outlasts the keep-alive', () => {
        expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(BALANCER_IDLE_TIMEOUT_MS);
        expect(HEADERS_TIMEOUT_MS).toBeGreaterThan(KEEP_ALIVE_TIMEOUT_MS);
    });

    it('is what a listening server keeps, and what it tells the client', async () => {
        const app = express();
        app.get('/', (_req, res) => {
            res.send('ok');
        });
        const origin = await serve(app);

        expect(running?.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
        expect(running?.headersTimeout).toBe(HEADERS_TIMEOUT_MS);

        const response = await get(origin);
        expect(response.headers.connection).toBe('keep-alive');
        expect(response.headers['keep-alive']).toBe(`timeout=${KEEP_ALIVE_TIMEOUT_MS / 1_000}`);
    });
});

describe('close', () => {
    it('ends a connection that was answering a request once it has answered, not a keep-alive later', async () => {
        const app = express();
        app.get('/slow', (_req, res) => {
            setTimeout(() => res.send('done'), 200);
        });
        const origin = await serve(app);
        const server = running as Server;
        const { port } = new URL(origin);

        const socket = connect(Number(port), '127.0.0.1');
        const answered = new Promise<number>(resolve => socket.once('data', () => resolve(Date.now())));
        const ended = new Promise<number>(resolve => socket.once('close', () => resolve(Date.now())));
        await new Promise<void>(resolve => socket.once('connect', resolve));
        socket.write('GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\n');

        // Mid-response: close() leaves this connection alone, and it is still open when the answer comes.
        await new Promise(resolve => setTimeout(resolve, 50));
        const closed = close(server);

        const [answeredAt, endedAt] = await Promise.all([answered, ended]);
        await closed;
        expect(endedAt - answeredAt).toBeLessThan(2_000);
    });
});

describe('createApp', () => {
    let root: string | undefined;

    afterEach(() => {
        if (root !== undefined) rmSync(root, { recursive: true, force: true });
        root = undefined;
    });

    /** The browser's files as the build lays them out. The tests here never reach the build itself. */
    async function serveFiles(): Promise<string> {
        root = mkdtempSync(path.join(tmpdir(), 'mvgl-serve-'));
        mkdirSync(path.join(root, 'assets'));
        mkdirSync(path.join(root, '.well-known'));
        writeFileSync(path.join(root, 'assets', 'entry-abc123.js'), 'export {};'.repeat(200));
        writeFileSync(path.join(root, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
        writeFileSync(path.join(root, '.well-known', 'security.txt'), 'Contact: mailto:nobody@example.invalid');
        return serve(createApp({ publicPath: '/' } as ServerBuild, root));
    }

    it('sends the hashed bundles immutable for a year, compressed', async () => {
        const origin = await serveFiles();

        const response = await get(`${origin}/assets/entry-abc123.js`, { 'Accept-Encoding': 'gzip' });

        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(response.headers['content-encoding']).toBe('gzip');
        expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('sends the other files with no lifetime, and .well-known from a root of its own', async () => {
        const origin = await serveFiles();

        const favicon = await get(`${origin}/favicon.svg`);
        const wellKnown = await get(`${origin}/.well-known/security.txt`);

        expect(favicon.statusCode).toBe(200);
        expect(favicon.headers['cache-control']).toBe('public, max-age=0');
        expect(wellKnown.statusCode).toBe(200);
    });
});
