import { Link } from 'react-router';
import { useAuthDialog } from '@/hooks/useAuthDialog';

/** What the site keeps for somebody, as the panel's contents list says it. */
const POINTS: readonly { title: string; text: string }[] = [
    { title: 'Your lists', text: 'From Playing to Finished, and a backlog in the order you’ll play it.' },
    { title: 'A wishlist that keeps the dates', text: 'It tells you when each game comes out.' },
    { title: 'Your year in numbers', text: 'What you’ve finished, and the hours it took.' },
];

/**
 * What a visitor who has not signed in sees first: what the site is for, and the two ways in.
 *
 * Set as a front page (ADR 0075): the promise as the headline, the three things it keeps as a numbered
 * contents list beside it. Words and the palette alone — no game's art and no other service's data, so it
 * never says anything a source could take back, and never fails.
 *
 * Also what the server renders for a request carrying no signed-in flag (ADR 0074). Somebody signed in
 * whose flag is gone sees it for one page load, until auth answers and the Welcome back band replaces it.
 */
export function WelcomePanel() {
    const authDialog = useAuthDialog();

    return (
        // The headline and the ways in, and the contents list beside them from a desktop's width, under
        // them below it.
        <section className="grid items-end gap-x-20 gap-y-14 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 sm:pt-24 pb-14 sm:pb-20" aria-labelledby="welcome-heading">
            <div>
                <h1 id="welcome-heading" className="type-display text-5xl sm:text-7xl lg:text-[4.75rem] text-fg-strong text-balance">
                    Every game you&apos;ve played,{' '}
                    <span className="text-primary-400">in one list</span>
                </h1>
                <p className="mt-8 max-w-xl text-lg sm:text-xl leading-relaxed text-fg-soft">
                    Keep track of what you&apos;re playing, what you&apos;ll get to next, and when the
                    games you&apos;re waiting for come out.
                </p>

                <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
                    <button
                        type="button"
                        onClick={() => authDialog.open('signup')}
                        className="inline-flex items-center px-6 py-3.5 btn-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                    >
                        Create an account
                    </button>
                    <button
                        type="button"
                        onClick={() => authDialog.open('login')}
                        className="font-semibold text-link focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus rounded-sm"
                    >
                        Sign in
                    </button>
                </div>

                <p className="mt-5 text-sm text-fg-muted">
                    Free to join. Or{' '}
                    <Link to="/games" className="text-fg-soft underline underline-offset-2 hover:text-fg-strong transition-colors">
                        browse the games
                    </Link>{' '}
                    first.
                </p>
            </div>

            <div className="rule-heavy">
                <p className="mt-3.5 type-kicker text-fg-muted">What it keeps for you</p>
                <ol className="mt-1">
                    {POINTS.map((point, index) => (
                        <li key={point.title} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-4 py-5 border-b border-line">
                            <span aria-hidden="true" className="type-display text-4xl text-primary-500 leading-none">
                                {String(index + 1).padStart(2, '0')}
                            </span>
                            <span>
                                <span className="block type-title text-xl text-fg-strong">{point.title}</span>
                                <span className="block mt-1 text-sm text-fg-muted">{point.text}</span>
                            </span>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}
