import './PagePattern.css';

/**
 * The pattern behind the top of a page or, mirrored, behind its foot, gone by half a screen and drawn in
 * the palette's tokens: whichever `<html data-pattern>` names, the reader's choice (ADR 0082), or none.
 * Decoration only, so hidden from assistive technology.
 *
 * The same markup whatever the pattern, so the server renders it without knowing whose page it is, and the
 * look script's attribute chooses before the first paint. An element of its own rather than decoration on
 * `.app-root`: axe cannot see through a decorated background on an element that holds the text, and
 * `.app-root` holds all of it, so its contrast check went blind on every page. How each end is laid out,
 * and why the bottom one spans the page, is `PagePattern.css`'s.
 */
export function PagePattern({ at }: { at: 'top' | 'bottom' }) {
    return <div className="page-pattern" data-at={at} aria-hidden="true" />;
}
