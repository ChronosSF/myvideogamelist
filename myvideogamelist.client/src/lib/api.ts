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

/**
 * A failed response's body, or null when it is not JSON at all — a proxy error page, or an empty
 * 500. Read once, because a body can only be read once.
 */
export async function bodyOf(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * The message a failed write should show the user, from the body it answered with.
 *
 * ASP.NET returns three shapes and they are not interchangeable. `ValidationProblemDetails` puts
 * the useful sentence inside `errors`, keyed by field — that is what the username endpoint returns
 * for "taken", "reserved" and "too soon", and reading only `message` would show a generic failure
 * in place of the one thing the user needs to know. `{ errors: [...] }` is Identity's own shape,
 * used by registration. `{ message }` is what this API's own auth failures carry, and `detail` or
 * `title` alone is a plain `ProblemDetails` — a rate-limited login, or anything the framework
 * answers before a controller runs.
 */
export function messageIn(body: unknown, fallback: string): string {
    if (typeof body !== 'object' || body === null) return fallback;

    const { errors, message, detail, title } = body as {
        errors?: unknown;
        message?: unknown;
        detail?: unknown;
        title?: unknown;
    };

    if (Array.isArray(errors)) return errors.join(' ') || fallback;

    if (typeof errors === 'object' && errors !== null) {
        const first = Object.values(errors as Record<string, unknown>)
            .flatMap(value => (Array.isArray(value) ? (value as string[]) : []))
            .find(text => typeof text === 'string' && text.length > 0);
        if (first) return first;
    }

    // `message` is what this API's own auth failures carry. `detail` and `title` are
    // ProblemDetails, which is what the framework produces - a rate-limited login being the
    // one where the fallback ("Login failed") would be actively misleading.
    for (const candidate of [message, detail, title]) {
        if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }

    return fallback;
}

/**
 * The sentence a failed request should show the user: its body read as `messageIn` reads it, or
 * `fallback`. Every write that reports the server's refusal goes through this, so a sentence the API
 * gives is never replaced by a generic one.
 */
export async function problemMessage(response: Response, fallback: string): Promise<string> {
    return messageIn(await bodyOf(response), fallback);
}
