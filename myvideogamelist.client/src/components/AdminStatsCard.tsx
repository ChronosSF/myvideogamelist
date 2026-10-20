import { formatCount } from '@/lib/format';
import { LIST_IDS, LIST_NAMES } from '@/types/list';
import type { AdminStats, AdminStatsWeek } from '@/types/adminStats';

interface AdminStatsCardProps {
    stats: AdminStats | null;
    /** Why the last count failed, if it did. A refusal is the page's to say, not this card's. */
    error: string | null;
    reload: () => void;
}

/** "Jul 27", in UTC, the same wherever it is read, and written as the calendar's cards below write a day. */
function weekOf(week: AdminStatsWeek): string {
    return new Date(`${week.starts}T00:00:00Z`).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
    });
}

/**
 * What members do on the site, counted (ADR 0051): totals across every account and the last twelve
 * weeks, and nothing about any one member, because the server counts nothing that is.
 *
 * The lists go by their default names, as a public profile's do: a rename is its owner's own label,
 * and these figures are everybody's lists at once.
 */
export function AdminStatsCard({ stats, error, reload }: AdminStatsCardProps) {
    let body: React.ReactNode;
    if (error !== null) {
        body = (
            <div className="mt-4 flex items-center gap-3">
                <p className="admin-error" role="alert">{error}</p>
                <button type="button" className="admin-btn" onClick={reload}>Try again</button>
            </div>
        );
    } else if (stats === null) {
        body = <p className="admin-hint" role="status">Counting…</p>;
    } else {
        const { accounts, library, writing, imports } = stats;
        const groups: { title: string; figures: [string, number][] }[] = [
            {
                title: 'Accounts',
                figures: [
                    ['Accounts', accounts.total],
                    ['Seen today', accounts.seenToday],
                    ['Seen in 7 days', accounts.seenInSevenDays],
                    ['Seen in 30 days', accounts.seenInThirtyDays],
                    ['Public profiles', accounts.publicProfiles],
                ],
            },
            {
                title: 'Lists',
                figures: [
                    ...LIST_IDS.map((id): [string, number] => [LIST_NAMES[id], library.byStatus[id] ?? 0]),
                    ['In no list', library.inNoList],
                    ['From imports', library.fromImports],
                    ['Wishlisted', library.wishlisted],
                    ['Favourites', library.favourites],
                ],
            },
            {
                title: 'Written',
                figures: [
                    ['Reviews', writing.reviews],
                    ['Marked public', writing.publicReviews],
                    ['Playthroughs', writing.playthroughs],
                    ['With a time', writing.timedPlaythroughs],
                ],
            },
            {
                title: 'Imports still held',
                figures: [
                    ['Under review', imports.pending],
                    ['Finished', imports.done],
                    ['Cancelled', imports.cancelled],
                ],
            },
        ];
        // Newest first: this week is the one an admin opens the page for.
        const weeks = [...stats.weeks].reverse();

        body = (
            <>
                {groups.map(group => (
                    <div key={group.title} className="mt-6">
                        <h3 className="text-sm font-semibold text-fg-soft mb-2">{group.title}</h3>
                        <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                            {group.figures.map(([label, value]) => (
                                <div key={label} className="rounded-lg bg-raised/40 px-3 py-2">
                                    <dt className="text-xs text-fg-muted">{label}</dt>
                                    <dd className="text-xl font-bold text-fg-strong">{formatCount(value)}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                ))}

                <p className="admin-hint">
                    Imports are counted while the retention sweep holds them: a finished or cancelled one goes a
                    week after it closes, an unfinished one two weeks after its last decision. What every import
                    brought in stays counted as From imports.
                </p>
                {accounts.undated > 0 && (
                    <p className="admin-hint">
                        {formatCount(accounts.undated)} {accounts.undated === 1 ? 'account is' : 'accounts are'} from
                        before sign-up dates were recorded, so in no week&rsquo;s sign-ups.
                    </p>
                )}

                <div className="mt-6 overflow-x-auto">
                    <table className="w-full text-sm">
                        <caption className="text-left text-sm font-semibold text-fg-soft mb-2">
                            The last twelve weeks, Monday to Sunday in UTC
                        </caption>
                        <thead>
                            <tr className="text-xs text-fg-muted border-b border-line">
                                <th scope="col" className="text-left font-medium py-2 pr-3">Week of</th>
                                <th scope="col" className="text-right font-medium py-2 px-3">Sign-ups</th>
                                <th scope="col" className="text-right font-medium py-2 px-3">List moves</th>
                                <th scope="col" className="text-right font-medium py-2 px-3">Reviews</th>
                                <th scope="col" className="text-right font-medium py-2 pl-3">Playthroughs</th>
                            </tr>
                        </thead>
                        <tbody>
                            {weeks.map(week => (
                                <tr key={week.starts} className="border-b border-line last:border-b-0 text-fg">
                                    <th scope="row" className="text-left font-normal py-1.5 pr-3 text-fg-soft">{weekOf(week)}</th>
                                    <td className="text-right tabular-nums py-1.5 px-3">{formatCount(week.signUps)}</td>
                                    <td className="text-right tabular-nums py-1.5 px-3">{formatCount(week.listMoves)}</td>
                                    <td className="text-right tabular-nums py-1.5 px-3">{formatCount(week.reviews)}</td>
                                    <td className="text-right tabular-nums py-1.5 pl-3">{formatCount(week.playthroughs)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </>
        );
    }

    return (
        <section className="admin-card" aria-labelledby="admin-stats-heading">
            <h2 id="admin-stats-heading" className="admin-card-title">Members, counted</h2>
            <p className="admin-hint">
                Totals across every account, from the site&rsquo;s own tables. Nothing here is about any one member.
            </p>
            {body}
        </section>
    );
}
