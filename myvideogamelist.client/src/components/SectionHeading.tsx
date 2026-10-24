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
 * The heading above one section of the game page.
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
            className="text-sm font-semibold uppercase tracking-widest text-fg-faint mb-3 focus:outline-none"
        >
            {children}
        </h2>
    );
}
