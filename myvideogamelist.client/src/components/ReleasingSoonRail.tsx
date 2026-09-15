import { useMemo } from 'react';
import { Link } from 'react-router';
import { useLists } from '@/hooks/useLists';
import { useWishlist } from '@/hooks/useWishlist';
import type { UseUpcomingGamesResult } from '@/hooks/useUpcomingGames';
import { formatReleaseDay } from '@/lib/releaseDate';
import { releasingSoon, type ReleasingSoonItem } from '@/lib/releasingSoon';

interface Props {
    /** The calendar's own request, lifted to the page so the two share one fetch. */
    upcoming: UseUpcomingGamesResult;
    hiddenPlatformIds: ReadonlySet<number>;
    hiddenPlatformsLoading: boolean;
}

/** Why a game is on the rail, in the fewest words that say it. */
function reason(item: ReleasingSoonItem): string {
    if (item.onWishlist && item.inBacklog) return 'On your wishlist and in your backlog';
    return item.onWishlist ? 'On your wishlist' : 'In your backlog';
}

/**
 * Releases from the user's wishlist and backlog, soonest first, above everything else on the home
 * page (ROADMAP H4 — "3 games you're waiting for drop this week" beats a firehose of every release).
 *
 * The roadmap called it "your week". It covers the calendar's whole window instead, because that is
 * what the calendar fetches, and a week-long slice of one person's wishlist and backlog will often be
 * empty — a section that is rarely there is one nobody learns to look for. The dates on each game say
 * which releases are close.
 *
 * Silent until everything it crosses has loaded, silent when any of it failed, and silent when
 * nothing matches: it sits above a page that works perfectly well without it, and a partial answer
 * — the backlog's releases while the wishlist failed — would read as the whole one.
 *
 * Reads the reader's clock for "Today" and "Tomorrow", which is safe only because the signed-in half
 * of the home page never server-renders: auth is unknown until a client fetch answers.
 */
export function ReleasingSoonRail({ upcoming, hiddenPlatformIds, hiddenPlatformsLoading }: Props) {
    const { lists, loading: listsLoading, error: listsError } = useLists();
    const { items: wishlist, loading: wishlistLoading, error: wishlistError } = useWishlist();

    const items = useMemo(() => releasingSoon(
        upcoming.games,
        new Set(wishlist.map(item => item.game.id)),
        new Set(lists.backlog.map(entry => entry.game.id)),
        hiddenPlatformIds,
    ), [upcoming.games, wishlist, lists.backlog, hiddenPlatformIds]);

    if (upcoming.loading || listsLoading || wishlistLoading || hiddenPlatformsLoading) return null;
    if (upcoming.error !== null || listsError !== null || wishlistError !== null) return null;
    if (items.length === 0) return null;

    return (
        <section aria-labelledby="releasing-soon-heading">
            <h2 id="releasing-soon-heading" className="text-lg font-semibold text-white light:text-slate-900 mt-8 mb-1">
                Releasing soon
            </h2>
            <p className="text-sm text-slate-400 light:text-slate-600 mb-4">
                From your wishlist and backlog
            </p>

            <ul
                className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory scroll-smooth"
                // Scrolls on its own, so it is a named, focusable region rather than an overflow
                // container a keyboard user cannot reach — as the Continue Playing rail is.
                tabIndex={0}
                aria-label="Your games releasing soon"
            >
                {items.map((item, index) => {
                    const { game } = item;
                    const where = item.platforms.map(p => p.abbreviation || p.name).join(', ');

                    return (
                        <li key={game.id} className="shrink-0 snap-start w-32 sm:w-36">
                            <Link
                                to={`/games/${game.id}`}
                                className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-xl"
                            >
                                <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-800 light:bg-slate-100 border border-slate-700/50 light:border-slate-200 group-hover:border-blue-500/60 transition-all duration-300 shadow-lg">
                                    {game.coverImageUrl && (
                                        <img
                                            src={game.coverImageUrl}
                                            alt=""
                                            loading={index < 6 ? 'eager' : 'lazy'}
                                            className="w-full h-full object-cover"
                                        />
                                    )}
                                </div>

                                <p className="mt-2 text-sm font-medium text-slate-200 light:text-slate-800 leading-snug line-clamp-2 group-hover:text-blue-400 light:group-hover:text-blue-600 transition-colors">
                                    {game.title}
                                </p>
                            </Link>

                            <p className="mt-1 text-xs font-semibold text-blue-300 light:text-blue-700 truncate" title={where || undefined}>
                                <time dateTime={item.releaseDate}>{formatReleaseDay(item.releaseDate)}</time>
                                {where && <span className="font-normal text-slate-400 light:text-slate-600"> · {where}</span>}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-400 light:text-slate-600 line-clamp-2">
                                {reason(item)}
                            </p>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
