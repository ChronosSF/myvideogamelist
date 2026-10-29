import { Link } from 'react-router';
import { CoverImage } from '@/components/CoverImage';
import type { NewsItemDto } from '@/types/news';
import { useHydrated } from '@/lib/useHydrated';

interface NewsCardProps {
    item: NewsItemDto;
    /** Hide the game name and cover when the card already sits under that game's heading. */
    showGame?: boolean;
    /**
     * `row`, a cover beside the source, the headline and the start of the text, as a list of news reads;
     * `lead`, the headline set large over more of its text, for the home page's front page; `brief`, the
     * source and the headline alone, for the column beside the lead (ADR 0075).
     */
    variant?: 'row' | 'lead' | 'brief';
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

export function NewsCard({ item, showGame = true, variant = 'row' }: NewsCardProps) {
    const hydrated = useHydrated();
    const published = new Date(item.publishedAt);
    const valid = !Number.isNaN(published.getTime());

    // The absolute date renders first and is replaced by the friendlier relative age once the
    // client's own clock and timezone are available.
    const age = !valid ? '' : hydrated ? relativeAge(published) : absoluteDate(published);

    // Where it came from, and when: the game it is about, the feed and its age, as one line of small capitals.
    const source = (
        <p className={`flex min-w-0 flex-wrap items-baseline gap-x-2 type-kicker ${variant === 'lead' ? 'text-fg-muted' : 'text-fg-faint'}`}>
            {showGame && (
                <>
                    <Link
                        to={`/games/${item.gameId}`}
                        className={`truncate max-w-[60%] hover:underline ${variant === 'lead' ? 'text-primary-400' : 'text-fg-soft'}`}
                    >
                        {item.gameTitle}
                    </Link>
                    <span aria-hidden="true">·</span>
                </>
            )}
            {variant !== 'brief' && <span className="truncate">{item.source}</span>}
            {variant !== 'brief' && age && <span aria-hidden="true">·</span>}
            {age && <time dateTime={item.publishedAt} className="shrink-0">{age}</time>}
        </p>
    );

    /*
     * Opens on Steam, so it leaves the app: noopener is a security requirement, not a formality —
     * without it the opened page can reach back through window.opener.
     */
    const headline = (className: string) => (
        <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`block text-fg-strong hover:underline-quiet ${className}`}
        >
            {item.title}{' '}
            <span className="sr-only">(opens in a new tab)</span>
        </a>
    );

    if (variant === 'lead') {
        return (
            <article className="border-t border-line pt-5">
                {source}
                {headline('mt-3 type-display text-3xl sm:text-4xl text-balance')}
                {item.excerpt && (
                    <p className="mt-4 max-w-prose text-lg leading-relaxed text-fg-soft line-clamp-4">{item.excerpt}</p>
                )}
            </article>
        );
    }

    if (variant === 'brief') {
        return (
            <article className="py-3.5 border-b border-line">
                {source}
                {headline('mt-1 type-title text-lg leading-snug')}
            </article>
        );
    }

    return (
        <article className="flex gap-4 py-5 border-b border-line">
            {showGame && item.gameCoverUrl && (
                <Link
                    to={`/games/${item.gameId}`}
                    className="shrink-0"
                    aria-label={item.gameTitle}
                >
                    {/* Its `w-12 h-16` box is three by four, so the cover is drawn at its width. */}
                    <CoverImage
                        url={item.gameCoverUrl}
                        alt=""
                        sizes="3rem"
                        className="w-12 h-16 object-cover rounded-sm"
                    />
                </Link>
            )}

            <div className="min-w-0 flex-1">
                {source}
                {headline('mt-1.5 type-title text-lg leading-snug')}
                {item.excerpt && (
                    <p className="mt-1.5 text-sm text-fg-muted leading-relaxed line-clamp-2">
                        {item.excerpt}
                    </p>
                )}
            </div>
        </article>
    );
}
