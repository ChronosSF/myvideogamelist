/**
 * Headers every server-rendered document carries, whatever it renders.
 *
 * The API states its own set (`MyVideoGameList.Server/Security/SecurityHeaders.cs`), and the two
 * are deliberately different: JSON may load nothing, whereas a page that loaded nothing would be
 * blank. They are two processes serving one site — see ADR 0003 — so neither set covers the other,
 * and a header added to one is worth a look at the other.
 *
 * **What is not here.** A content policy naming `script-src` or `style-src` is the valuable half of
 * CSP and it is missing, because React Router hydrates from an inline script: restricting scripts
 * means a per-request nonce handed to `<Scripts nonce>`, and a wrong one is a blank page rather
 * than a warning. `frame-ancestors` is the part that needs no nonce, so it ships now and the rest
 * is a change of its own.
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
     * on instead. Both spellings, because they are read by different browsers.
     */
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
};

/**
 * Applies them to a response's headers, in place.
 *
 * Called once for every document response, including the ones a thrown `Response` produces — which
 * is the reason this happens in `entry.server.tsx` rather than in each route's `headers` export.
 * A throw bypasses that export, so a per-route policy would leave every 404 uncovered.
 */
export function applySecurityHeaders(headers: Headers): Headers {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    return headers;
}
