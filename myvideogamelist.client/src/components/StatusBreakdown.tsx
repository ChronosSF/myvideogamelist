import { type ListId, LIST_IDS, LIST_NAMES } from '@/types/list';

interface StatusBreakdownProps {
    title: string;
    byStatus: Record<ListId, number>;
    /** Shown under the bars. The wishlist note, on both profiles, in the right person's words. */
    caption: string;
}

/**
 * Where somebody's games sit, as five bars.
 *
 * Shared between the owner's own profile and a public one because the two must not drift: the same
 * library rendered two ways is two chances to disagree about what "tracked" counts. Only the words
 * differ, which is why the caption is a prop rather than written here — "your wishlist" and "their
 * wishlist" are the same fact addressed to different readers.
 *
 * Always all five statuses, including the empty ones. An absent Dropped row would read as a user
 * who has never dropped anything being a user for whom dropping does not exist.
 */
export function StatusBreakdown({ title, byStatus, caption }: StatusBreakdownProps) {
    // At least 1, so the widths are a proportion of something rather than a division by zero on a
    // brand-new account.
    const mostInAStatus = Math.max(1, ...LIST_IDS.map(id => byStatus[id]));

    return (
        <section className="profile-section">
            <h3 className="profile-section-title">{title}</h3>
            <ul className="profile-ranked">
                {LIST_IDS.map(id => (
                    <li key={id} className="profile-ranked-row">
                        <span className="profile-ranked-name">{LIST_NAMES[id]}</span>
                        <span className="profile-ranked-track" aria-hidden="true">
                            <span
                                className={`profile-ranked-fill status-${id}`}
                                style={{ width: `${(byStatus[id] / mostInAStatus) * 100}%` }}
                            />
                        </span>
                        <span className="profile-ranked-count" aria-hidden="true">
                            {byStatus[id]}
                        </span>
                        <span className="sr-only">
                            {`${byStatus[id]} ${byStatus[id] === 1 ? 'game' : 'games'}`}
                        </span>
                    </li>
                ))}
            </ul>
            <p className="profile-caption">{caption}</p>
        </section>
    );
}
