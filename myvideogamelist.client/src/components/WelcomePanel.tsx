import { Link } from 'react-router';
import { useAuthDialog } from '@/hooks/useAuthDialog';
import { LIST_NAMES, type ListId } from '@/types/list';
import './WelcomePanel.css';

/** The lists the drawing shows, in the share image's order, each with how long its first line runs. */
const DRAWN: readonly { list: ListId; width: string }[] = [
    { list: 'playing', width: '88%' },
    { list: 'finished', width: '72%' },
    { list: 'on_hold', width: '94%' },
    { list: 'backlog', width: '66%' },
    { list: 'dropped', width: '80%' },
];

/**
 * What a visitor who has not signed in sees first: what the site is for, and the two ways in.
 *
 * Drawn from the palette and nothing else — no game's art and no other service's data, so it never says
 * anything a source could take back, and never fails. Its drawing is a list as the app draws one with
 * nothing real in it, as the default share image's is, so a shared link and the page it opens match.
 *
 * Also what the server renders for everybody, since that render has no cookie; somebody signed in sees
 * it until auth answers and the Welcome back band replaces it.
 */
export function WelcomePanel() {
    const authDialog = useAuthDialog();

    return (
        <section className="welcome-panel" aria-labelledby="welcome-heading">
            <div className="welcome-panel-grid max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
                <div>
                    <h1 id="welcome-heading" className="text-3xl sm:text-4xl lg:text-5xl font-bold text-fg-strong leading-tight">
                        Every game you&apos;ve played,{' '}
                        <span className="text-primary-400">in one list</span>
                    </h1>
                    <p className="mt-4 max-w-xl text-base sm:text-lg leading-relaxed text-fg-soft">
                        Keep track of what you&apos;re playing, what you&apos;ll get to next, and when the
                        games you&apos;re waiting for come out.
                    </p>

                    <ul className="welcome-panel-points">
                        <li>Lists from Playing to Finished, and a backlog in the order you&apos;ll play it</li>
                        <li>A wishlist that tells you when each game comes out</li>
                        <li>Your year in numbers: what you&apos;ve finished, and the hours it took</li>
                    </ul>

                    <div className="mt-8 flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={() => authDialog.open('signup')}
                            className="inline-flex items-center px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-on-primary font-semibold rounded-xl transition-colors shadow-lg shadow-primary-950/50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus"
                        >
                            Create an account
                        </button>
                        <button
                            type="button"
                            onClick={() => authDialog.open('login')}
                            className="inline-flex items-center px-5 py-2.5 bg-white/10 hover:bg-white/20 text-fg-strong font-semibold rounded-xl transition-colors border border-white/15 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus"
                        >
                            Sign in
                        </button>
                    </div>

                    <p className="mt-4 text-sm text-fg-muted">
                        Free to join. Or{' '}
                        <Link to="/games" className="text-fg-soft underline underline-offset-2 hover:text-primary-400 transition-colors">
                            browse the games
                        </Link>{' '}
                        first.
                    </p>
                </div>

                {/* Decoration: the sentences above say everything it does. */}
                <div className="welcome-panel-list" aria-hidden="true">
                    {DRAWN.map(({ list, width }) => (
                        <div key={list} className={`welcome-panel-row welcome-status-${list}`}>
                            <span className="welcome-panel-cover" />
                            <span className="welcome-panel-lines">
                                <span style={{ width }} />
                                <span />
                            </span>
                            <span className="welcome-panel-chip">{LIST_NAMES[list]}</span>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
