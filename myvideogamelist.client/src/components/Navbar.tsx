import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { LoginDialog } from '@/components/LoginDialog';
import { SignupDialog } from '@/components/SignupDialog';
import { Logo } from '@/components/Logo';
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
                        <Link to="/" className="flex items-center gap-2.5 text-slate-100 light:text-slate-900 font-bold text-lg hover:opacity-80 transition-opacity">
                            <Logo className="w-7 h-7" />
                            <span>MyVideoGame<span className="text-lime-400 light:text-lime-600">List</span></span>
                        </Link>

                        <div className="flex items-center gap-2">
                            {/* Navigation Links */}
                            <nav className="flex items-center gap-1" aria-label="Main navigation">
                                <NavLink to="/" end className={navLinkClass}>Home</NavLink>
                                <NavLink to="/games" className={navLinkClass}>Games</NavLink>
                                <NavLink to="/lists" className={navLinkClass}>Lists</NavLink>
                                {/* Gated on auth, unlike Lists: the wishlist has no signed-out
                                    story to tell, so an anonymous visitor would land on a page
                                    that only asks them to sign in. */}
                                {user && <NavLink to="/wishlist" className={navLinkClass}>Wishlist</NavLink>}
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
