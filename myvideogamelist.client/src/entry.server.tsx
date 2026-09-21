import { PassThrough } from 'node:stream';

import type { EntryContext, RouterContextProvider } from 'react-router';
import { createReadableStreamFromReadable } from '@react-router/node';
import { ServerRouter } from 'react-router';
import { isbot } from 'isbot';
import type { RenderToPipeableStreamOptions } from 'react-dom/server';
import { renderToPipeableStream } from 'react-dom/server';

import { applySecurityHeaders } from '@/lib/securityHeaders';
import { applyIndexingHeaders } from '@/lib/seo';

/**
 * The server entry, which React Router generates unless the app provides one.
 *
 * It is owned here for one reason: it is the only place every document response passes through.
 * A route's `headers` export is bypassed by a thrown `Response`, so the 404s and the 502s — the
 * responses most worth being careful with — would go out bare. Everything below except the two
 * `apply…Headers` calls is `react-router reveal`'s output verbatim, reformatted to this
 * codebase's style: re-run that command on a React Router major and diff it against this file.
 */

export const streamTimeout = 5_000;

export default function handleRequest(
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    routerContext: EntryContext,
    // Unused, and named for the linter rather than dropped: it is positional, and the next
    // person to need it should find it where React Router's own template has it.
    _loadContext: RouterContextProvider,
) {
    // Before either response is built below, so a HEAD, a streamed page and an error boundary
    // all carry them.
    applySecurityHeaders(responseHeaders);

    // `noindex` on everything, from any deployment that has not been told it is the one to index.
    // Here for the reason the security headers are: a staging site's 404s are as indexable as its
    // pages, and no route's `meta` reaches those.
    applyIndexingHeaders(responseHeaders);

    // https://httpwg.org/specs/rfc9110.html#HEAD
    if (request.method.toUpperCase() === 'HEAD') {
        return new Response(null, {
            status: responseStatusCode,
            headers: responseHeaders,
        });
    }

    return new Promise((resolve, reject) => {
        let shellRendered = false;
        const userAgent = request.headers.get('user-agent');

        // Ensure requests from bots and SPA Mode renders wait for all content to load before
        // responding
        // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
        const readyOption: keyof RenderToPipeableStreamOptions =
            (userAgent && isbot(userAgent)) || routerContext.isSpaMode
                ? 'onAllReady'
                : 'onShellReady';

        // Abort the rendering stream after the `streamTimeout` so it has time to
        // flush down the rejected boundaries
        let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
            () => abort(),
            streamTimeout + 1000,
        );

        const { pipe, abort } = renderToPipeableStream(
            <ServerRouter context={routerContext} url={request.url} />,
            {
                [readyOption]() {
                    shellRendered = true;
                    const body = new PassThrough({
                        final(callback) {
                            // Clear the timeout to prevent retaining the closure and memory leak
                            clearTimeout(timeoutId);
                            timeoutId = undefined;
                            callback();
                        },
                    });
                    const stream = createReadableStreamFromReadable(body);

                    responseHeaders.set('Content-Type', 'text/html');

                    pipe(body);

                    resolve(
                        new Response(stream, {
                            headers: responseHeaders,
                            status: responseStatusCode,
                        }),
                    );
                },
                onShellError(error: unknown) {
                    reject(error);
                },
                onError(error: unknown) {
                    responseStatusCode = 500;
                    // Log streaming rendering errors from inside the shell.  Don't log
                    // errors encountered during initial shell rendering since they'll
                    // reject and get logged in handleDocumentRequest.
                    if (shellRendered) {
                        console.error(error);
                    }
                },
            },
        );
    });
}
