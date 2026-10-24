import { Link } from 'react-router';
import { Logo } from '@/components/Logo';
import { DISCORD_INVITE_URL } from '@/lib/links';

/** How a link out of the site opens, as everywhere else on the site. Never `nofollow`: see below. */
const OUTSIDE = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * What a screen reader hears after each of those links' names, since nothing else says it leaves for
 * a new tab. The space is inside the hidden text: before it, it would be an underlined gap ahead of
 * the full stop that follows each credit.
 */
const NEW_TAB = <span className="sr-only"> (opens in a new tab)</span>;

const LINK = 'text-fg-soft hover:text-fg-strong transition-colors';
const CREDIT = 'text-fg-soft hover:text-fg-strong underline underline-offset-2 transition-colors';
const HEADING = 'text-xs font-semibold uppercase tracking-wider text-fg-muted mb-3';

/**
 * The foot of every page (issue 237): the site's own links, and the credits its sources ask for.
 *
 * IGDB asks for a credit visible to every user in a place that does not move, as the condition of its
 * commercial partnership. Steam's terms, for the news, ask for its name and a link, forbid marking
 * that link `nofollow`, and forbid anything implying that Valve endorses the site. Both credits are
 * in `fg-muted` or brighter, because a credit nobody can read is not one.
 *
 * A link joins when its page exists: the privacy policy and the cookie settings come with issue 141.
 */
export function SiteFooter() {
    return (
        <footer className="border-t border-line bg-sunken/40">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <div className="flex flex-col gap-8 md:flex-row md:justify-between">
                    <div className="max-w-xs">
                        <Link to="/" className="inline-flex items-center gap-2 font-bold text-fg-strong">
                            <Logo className="w-6 h-6" />
                            MyVideoGameList
                        </Link>
                        <p className="mt-3 text-sm text-fg-muted">
                            Track every game you play, and see what is coming for the ones you are waiting for.
                        </p>
                    </div>

                    <nav aria-label="Footer" className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
                        <div>
                            <h2 className={HEADING}>Explore</h2>
                            <ul className="space-y-2">
                                <li><Link to="/games" className={LINK}>Browse games</Link></li>
                                <li><Link to="/calendar" className={LINK}>Release calendar</Link></li>
                                <li><Link to="/news" className={LINK}>Game news</Link></li>
                            </ul>
                        </div>
                        <div>
                            <h2 className={HEADING}>Community</h2>
                            <ul className="space-y-2">
                                <li><a href={DISCORD_INVITE_URL} {...OUTSIDE} className={LINK}>Discord{NEW_TAB}</a></li>
                            </ul>
                        </div>
                        <div>
                            <h2 className={HEADING}>Legal</h2>
                            <ul className="space-y-2">
                                <li><Link to="/terms" className={LINK}>Terms of use</Link></li>
                            </ul>
                        </div>
                    </nav>
                </div>

                <div className="mt-10 pt-6 border-t border-line flex flex-col gap-2 text-xs text-fg-muted md:flex-row md:justify-between">
                    <p>© 2026 MyVideoGameList</p>
                    <p>
                        Game data from <a href="https://www.igdb.com" {...OUTSIDE} className={CREDIT}>IGDB.com{NEW_TAB}</a>.
                        {' '}News from <a href="https://store.steampowered.com" {...OUTSIDE} className={CREDIT}>Steam{NEW_TAB}</a>.
                        {' '}Not affiliated with or endorsed by Valve.
                    </p>
                </div>
            </div>
        </footer>
    );
}
