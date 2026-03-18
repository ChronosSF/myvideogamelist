import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import './UserPage.css';

export function UserPage() {
    const { user, logout, updateTheme } = useAuth();
    const navigate = useNavigate();

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
        await updateTheme(checked ? 'light' : 'dark');
    };

    const handleLogout = async () => {
        await logout();
        navigate('/');
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

                {/* Theme preference */}
                <div className="user-card">
                    <div className="user-card-row">
                        <div className="user-card-info">
                            <div className="user-card-label">Appearance</div>
                            <div className="user-card-value">
                                {isLight ? 'Light mode' : 'Dark mode'}
                            </div>
                            <p className="theme-save-hint">Saved automatically</p>
                        </div>

                        <div className="theme-toggle-wrap" aria-label="Toggle theme">
                            {/* Moon icon */}
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

                            {/* Sun icon */}
                            <svg className="theme-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                            </svg>
                        </div>
                    </div>
                </div>

                <button className="user-logout-btn" onClick={handleLogout}>
                    Sign Out
                </button>
            </div>
        </div>
    );
}
