/**
 * Headers every response from the front-end server carries, whatever it renders.
 *
 * The API states its own set (`MyVideoGameList.Server/Security/SecurityHeaders.cs`), and the two
 * are deliberately different: JSON may load nothing, whereas a page that loaded nothing would be
 * blank. They are two processes serving one site — see ADR 0003 — so neither set covers the other,
 * and a header added to one is worth a look at the other.
 *
 * The content policy is not in this table, because a document's is not one value: it names the
 * nonce its own render wrote into its scripts. `documentPolicy` builds that one, and
 * `RESOURCE_POLICY` is the one for a response that renders nothing.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
    /** A response whose body looks like script must not be loadable as one. */
    'X-Content-Type-Options': 'nosniff',

    /**
     * The origin, never the path, once the destination is somebody else. Paths here carry
     * usernames and the games a person tracks, and the outbound links are to stores and IGDB.
     */
    'Referrer-Policy': 'strict-origin-when-cross-origin',

    /**
     * Framing is how a signed-in page's controls get clicked by a page the reader thinks they are
     * on instead. Both spellings, because they are read by different browsers; the other is
     * `frame-ancestors` in each policy below.
     */
    'X-Frame-Options': 'DENY',
};

/**
 * A fresh nonce for one render: 128 bits from the platform's cryptographic source, as CSP3 asks.
 *
 * The Web Crypto global rather than `node:crypto`, because this module reaches the browser bundle
 * through `@/lib/seo` and a Node built-in has no place there. It is only ever called on the server.
 */
export function createNonce(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return btoa(String.fromCharCode(...bytes));
}

/**
 * The content policy for a server-rendered document, naming the nonce that render wrote into its
 * inline scripts. ADR 0053 is the reasoning; in brief:
 *
 * - **`script-src`** admits scripts from this origin and inline scripts carrying the nonce. Every
 *   inline script a document has is written by React Router or React — the hydration context, the
 *   route modules, the loader data, scroll restoration — and `entry.server.tsx` hands both of them
 *   this one value. Inline event handlers and `javascript:` URLs match neither, so they never run.
 *   A script whose text never changes, such as the palette script issue 208 plans, may be admitted
 *   by its hash instead: add a `'sha256-…'` source here, computed from the same constant the page
 *   renders.
 * - **`base-uri`**, because a `<base>` injected above the scripts would re-point the relative URLs
 *   React Router's inline module imports, and a module's imports carry its nonce — the nonce check
 *   comes before the URL check, so `'self'` would not stop them.
 * - **`object-src`**, because `<object>` and `<embed>` answer to it rather than to `script-src`,
 *   and nothing here embeds one.
 * - **`frame-ancestors`**: nobody frames a page of ours.
 *
 * It holds for a page the CDN shares between readers as for a private one, because the header and
 * the body are stored and replayed together. Two things would split them, and neither may be
 * added: a CloudFront response headers policy that sets this header, and a validator (`ETag`,
 * `Last-Modified`) on a document, since a 304 replaces the stored headers and keeps the old body.
 */
export function documentPolicy(nonce: string): string {
    return [
        `script-src 'self' 'nonce-${nonce}'`,
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
    ].join('; ');
}

/**
 * The content policy for a response that is not a document: robots.txt and the sitemaps. They
 * render nothing, so they may load nothing — the API's policy, for the API's reason.
 */
export const RESOURCE_POLICY = "default-src 'none'; frame-ancestors 'none'";

/**
 * Applies the headers and the given content policy to a response's headers, in place.
 *
 * Called once for every document response, including the ones a thrown `Response` produces — which
 * is the reason this happens in `entry.server.tsx` rather than in each route's `headers` export.
 * A throw bypasses that export, so a per-route policy would leave every 404 uncovered. The policy
 * is a parameter, never a default, so that no caller can end up with a document's headers and no
 * decision about its scripts.
 */
export function applySecurityHeaders(headers: Headers, contentSecurityPolicy: string): Headers {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    headers.set('Content-Security-Policy', contentSecurityPolicy);
    return headers;
}
