/**
 * Cloudflare's Turnstile, the check that a sign-up comes from a person (ADR 0092): its script, which the
 * page loads only when the sign-up form opens, and this deployment's site key, which the API holds beside
 * its secret.
 */

/** Where the widget's script comes from, which the document policy names in `script-src`. */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/** `render=explicit`: the widget is drawn where and when the form says, never by a class name it finds. */
const SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

/** The options this site draws a widget with. Cloudflare's names, dashes and all. */
export interface TurnstileOptions {
    sitekey: string;
    theme: 'dark';
    size: 'flexible';
    callback: (token: string) => void;
    'expired-callback': () => void;
    /** Returning true says the page has handled it, so Turnstile does not throw it into the console. */
    'error-callback': (code: string) => boolean;
}

/** The part of `window.turnstile` this site uses. */
export interface TurnstileApi {
    render(container: HTMLElement, options: TurnstileOptions): string | null | undefined;
    remove(widgetId: string): void;
}

declare global {
    interface Window {
        turnstile?: TurnstileApi;
    }
}

let script: Promise<TurnstileApi> | null = null;

/**
 * Turnstile's API, loading its script the first time it is asked for. A load that failed is forgotten,
 * with its element, so that trying again loads it again.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
    if (window.turnstile) return Promise.resolve(window.turnstile);

    script ??= new Promise<TurnstileApi>((resolve, reject) => {
        const element = document.createElement('script');
        element.src = SCRIPT_URL;
        element.async = true;
        element.onload = () => {
            if (window.turnstile) resolve(window.turnstile);
            else reject(new Error('Turnstile loaded without its API.'));
        };
        element.onerror = () => {
            element.remove();
            reject(new Error('Turnstile could not be loaded.'));
        };
        document.head.append(element);
    }).catch((error: unknown) => {
        script = null;
        throw error;
    });

    return script;
}

let siteKey: Promise<string> | null = null;

/**
 * This deployment's site key, from the API, asked for once per page. Not built into the page, because
 * one build serves every environment and each has its own widget. A failed answer is forgotten, so that
 * trying again asks again.
 */
export function turnstileSiteKey(): Promise<string> {
    siteKey ??= fetch('/api/auth/turnstile', { credentials: 'omit' })
        .then(async response => {
            const body: unknown = response.ok ? await response.json() : null;
            const key = typeof body === 'object' && body !== null ? (body as { siteKey?: unknown }).siteKey : undefined;
            if (typeof key !== 'string' || key.length === 0) throw new Error('No Turnstile site key.');
            return key;
        })
        .catch((error: unknown) => {
            siteKey = null;
            throw error;
        });

    return siteKey;
}
