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
