import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { ProfileStats } from '@/components/ProfileStats';
import { useHiddenPlatforms } from '@/hooks/useHiddenPlatforms';
import type { PlatformDto } from '@/types/game';
import './UserPage.css';
import { PRIVATE_NO_STORE } from '@/lib/cache';

function useActivePlatforms() {
    const [platforms, setPlatforms] = useState<PlatformDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        fetch('/api/platforms/active', { signal: controller.signal })
            .then(r => {
                if (!r.ok) throw new Error(`Failed to load platforms (${r.status})`);
                return r.json() as Promise<PlatformDto[]>;
            })
            .then(data => setPlatforms(data))
            .catch(err => {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : 'Unexpected error');
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, []);

    return { platforms, loading, error };
}

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

export function UserPage() {
    const { user, logout, updateTheme } = useAuth();
    const navigate = useNavigate();

    const [themeError, setThemeError] = useState<string | null>(null);

    const { platforms: activePlatforms, loading: platformsLoading } = useActivePlatforms();
    const { hiddenIds, loading: hiddenLoading, saving, error: hiddenError, setHiddenIds, save } = useHiddenPlatforms(user !== null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    if (!user) {
        return (
            <div className="user-page">
                <div className="user-page-inner">
                    <p className="user-page-subtitle">You are not signed in.</p>
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

    return (
        <div className="user-page">
            <div className="user-page-inner">
                <div className="user-page-header">
                    <h1 className="user-page-title">My Profile</h1>
                    <p className="user-page-subtitle">Manage your account settings</p>
                </div>

                {/* Account info */}
                <div className="user-card">
                    <div className="user-card-label">Email</div>
                    <div className="user-card-value">{user.email}</div>
                </div>

                {/* Above the settings, because what the user has done is the reason they came here
                    and the theme toggle is not. Mounted only in this signed-in branch, which is
                    what lets its hook skip an account-change guard. */}
                <div className="user-card">
                    <ProfileStats />
                </div>

                {/* Theme preference */}
                <div className="user-card">
                    <div className="user-card-row">
                        <div className="user-card-info">
                            <div className="user-card-label">Appearance</div>
                            <div className="user-card-value">
                                {isLight ? 'Light mode' : 'Dark mode'}
                            </div>
                            <p className="theme-save-hint">
                                {themeError ?? 'Saved automatically'}
                            </p>
                        </div>

                        <div className="theme-toggle-wrap" aria-label="Toggle theme">
                            <svg className="theme-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                            </svg>
                            <label className="toggle">
                                <input
                                    type="checkbox"
                                    checked={isLight}
                                    onChange={e => handleThemeChange(e.target.checked)}
                                    aria-label="Switch to light mode"
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
                </div>

                {/* Upcoming Timeline — Platform Preferences */}
                <div className="user-card">
                    <div className="user-card-label">Upcoming Releases — Platform Visibility</div>
                    <p className="theme-save-hint" style={{ marginBottom: '1rem' }}>
                        Platforms unchecked here will be hidden from the filter row on the home page timeline.
                        Games available only on hidden platforms will not appear.
                    </p>

                    {(platformsLoading || hiddenLoading) && (
                        <p className="theme-save-hint">Loading platforms…</p>
                    )}

                    {!platformsLoading && !hiddenLoading && activePlatforms.length === 0 && (
                        <p className="theme-save-hint">No active platforms found.</p>
                    )}

                    {!platformsLoading && !hiddenLoading && activePlatforms.length > 0 && (
                        <div className="platform-prefs-grid">
                            {activePlatforms.map(p => {
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

                    {hiddenError && (
                        <p className="user-pref-error">{hiddenError}</p>
                    )}

                    {!platformsLoading && !hiddenLoading && activePlatforms.length > 0 && (
                        <button
                            className="user-save-btn"
                            onClick={handleSaveHiddenPlatforms}
                            disabled={saving}
                        >
                            {saving ? 'Saving…' : saveSuccess ? '✓ Saved' : 'Save preferences'}
                        </button>
                    )}
                </div>

                <button className="user-logout-btn" onClick={handleLogout}>
                    Sign Out
                </button>
            </div>
        </div>
    );
}

export default UserPage;
