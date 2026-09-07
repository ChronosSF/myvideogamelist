interface StatTileProps {
    label: string;
    /**
     * Null renders an em dash rather than a zero. The difference matters on this page: a user with
     * nothing finished has no completion rate, and printing "0%" would be a claim about them
     * rather than an absence of one.
     */
    value: string | null;
    /** What the figure counts, or why there is none. Always shown, so the number is never bare. */
    hint: string;
}

export function StatTile({ label, value, hint }: StatTileProps) {
    return (
        <div className="profile-stat-tile">
            <p className="profile-stat-value">{value ?? '—'}</p>
            <p className="profile-stat-label">{label}</p>
            <p className="profile-stat-hint">{hint}</p>
        </div>
    );
}
