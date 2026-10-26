import './Honeycomb.css';

/**
 * The honeycomb behind the top of a page or, turned half a turn, behind its bottom: a screen tall, gone by
 * half of it, and drawn in the palette's tokens. Decoration only, so hidden from assistive technology.
 *
 * An element at each end rather than one layer the page's height, so that the layer a phone composites for
 * the breathing cells is a screen tall whatever the page's length, and so that axe, which cannot see
 * through a decorated background, still judges the contrast of everything between the two.
 */
export function Honeycomb({ at }: { at: 'top' | 'bottom' }) {
    return <div className="honeycomb" data-at={at} aria-hidden="true" />;
}
