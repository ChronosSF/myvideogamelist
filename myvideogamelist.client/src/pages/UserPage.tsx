import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { useActivePlatforms } from '@/hooks/useActivePlatforms';
import { useHiddenPlatforms } from '@/hooks/useHiddenPlatforms';
import { ProfileStats } from '@/components/ProfileStats';
import { AccountIdentityCard } from '@/components/AccountIdentityCard';
import { PRIVATE_NO_STORE } from '@/lib/cache';
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
    const { user, loading, logout, updateTheme } = useAuth();
    const navigate = useNavigate();

    const [themeError, setThemeError] = useState<string | null>(null);

    // Nothing on the signed-out page needs the platform list, so it is not asked for until somebody
    // is signed in.
    const platforms = useActivePlatforms(user !== null);
    const { hiddenIds, loading: hiddenLoading, saving, error: hiddenError, setHiddenIds, save } = useHiddenPlatforms(user?.id ?? null);
    const [saveSuccess, setSaveSuccess] = useState(false);

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

    const togglePlatformHidden = (id: number, visible: boolean) => {
        setSaveSuccess(false);
        setHiddenIds(prev => {
            const next = new Set(prev);
            if (visible) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleSaveHiddenPlatforms = async () => {
        try {
            await save();
            setSaveSuccess(true);
        } catch {
            setSaveSuccess(false);
        }
    };

    const isLight = user.theme === 'light';
    const platformsReady = !platforms.loading && !hiddenLoading;

    // A failed load leaves the previous list in the hook, so the error decides for itself whether
    // there is anything to show. A grid of checkboxes under "could not be loaded" is two answers to
    // one question, and saving from it would write a preference chosen against a list we have just
    // said we do not trust.
    const platformsUsable = platformsReady && platforms.error === null && platforms.platforms.length > 0;

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
                        and the theme toggle is not. */}
                    <div className="user-page-tracking user-card">
                        <ProfileStats userId={user.id} />
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

                        <div className="user-card">
                            <div className="user-card-label">Upcoming releases — platforms</div>
                            <p className="user-card-hint">
                                Platforms unchecked here will be hidden from the filter row on the home page timeline.
                                Games available only on hidden platforms will not appear.
                            </p>

                            {!platformsReady && (
                                <p className="user-card-hint">Loading platforms…</p>
                            )}

                            {/* Its own message rather than the empty one: the list comes from IGDB,
                                and "no active platforms" would blame the platforms for an outage.
                                A live region, because it replaces the loading line after a request
                                that nobody was watching happen. */}
                            {platformsReady && platforms.error !== null && (
                                <p className="user-pref-error" role="alert">
                                    The platform list could not be loaded just now.
                                </p>
                            )}

                            {platformsReady && platforms.error === null && platforms.platforms.length === 0 && (
                                <p className="user-card-hint">No active platforms found.</p>
                            )}

                            {platformsUsable && (
                                <div className="platform-prefs-grid">
                                    {platforms.platforms.map(p => {
                                        const visible = !hiddenIds.has(p.id);
                                        return (
                                            <label key={p.id} className={`platform-pref-label${visible ? ' checked' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={visible}
                                                    onChange={e => togglePlatformHidden(p.id, e.target.checked)}
                                                    aria-label={p.name}
                                                />
                                                <span className="platform-pref-name" title={p.name}>
                                                    {p.abbreviation || p.name}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}

                            {/* A live region for the same reason: a save that fails moves nothing
                                else on screen, since the rollback puts the button back as it was. */}
                            {hiddenError && (
                                <p className="user-pref-error" role="alert">{hiddenError}</p>
                            )}

                            {platformsUsable && (
                                <button
                                    type="button"
                                    className="user-btn user-btn-block"
                                    onClick={handleSaveHiddenPlatforms}
                                    disabled={saving}
                                >
                                    {saving ? 'Saving…' : saveSuccess ? '✓ Saved' : 'Save preferences'}
                                </button>
                            )}
                        </div>

                        <button type="button" className="user-logout-btn" onClick={handleLogout}>
                            Sign Out
                        </button>
                    </section>
                </div>
            </div>
        </div>
    );
}

export default UserPage;
