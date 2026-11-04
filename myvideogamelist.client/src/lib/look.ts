import { DEFAULT_LOOK, LOOK_COLOUR, PALETTE_IDS, PATTERN_IDS, type Look } from '@/types/look';

/**
 * Where the browser keeps a copy of the account's look, so that the next page applies it before its first
 * paint rather than once `/api/auth/me` answers (ADR 0082). The account is the record; this is a cache of
 * it, written whenever the account's look is known and removed once nobody is signed in.
 */
export const LOOK_STORAGE_KEY = 'mvgl-look';

/**
 * Puts a look on the document: the palette, the pattern and its tint as attributes of `<html>`, which
 * `theme.css` and `PagePattern.css` select on, and a custom palette's two colours as the variables the
 * palette is worked out from. A custom palette missing a colour is drawn as the default, as the head script
 * draws it.
 */
export function applyLook(look: Look, root: HTMLElement = document.documentElement): void {
    const custom = look.palette === 'custom'
        && LOOK_COLOUR.test(look.background ?? '')
        && LOOK_COLOUR.test(look.accent ?? '');
    const palette = look.palette === 'custom' && !custom ? DEFAULT_LOOK.palette : look.palette;

    root.setAttribute('data-palette', palette);
    root.setAttribute('data-pattern', look.pattern);
    root.setAttribute('data-pattern-tint', look.tint);

    if (custom) {
        root.style.setProperty('--look-page', look.background);
        root.style.setProperty('--look-accent', look.accent);
    } else {
        root.style.removeProperty('--look-page');
        root.style.removeProperty('--look-accent');
    }
}

/**
 * Keeps the account's look for the next page, or forgets it. Storage may be refused — a private window, a
 * full quota, a browser that blocks it — and then the next page waits for the account, as it would on a
 * device signed in for the first time.
 */
export function storeLook(look: Look | null): void {
    try {
        if (look === null) localStorage.removeItem(LOOK_STORAGE_KEY);
        else localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify(look));
    } catch {
        // Nothing to do: the look is still on the page, and still on the account.
    }
}

/**
 * Forgets the look on this browser and draws the default, for an account that is gone. Signing out keeps
 * the copy, so the browser stays in its last reader's look; a deleted account has no look to keep.
 */
export function forgetLook(): void {
    storeLook(null);
    applyLook(DEFAULT_LOOK);
}

/**
 * The script the document runs in its `<head>`, before the stylesheets and the first paint: the stored
 * look, put on `<html>` as `applyLook` would, with anything it does not know read as the default. Plain ES5
 * in a `try`, because nothing it can meet — no storage, a value written by an older release, somebody's
 * own edit — may stop the page.
 *
 * Its text never changes between renders, so the document policy admits it by its hash
 * (`LOOK_SCRIPT_HASH`, `documentPolicy`) rather than by the render's nonce, which a browser blanks once
 * read and the hydrating client would then disagree with. Built from the lists, so a palette added to them
 * is one the script knows; `look.test.ts` fails until the hash is the text's.
 */
export const LOOK_SCRIPT = '(function(){try{'
    + `var l=JSON.parse(localStorage.getItem(${JSON.stringify(LOOK_STORAGE_KEY)})||"null");`
    + 'if(!l||typeof l!=="object")return;'
    + 'var d=document.documentElement,h=/^#[0-9a-f]{6}$/i,'
    + `p=${JSON.stringify(PALETTE_IDS)}.indexOf(l.palette)<0?${JSON.stringify(DEFAULT_LOOK.palette)}:l.palette;`
    + `if(p==="custom"&&!(h.test(l.background)&&h.test(l.accent)))p=${JSON.stringify(DEFAULT_LOOK.palette)};`
    + 'd.setAttribute("data-palette",p);'
    + `d.setAttribute("data-pattern",${JSON.stringify(PATTERN_IDS)}.indexOf(l.pattern)<0?${JSON.stringify(DEFAULT_LOOK.pattern)}:l.pattern);`
    + 'd.setAttribute("data-pattern-tint",l.tint==="accent"?"accent":"grey");'
    + 'if(p==="custom"){d.style.setProperty("--look-page",l.background);d.style.setProperty("--look-accent",l.accent)}'
    + '}catch(e){}})()';

/** `LOOK_SCRIPT`'s SHA-256, base64, as a `script-src` source names it. */
export const LOOK_SCRIPT_HASH = 'sha256-R61xErFdaZW7/c+gcEQzyBwIXiQKbmyAcdF+FIVv3Jg=';
