import './Skeleton.css';

/**
 * One shape of a loading placeholder, sized and shaped by the classes it is given. The sheen that passes
 * over it belongs to the skeleton around it — a card, a table, a panel — which carries `skeleton-sheen`,
 * so that a page of shapes animates one layer per card rather than one per shape.
 *
 * Hidden from assistive technology: a page of grey boxes means nothing read aloud, so what is loading is
 * said once, in words, by the `LoadingState` around it.
 */
export function Skeleton({ className = '' }: { className?: string }) {
    return <span className={`skeleton ${className}`} aria-hidden="true" />;
}
