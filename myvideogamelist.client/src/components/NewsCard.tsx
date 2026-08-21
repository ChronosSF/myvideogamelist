import { Link } from 'react-router';
import type { NewsItemDto } from '@/types/news';
import { useHydrated } from '@/lib/useHydrated';

interface NewsCardProps {
    item: NewsItemDto;
    /** Hide the game name and cover when the card already sits under that game's heading. */
    showGame?: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A fixed "12 Aug" built from UTC parts.
 *
 * Deliberately avoids `toLocaleDateString`: the server formats with Node's locale and timezone
 * and the browser with the reader's, so the two disagree and hydration warns. This depends only
 * on the timestamp, so both passes produce the same string.
 */
function absoluteDate(published: Date): string {
    return `${MONTHS[published.getUTCMonth()]} ${published.getUTCDate()}`;
}

/** A coarse "3 days ago". Reads the clock, so it is only safe once hydrated. */
function relativeAge(published: Date): string {
    const days = Math.floor((Date.now() - published.getTime()) / 86_400_000);

    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return absoluteDate(published);
}

export function NewsCard({ item, showGame = true }: NewsCardProps) {
    const hydrated = useHydrated();
    const published = new Date(item.publishedAt);
    const valid = !Number.isNaN(published.getTime());

    // The absolute date renders first and is replaced by the friendlier relative age once the
    // client's own clock and timezone are available.
    const age = !valid ? '' : hydrated ? relativeAge(published) : absoluteDate(published);

    return (
        <article className="group flex gap-4 p-4 rounded-xl bg-slate-800/60 light:bg-white border border-slate-700/50 light:border-slate-200 hover:border-blue-600/50 light:hover:border-blue-300 transition-colors">
            {showGame && item.gameCoverUrl && (
                <Link
                    to={`/games/${item.gameId}`}
                    className="shrink-0"
                    aria-label={item.gameTitle}
                >
                    <img
                        src={item.gameCoverUrl}
                        alt=""
                        loading="lazy"
                        className="w-14 h-20 object-cover rounded-lg border border-slate-700/50 light:border-slate-200"
                    />
                </Link>
            )}

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5 text-xs">
                    {showGame && (
                        <>
                            <Link
                                to={`/games/${item.gameId}`}
                                className="text-blue-400 light:text-blue-600 hover:underline font-medium truncate max-w-[45%]"
                            >
                                {item.gameTitle}
                            </Link>
                            <span className="text-slate-600 light:text-slate-400" aria-hidden="true">•</span>
                        </>
                    )}
                    <span className="text-slate-500 light:text-slate-600 truncate">{item.source}</span>
                    {age && <span className="text-slate-600 light:text-slate-400" aria-hidden="true">•</span>}
                    {age && (
                        <time
                            dateTime={item.publishedAt}
                            className="text-slate-500 light:text-slate-600 shrink-0"
                        >
                            {age}
                        </time>
                    )}
                </div>

                {/*
                  * Opens on Steam or the originating outlet, so it leaves the app: noopener is a
                  * security requirement, not a formality — without it the opened page can reach
                  * back through window.opener.
                  */}
                <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block font-semibold text-white light:text-slate-900 leading-snug group-hover:text-blue-400 light:group-hover:text-blue-600 transition-colors"
                >
                    {item.title}
                </a>

                {item.excerpt && (
                    <p className="mt-1.5 text-sm text-slate-400 light:text-slate-600 leading-relaxed line-clamp-2">
                        {item.excerpt}
                    </p>
                )}
            </div>
        </article>
    );
}
