import './PerspectiveGrid.css';

/**
 * The perspective grid behind the top of a page, a ceiling receding towards a vanishing point, or behind its
 * bottom, a floor receding towards one, gone by half a screen, and drawn in the palette's tokens. Decoration
 * only, so hidden from assistive technology.
 *
 * An element of its own rather than decoration on `.app-root`: axe cannot see through a decorated background
 * on an element that holds the text, and `.app-root` holds all of it, so its contrast check went blind on
 * every page. How each end is laid out, and why the bottom one spans the page, is `PerspectiveGrid.css`'s.
 */
export function PerspectiveGrid({ at }: { at: 'top' | 'bottom' }) {
    return <div className="perspective-grid" data-at={at} aria-hidden="true" />;
}
