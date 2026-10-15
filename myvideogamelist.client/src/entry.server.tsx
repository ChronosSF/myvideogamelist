import { PassThrough } from 'node:stream';

import type { EntryContext, RouterContextProvider } from 'react-router';
import { createReadableStreamFromReadable } from '@react-router/node';
import { ServerRouter } from 'react-router';
import { isbot } from 'isbot';
import type { RenderToPipeableStreamOptions } from 'react-dom/server';
import { renderToPipeableStream } from 'react-dom/server';

import { mayBeShared } from '@/lib/cache';
import {
    applySecurityHeaders,
    createNonce,
    documentPolicy,
    RESOURCE_POLICY,
} from '@/lib/securityHeaders';
import { applyIndexingHeaders } from '@/lib/seo';

/**
 * The server entry, which React Router generates unless the app provides one.
 *
 * It is owned here for one reason: it is the only place every document response passes through.
 * A route's `headers` export is bypassed by a thrown `Response`, so the 404s and the 502s — the
 * responses most worth being careful with — would go out bare. Everything below is
 * `react-router reveal`'s output verbatim, reformatted to this codebase's style, except:
 *
 * - the nonce, drawn once per render, and the two places it is handed to the renderers:
 *   `<ServerRouter nonce>` and the stream's `nonce` option;
 * - the two `apply…Headers` calls, and a HEAD's policy taken off again;
 * - a document a shared cache may store waits for all its content, as a crawler's does;
 * - `handleDataRequest`, which the template does not have;
 * - `loadContext` renamed `_loadContext`, for the linter.
 *
 * The content policy's reasoning is ADR 0053. Re-run `react-router reveal` on a React Router major
 * and diff it against this file.
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
    // One nonce per render, and this call is a render: an error boundary that replaces a failed
    // shell is a second call with the same `responseHeaders`, so it draws a fresh nonce and the
    // `set` below replaces the first one's. The policy and every inline script must name the same
    // value — a mismatch is a page that never hydrates — so it is drawn here and nowhere else.
    const nonce = createNonce();

    // Before either response is built below, so a HEAD, a streamed page and an error boundary
    // all carry them.
    applySecurityHeaders(responseHeaders, documentPolicy(nonce));

    // `noindex` on everything, from any deployment that has not been told it is the one to index.
    // Here for the reason the security headers are: a staging site's 404s are as indexable as its
    // pages, and no route's `meta` reaches those.
    applyIndexingHeaders(responseHeaders);

    // https://httpwg.org/specs/rfc9110.html#HEAD
    if (request.method.toUpperCase() === 'HEAD') {
        // Without the content policy, whose nonce is on no script here. A cache may refresh a stored
        // page's headers from a HEAD (RFC 9111 §4.3.5), and this nonce would then sit over a body
        // that carries another; with no policy in it, the cache keeps the stored one. RFC 9110 lets
        // a HEAD leave out a field whose value is decided while generating the content.
        responseHeaders.delete('Content-Security-Policy');

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
        //
        // And any document a shared cache may store. The header carries the nonce, and sent with
        // the shell it would show it to whoever is filling the cache while the rest of the body
        // could still change; sent whole, nothing in the body is decided after its nonce has been
        // seen. A private document streams, since its nonce is never on anybody else's page.
        const readyOption: keyof RenderToPipeableStreamOptions =
            (userAgent && isbot(userAgent))
            || routerContext.isSpaMode
            || mayBeShared(responseHeaders.get('Cache-Control'))
                ? 'onAllReady'
                : 'onShellReady';

        // Abort the rendering stream after the `streamTimeout` so it has time to
        // flush down the rejected boundaries
        let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
            () => abort(),
            streamTimeout + 1000,
        );

        // The nonce goes to both renderers, because each writes inline scripts of its own.
        // `<ServerRouter>` passes it through its context to `<Scripts>`, `<ScrollRestoration>` and
        // the loader data it streams after the shell — and to `<Links>`, which the root gives an
        // empty nonce instead (root.tsx says why). The stream's `nonce` option covers the scripts
        // React itself writes to reveal a boundary that finished after the shell.
        const { pipe, abort } = renderToPipeableStream(
            <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
            {
                nonce,
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

/**
 * The `.data` responses a client-side navigation fetches, which never reach the function above.
 *
 * React Router labels them `text/x-script`, so without `nosniff` a browser would run one as a
 * classic script, and the documents' `script-src 'self'` would let an injected
 * `<script src="….data">` ask it to. They render nothing, so they take what a resource route sends.
 * A copy rather than the response itself, because a `Response` can arrive with headers that cannot
 * be changed.
 */
export function handleDataRequest(response: Response): Response {
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: applySecurityHeaders(new Headers(response.headers), RESOURCE_POLICY),
    });
}
