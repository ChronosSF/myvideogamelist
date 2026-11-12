// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type IncomingMessage, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { ServerBuild } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import {
    balancerIdleTimeoutMs,
    close,
    createApp,
    headersTimeoutMs,
    keepAliveTimeoutMs,
    listen,
} from './serve.ts';

/**
 * The SSR server's keep-alive against the balancer's idle timeout (ADR 0093). CI's Images job asks the
 * built image the same questions over the wire: whether it refuses to start without the timeout, and
 * what keep-alive it announces with one.
 */

/** The balancer's idle timeout the tests give the server: the App stack's today, though any would do. */
const BALANCER = 60_000;

let running: Server | undefined;

afterEach(async () => {
    if (running?.listening) {
        running.closeAllConnections();
        await close(running);
    }
    running = undefined;
});

async function serve(app: express.Express): Promise<string> {
    running = await listen(app, { port: 0, host: '127.0.0.1', balancerIdleTimeout: BALANCER });
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

describe('the balancer idle timeout', () => {
    it('is read as a whole number of seconds', () => {
        expect(balancerIdleTimeoutMs('60')).toBe(60_000);
        expect(balancerIdleTimeoutMs('1')).toBe(1_000);
        expect(balancerIdleTimeoutMs('4000')).toBe(4_000_000);
    });

    it.each([
        ['unset', undefined],
        ['empty', ''],
        ['blank', '  '],
        ['not a number', 'sixty'],
        ['not whole', '60.5'],
        ['zero', '0'],
        ['negative', '-60'],
        ['past what a balancer allows', '4001'],
    ])('stops the server starting when %s', (_case, value) => {
        expect(() => balancerIdleTimeoutMs(value)).toThrow(/BALANCER_IDLE_TIMEOUT_SECONDS/);
    });
});

describe('the keep-alive', () => {
    it.each([1_000, 60_000, 4_000_000])('outlasts a balancer of %i ms, and the headers timeout outlasts it', balancer => {
        const keepAlive = keepAliveTimeoutMs(balancer);

        expect(keepAlive).toBeGreaterThan(balancer);
        expect(headersTimeoutMs(keepAlive)).toBeGreaterThan(keepAlive);
    });

    it('is what a listening server keeps, and what it tells the client', async () => {
        const app = express();
        app.get('/', (_req, res) => {
            res.send('ok');
        });
        const origin = await serve(app);

        expect(running?.keepAliveTimeout).toBe(keepAliveTimeoutMs(BALANCER));
        expect(running?.headersTimeout).toBe(headersTimeoutMs(keepAliveTimeoutMs(BALANCER)));

        const response = await get(origin);
        expect(response.headers.connection).toBe('keep-alive');
        expect(response.headers['keep-alive']).toBe(`timeout=${keepAliveTimeoutMs(BALANCER) / 1_000}`);
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
