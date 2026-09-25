import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { ProfileStats } from '@/components/ProfileStats';
import { FavouritesShowcase } from '@/components/FavouritesShowcase';
import { AccountIdentityCard } from '@/components/AccountIdentityCard';
import { AccountDataCard } from '@/components/AccountDataCard';
import { ListNamesCard } from '@/components/ListNamesCard';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';
import './UserPage.css';

/**
 * This route renders the signed-in user's own profile and settings. Stated explicitly rather than left to inherit the root default, so that changing the
 * root's policy later cannot silently make this page shared.
 */
export function headers() {
    return { 'Cache-Control': PRIVATE_NO_STORE };
}

export function meta() {
    return [
        { title: 'My profile - MyVideoGameList' },
        { name: 'description', content: 'Manage your account settings and preferences.' },
        // What a crawler is served here is the signed-out shell, which is a page about nothing.
        NOINDEX,
    ];
}

/**
 * The band Lists, Wishlist and Games open with, markup and all, so this page reads as part of the
 * same site rather than a settings dialog floating in it. Copied rather than restyled: a heading
 * that looks right only because it has its own classes is one that drifts from the others.
 */
function PageHeader() {
    return (
        <div className="bg-gradient-to-b from-blue-950/60 to-slate-900 light:from-blue-50/80 light:to-slate-50 border-b border-slate-700/50 light:border-slate-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <h1 className="text-3xl sm:text-4xl font-bold text-white light:text-slate-900 mb-1">My Profile</h1>
                <p className="text-slate-400 light:text-slate-600 text-sm sm:text-base">
                    Your tracking, and the settings for your account.
                </p>
            </div>
        </div>
    );
}

export function UserPage() {
    const { user, loading, logout, updateTheme, deleteAccount } = useAuth();
    const navigate = useNavigate();

    const [themeError, setThemeError] = useState<string | null>(null);

    /**
     * Set before the deletion request rather than after it, and that ordering is the point. The
     * render in which the account disappears is the one `deleteAccount` causes, and it has to know
     * why nobody is signed in — set afterwards, that render would say "Sign in to see your profile"
     * to somebody who has just deleted theirs, and correct itself a frame later.
     */
    const [accountDeleted, setAccountDeleted] = useState(false);

    // `loading` before `user`: the server render never knows who is signed in, and neither does the
    // first client render, so without it every visit opened on "sign in" and then replaced it.
    if (loading || !user) {
        return (
            <div className="min-h-screen">
                <PageHeader />
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <div className="flex items-center justify-center py-24">
                        {loading ? (
                            <div className="flex flex-col items-center gap-4" role="status">
                                <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" aria-hidden="true" />
                                <p className="text-slate-400 light:text-slate-600 text-sm">Loading your profile…</p>
                            </div>
                        ) : accountDeleted ? (
                            // A live region, so the outcome of a request made from a dialog that
                            // has just vanished is announced rather than left to be discovered.
                            <div className="text-center max-w-md" role="status">
                                <p className="text-slate-200 light:text-slate-800 font-medium mb-2">
                                    Your account has been deleted.
                                </p>
                                <p className="text-slate-400 light:text-slate-600 text-sm mb-6">
                                    Everything you had recorded went with it.
                                </p>
                                <Link
                                    to="/"
                                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
                                >
                                    Back to the home page
                                </Link>
                            </div>
                        ) : (
                            <div className="text-center">
                                <svg className="w-14 h-14 text-slate-700 light:text-slate-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                <p className="text-slate-400 light:text-slate-600 font-medium">
                                    Sign in to see your profile.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    const handleThemeChange = async (checked: boolean) => {
        setThemeError(null);
        try {
            await updateTheme(checked ? 'light' : 'dark');
        } catch {
            setThemeError('Failed to save theme. Please try again.');
        }
    };

    const handleLogout = async () => {
        await logout();
        navigate('/');
    };

    // Stays on this page rather than navigating home: the confirmation is only worth anything
    // where the person who asked for it is looking. See `accountDeleted` for the ordering.
    const handleDeleteAccount = async (password: string) => {
        setAccountDeleted(true);
        try {
            await deleteAccount(password);
        } catch (err) {
            setAccountDeleted(false);
            throw err;
        }
    };

    const isLight = user.theme === 'light';

    return (
        <div className="min-h-screen">
            <PageHeader />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Three areas rather than two columns: stacked, they read in source order — who
                    you are, what you have done, then preferences — and from lg up the tracking
                    takes the main column while both groups of settings share a sidebar. */}
                <div className="user-page-grid">
                    <section className="user-page-account" aria-label="Account">
                        {/* The email is here and nowhere else — it identifies the account to us
                            and appears on nothing anybody else can read. */}
                        <div className="user-card">
                            <div className="user-card-label">Email</div>
                            <div className="user-card-value">{user.email}</div>
                            <p className="user-card-hint">Only you can see this.</p>
                        </div>

                        {/* Directly under it, because the two answer the same question from
                            opposite sides: what we know you by, and what everybody else does. */}
                        <AccountIdentityCard user={user} />
                    </section>

                    {/* The main column, because what the user has done is the reason they came here
                        and the theme toggle is not. The favourites open it, as they open the public
                        profile: a showcase is the part of a profile chosen to be looked at. */}
                    <div className="user-page-tracking">
                        <div className="user-card">
                            <FavouritesShowcase profileVisibility={user.profileVisibility} />
                        </div>
                        <div className="user-card">
                            <ProfileStats userId={user.id} />
                        </div>
                    </div>

                    <section className="user-page-prefs" aria-label="Preferences">
                        <div className="user-card">
                            <div className="user-card-label">Appearance</div>
                            <div className="user-card-row">
                                <div className="user-card-value">
                                    {isLight ? 'Light mode' : 'Dark mode'}
                                </div>

                                <div className="theme-toggle-wrap">
                                    <svg className="theme-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                                    </svg>
                                    <label className="toggle">
                                        {/* Named for the state rather than the action, so that
                                            "checked" reads true: "switch to light mode, checked"
                                            said nothing about which mode was on. */}
                                        <input
                                            type="checkbox"
                                            checked={isLight}
                                            onChange={e => handleThemeChange(e.target.checked)}
                                            aria-label="Light mode"
                                        />
                                        <span className="toggle-track" />
                                        <span className="toggle-thumb" />
                                    </label>
                                    <svg className="theme-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                                    </svg>
                                </div>
                            </div>
                            <p className="user-card-hint">Saved automatically</p>
                            {themeError && <p className="user-pref-error" role="alert">{themeError}</p>}
                        </div>

                        {/* Beside the appearance, because both change how the site reads to this
                            person and to nobody else. */}
                        <ListNamesCard />

                        {/* Here rather than beside the export in "Your data", which is the
                            section holding the one thing that cannot be undone — an import is
                            reviewed before it writes and belongs nowhere near that warning. */}
                        <div className="user-card">
                            <div className="user-card-label">Import from another tracker</div>
                            <p className="user-card-hint">
                                Bring your games across from Grouvee. You see every game, and what we
                                made of it, before anything is saved.
                            </p>
                            <Link to="/import" className="user-btn user-card-action">Start an import</Link>
                        </div>

                        <button type="button" className="user-logout-btn" onClick={handleLogout}>
                            Sign Out
                        </button>

                        {/* Last, below Sign Out, where a settings page conventionally keeps the
                            one thing on it that cannot be undone. A section of its own, since
                            neither half of it is a preference. */}
                        <section aria-label="Your data">
                            <AccountDataCard userName={user.userName} onDeleteAccount={handleDeleteAccount} />
                        </section>
                    </section>
                </div>
            </div>
        </div>
    );
}

export default UserPage;
