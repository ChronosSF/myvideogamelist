/**
 * The SSR server, `node server/index.ts`: what the image runs, and `npm start`, `npm run e2e` and the
 * Lighthouse audit with it. Node runs this TypeScript itself, by stripping the types, so nothing is
 * compiled for it and it sits outside the build (ADR 0093).
 *
 * `PORT` is the port, 3000 when it is unset. `HOST` is the address to listen on, every interface when
 * it is unset, which is what the balancer needs.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ServerBuild } from 'react-router';

// Before anything loads React, whose entry picks its production or its development build by this, as
// react-router-serve's own entry does. The image and both harnesses set it already; `npm start` may not.
process.env.NODE_ENV ??= 'production';

const { close, createApp, listen } = await import('./serve.ts');

/** The client's directory, which the build's own paths are relative to, wherever this is started from. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const build: ServerBuild = await import(pathToFileURL(path.join(ROOT, 'build/server/index.js')).href);
const app = createApp(build, path.resolve(ROOT, build.assetsBuildDirectory));

const port = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
if (!Number.isInteger(port)) throw new Error(`PORT is not a port number: ${process.env.PORT}`);
const host = process.env.HOST || undefined;

const server = await listen(app, port, host);
console.log(`[ssr] listening on http://${host ?? 'localhost'}:${port}`);

// ECS stops a task with SIGTERM, and Ctrl+C is SIGINT. Closing the listener lets the process end on its
// own once its connections have, rather than at the kill that follows thirty seconds later.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
        close(server).catch((error: unknown) => console.error(error));
    });
}
