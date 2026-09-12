import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { LoginDialog } from '@/components/LoginDialog';
import { SignupDialog } from '@/components/SignupDialog';
import { Logo } from '@/components/Logo';
import './Navbar.css';

type DialogState = 'none' | 'login' | 'signup';

export function Navbar() {
    const { user, loading: authLoading, logout } = useAuth();
    const navigate = useNavigate();
    const [dialog, setDialog] = useState<DialogState>('none');
    const [menuOpen, setMenuOpen] = useState(false);

    // Both states need explicit light: variants. Without them light mode inherited the dark
    // palette against a near-white bar: 2.45:1 inactive and 1.84:1 active, well under AA.
    const navLinkClass = ({ isActive }: { isActive: boolean }) =>
        `px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
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
                        <Link to="/" className="shrink-0 flex items-center gap-2.5 text-slate-100 light:text-slate-900 font-bold text-lg hover:opacity-80 transition-opacity">
                            <Logo className="w-7 h-7" />
                            {/* Icon-only on a phone, where the name and the links do not fit on one
                                row. It stays in the accessibility tree as the link's name. Not
                                `sr-only sm:not-sr-only`: ListTable.css defines an unlayered .sr-only
                                that would outrank the sm: utility once the lists page had loaded. */}
                            <span className="max-sm:sr-only">MyVideoGame<span className="text-lime-400 light:text-lime-600">List</span></span>
                        </Link>

                        <div className="flex items-center gap-2 min-w-0">
                            {/* Navigation Links */}
                            <nav className="navbar-links flex items-center gap-1" aria-label="Main navigation">
                                <NavLink to="/" end className={navLinkClass}>Home</NavLink>
                                <NavLink to="/games" className={navLinkClass}>Games</NavLink>
                                <NavLink to="/lists" className={navLinkClass}>Lists</NavLink>
                                {/* Gated on auth, unlike Lists: the wishlist has no signed-out
                                    story to tell, so an anonymous visitor would land on a page
                                    that only asks them to sign in. Held back until auth has
                                    answered, like the auth section below. */}
                                {!authLoading && user && <NavLink to="/wishlist" className={navLinkClass}>Wishlist</NavLink>}
                            </nav>

                            {/* Auth section. Nobody is signed in or out until auth has answered:
                                the server render never knows, and the first client render has to
                                match it. Until then this holds the space the Sign In / Sign Up
                                pair takes, with nothing in it — sized for the pair because a
                                signed-out visitor then sees no shift at all, and a signed-in one
                                sees their avatar arrive instead of the wrong buttons. */}
                            {authLoading ? (
                                <div className="navbar-auth-placeholder sm:ml-2" />
                            ) : user ? (
                                <div className="relative shrink-0 sm:ml-2">
                                    <button
                                        className="navbar-user-btn"
                                        onClick={() => setMenuOpen(o => !o)}
                                        aria-haspopup="true"
                                        aria-expanded={menuOpen}
                                        aria-label="User menu"
                                    >
                                        {/* The username, not the email. The initial of an address
                                            is an initial of something the user did not choose to
                                            be known by, and often is not even a letter. */}
                                        <span className="navbar-avatar" aria-hidden="true">
                                            {user.userName.charAt(0).toUpperCase()}
                                        </span>
                                        <svg className="w-3.5 h-3.5 text-slate-400 light:text-slate-500 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>

                                    {menuOpen && (
                                        <>
                                            <div className="navbar-dropdown-overlay" onClick={() => setMenuOpen(false)} />
                                            <div className="navbar-dropdown" role="menu">
                                                <div className="navbar-dropdown-email">@{user.userName}</div>
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
                                                {/* Only when there is one. A link to a page that
                                                    404s for everybody including its owner would be
                                                    a worse explanation of the privacy setting than
                                                    its absence is. */}
                                                {user.profileVisibility === 'public' && (
                                                    <Link
                                                        to={`/u/${user.userName}`}
                                                        className="navbar-dropdown-item"
                                                        role="menuitem"
                                                        onClick={() => setMenuOpen(false)}
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18a15 15 0 010-18z" />
                                                        </svg>
                                                        My public page
                                                    </Link>
                                                )}
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
                                <div className="flex items-center gap-2 shrink-0 sm:ml-2">
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
