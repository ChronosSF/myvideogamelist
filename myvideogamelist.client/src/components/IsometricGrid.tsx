import './IsometricGrid.css';

/**
 * The isometric grid behind the top of a page or, mirrored, behind its bottom: a strategy game's map of 2:1
 * tiles, a few of them raised and lit, gone by half a screen and drawn in the palette's tokens. Decoration
 * only, so hidden from assistive technology.
 *
 * An element of its own rather than decoration on `.app-root`: axe cannot see through a decorated background
 * on an element that holds the text, and `.app-root` holds all of it, so its contrast check went blind on
 * every page. How each end is laid out, and why the bottom one spans the page, is `IsometricGrid.css`'s.
 */
export function IsometricGrid({ at }: { at: 'top' | 'bottom' }) {
    return <div className="isometric-grid" data-at={at} aria-hidden="true" />;
}
