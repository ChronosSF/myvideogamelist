interface SectionHeadingProps {
    children: React.ReactNode;
    /** Set it when a section is labelled by this heading through `aria-labelledby`. */
    id?: string;
    /**
     * Lets script move focus here, without putting the heading in the tab order: for a section that
     * replaces the control that had focus, such as a "Try again" that gives way to a skeleton.
     */
    focusable?: boolean;
}

/**
 * The heading above one section of the game page: a hairline, and the section's name in the display type
 * under it (ADR 0075).
 *
 * Lifted out of `GamePage` so that a component owning its own section — `CompletionTimes`, which
 * has to decide for itself whether it has anything to show — can use the same one rather than a
 * copy of its classes.
 */
export function SectionHeading({ children, id, focusable = false }: SectionHeadingProps) {
    return (
        <h2
            id={id}
            tabIndex={focusable ? -1 : undefined}
            className="type-display text-2xl sm:text-[1.75rem] text-fg-strong border-t border-line pt-4 mb-5 focus:outline-none"
        >
            {children}
        </h2>
    );
}
