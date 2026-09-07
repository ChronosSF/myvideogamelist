import type { Tally } from '@/lib/stats';

interface LibraryBreakdownProps {
    title: string;
    items: Tally[];
    /** Shown in place of the bars when the lists hold nothing to count. */
    empty: string;
}

/**
 * A ranked bar list — the platforms or genres most represented in the user's lists.
 *
 * Says "games", not "share of your library", and not "most played". A game with four platforms
 * counts towards all four, so these totals do not sum to anything; and nothing in the schema
 * records hours yet, so "played" would be a word the data cannot support.
 */
export function LibraryBreakdown({ title, items, empty }: LibraryBreakdownProps) {
    if (items.length === 0) {
        return (
            <section className="profile-section">
                <h3 className="profile-section-title">{title}</h3>
                <p className="profile-empty">{empty}</p>
            </section>
        );
    }

    const most = items[0].count;

    return (
        <section className="profile-section">
            <h3 className="profile-section-title">{title}</h3>
            <ul className="profile-ranked">
                {items.map(item => (
                    <li key={item.id} className="profile-ranked-row">
                        <span className="profile-ranked-name">{item.name}</span>
                        <span className="profile-ranked-track" aria-hidden="true">
                            <span
                                className="profile-ranked-fill"
                                style={{ width: `${(item.count / most) * 100}%` }}
                            />
                        </span>
                        <span className="profile-ranked-count" aria-hidden="true">{item.count}</span>
                        <span className="sr-only">
                            {`${item.count} ${item.count === 1 ? 'game' : 'games'}`}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
