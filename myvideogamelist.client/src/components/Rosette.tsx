/**
 * The rosette a favourite is marked with — never a star, which is the user's own score and nothing else
 * (ADR 0021). The game page's toggle draws the same one.
 *
 * Decorative: the button around it carries the name and `aria-pressed`.
 */
export function Rosette({ filled }: { filled: boolean }) {
    return (
        <svg fill={filled ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15a6 6 0 100-12 6 6 0 000 12zM8.2 13.7L7 21l5-3 5 3-1.2-7.3"
            />
        </svg>
    );
}
