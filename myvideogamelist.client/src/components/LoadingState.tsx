import type { ReactNode } from 'react';

interface LoadingStateProps {
    /** What is on its way, as a sentence: "Loading your lists…". Read out, never shown. */
    label: string;
    /** The skeleton, laid out as the content it stands for will be, so nothing moves when that arrives. */
    children: ReactNode;
    className?: string;
}

/**
 * A place on the page whose content has not arrived, drawn as that content's shape.
 *
 * Replaces the spinners, which said "wait" in a box of their own size and then let the page jump to the
 * content's. The shapes are for the eye only; the sentence is a status, so somebody who cannot see the
 * shapes meets in words what they would have seen.
 *
 * Not `aria-busy`, which is for a region being updated in place and cleared when the update is done.
 * This is replaced rather than updated, so nothing would ever clear it, and a screen reader may hold
 * back what is inside a busy region — the sentence included. A container that stays while its content
 * changes, as the games grid does while more games load, carries it there instead.
 */
export function LoadingState({ label, children, className }: LoadingStateProps) {
    return (
        <div className={className}>
            <p role="status" className="sr-only">{label}</p>
            <div aria-hidden="true">{children}</div>
        </div>
    );
}
