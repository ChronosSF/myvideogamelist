import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { LoginDialog } from '@/components/LoginDialog';
import { SignupDialog } from '@/components/SignupDialog';
import './Navbar.css';

type DialogState = 'none' | 'login' | 'signup';

export function Navbar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [dialog, setDialog] = useState<DialogState>('none');
    const [menuOpen, setMenuOpen] = useState(false);

    // Both states need explicit light: variants. Without them light mode inherited the dark
    // palette against a near-white bar: 2.45:1 inactive and 1.84:1 active, well under AA.
    const navLinkClass = ({ isActive }: { isActive: boolean }) =>
        `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            isActive
                ? 'bg-blue-600/20 text-blue-400 light:bg-blue-100 light:text-blue-800'
                : 'text-slate-400 hover:text-white hover:bg-slate-800 '
                  + 'light:text-slate-600 light:hover:text-slate-900 light:hover:bg-slate-200'
        }`;

    const handleLogout = async () => {
        setMenuOpen(false);
        await logout();
        navigate('/');
    };

    return (
        <>
            <header className="navbar-root">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-14">
                        {/* Logo / Brand */}
                        <Link to="/" className="flex items-center gap-2 text-slate-100 light:text-slate-900 font-bold text-lg hover:text-blue-400 light:hover:text-blue-500 transition-colors">
                            <svg className="w-7 h-7 text-blue-500" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M21 6.5a2.5 2.5 0 00-2.5-2.5H5.5A2.5 2.5 0 003 6.5v11A2.5 2.5 0 005.5 20h13a2.5 2.5 0 002.5-2.5v-11zM8 15.5a.5.5 0 01-.5-.5V9a.5.5 0 011 0v6a.5.5 0 01-.5.5zm4 0a.5.5 0 01-.5-.5V9a.5.5 0 011 0v6a.5.5 0 01-.5.5zm4-3a.5.5 0 01-.5-.5v-3a.5.5 0 011 0v3a.5.5 0 01-.5.5z" />
                            </svg>
                            <span>MyVideoGameList</span>
                        </Link>

                        <div className="flex items-center gap-2">
                            {/* Navigation Links */}
                            <nav className="flex items-center gap-1" aria-label="Main navigation">
                                <NavLink to="/" end className={navLinkClass}>Home</NavLink>
                                <NavLink to="/games" className={navLinkClass}>Games</NavLink>
                                <NavLink to="/lists" className={navLinkClass}>Lists</NavLink>
                            </nav>

                            {/* Auth section */}
                            {user ? (
                                <div className="relative ml-2">
                                    <button
                                        className="navbar-user-btn"
                                        onClick={() => setMenuOpen(o => !o)}
                                        aria-haspopup="true"
                                        aria-expanded={menuOpen}
                                        aria-label="User menu"
                                    >
                                        <span className="navbar-avatar" aria-hidden="true">
                                            {user.email.charAt(0).toUpperCase()}
                                        </span>
                                        <svg className="w-3.5 h-3.5 text-slate-400 light:text-slate-500 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>

                                    {menuOpen && (
                                        <>
                                            <div className="navbar-dropdown-overlay" onClick={() => setMenuOpen(false)} />
                                            <div className="navbar-dropdown" role="menu">
                                                <div className="navbar-dropdown-email">{user.email}</div>
                                                <Link
                                                    to="/user"
                                                    className="navbar-dropdown-item"
                                                    role="menuitem"
                                                    onClick={() => setMenuOpen(false)}
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                    </svg>
                                                    My Profile
                                                </Link>
                                                <button
                                                    className="navbar-dropdown-item navbar-dropdown-logout"
                                                    role="menuitem"
                                                    onClick={handleLogout}
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                                    </svg>
                                                    Sign Out
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 ml-2">
                                    <button
                                        className="navbar-btn-ghost"
                                        onClick={() => setDialog('login')}
                                    >
                                        Sign In
                                    </button>
                                    <button
                                        className="navbar-btn-primary"
                                        onClick={() => setDialog('signup')}
                                    >
                                        Sign Up
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {dialog === 'login' && (
                <LoginDialog
                    onClose={() => setDialog('none')}
                    onSwitchToRegister={() => setDialog('signup')}
                />
            )}
            {dialog === 'signup' && (
                <SignupDialog
                    onClose={() => setDialog('none')}
                    onSwitchToLogin={() => setDialog('login')}
                />
            )}
        </>
    );
}
