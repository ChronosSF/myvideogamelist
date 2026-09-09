interface SectionHeadingProps {
    children: React.ReactNode;
    /** Set it when a section is labelled by this heading through `aria-labelledby`. */
    id?: string;
}

/**
 * The heading above one section of the game page.
 *
 * Lifted out of `GamePage` so that a component owning its own section — `CompletionTimes`, which
 * has to decide for itself whether it has anything to show — can use the same one rather than a
 * copy of its classes.
 */
export function SectionHeading({ children, id }: SectionHeadingProps) {
    return (
        <h2
            id={id}
            className="text-sm font-semibold uppercase tracking-widest text-slate-500 light:text-slate-400 mb-3"
        >
            {children}
        </h2>
    );
}
