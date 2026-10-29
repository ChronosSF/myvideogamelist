import './DotMatrix.css';

/**
 * The dot-matrix panel behind the top of a page or, mirrored, behind its bottom, gone by half a screen, and
 * drawn in the palette's tokens. Decoration only, so hidden from assistive technology.
 *
 * An element of its own rather than decoration on `.app-root`: axe cannot see through a decorated background
 * on an element that holds the text, and `.app-root` holds all of it, so its contrast check went blind on
 * every page. How each end is laid out, and why the bottom one spans the page, is `DotMatrix.css`'s.
 */
export function DotMatrix({ at }: { at: 'top' | 'bottom' }) {
    return <div className="dot-matrix" data-at={at} aria-hidden="true" />;
}
