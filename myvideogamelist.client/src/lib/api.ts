/**
 * Resolves an API path for whichever side of the render it is called from.
 *
 * In the browser a relative "/api/..." resolves against the current origin and the
 * dev server proxies it to ASP.NET. On the server there is no origin to resolve
 * against, so loaders need the backend's absolute URL.
 *
 * The default targets the backend's plain-HTTP endpoint deliberately: the HTTPS one
 * uses the ASP.NET dev certificate, which Node's fetch rejects.
 */
export function apiUrl(path: string): string {
    if (typeof document !== 'undefined') return path;

    const base = process.env.API_BASE_URL ?? 'http://localhost:5039';
    return new URL(path, base).toString();
}

/**
 * The header the API requires on every write.
 *
 * Its value is never read. What it proves is that the request was made by script this site
 * served: a form on another site can POST anywhere but cannot add a header, and script on another
 * site can add one only if this API answers a CORS preflight, which it does not. See
 * `MyVideoGameList.Server/Security/CsrfHeaderMiddleware.cs`.
 */
export const REQUEST_HEADER = 'X-MVGL-Request';

/**
 * A request to this API, carrying the two things a call to it needs: the session cookie, and — for
 * anything that changes state — the header the server requires.
 *
 * **Every write goes through this.** One sent with bare `fetch` is refused with a 403, in local
 * development as well as deployed, which is the intended way to find that out. Reads may use
 * either, and several deliberately send no credentials at all.
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    const safe = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

    const headers = new Headers(init.headers);
    if (!safe) headers.set(REQUEST_HEADER, '1');

    return fetch(apiUrl(path), { credentials: 'include', ...init, headers });
}
