import { useId, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { LoginDialog } from '@/components/LoginDialog';
import { SignupDialog } from '@/components/SignupDialog';
import { Logo } from '@/components/Logo';
import './Navbar.css';

type DialogState = 'none' | 'login' | 'signup';

interface NavItem {
    to: string;
    label: string;
    end?: boolean;
}

export function Navbar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [dialog, setDialog] = useState<DialogState>('none');
    const [menuOpen, setMenuOpen] = useState(false);

    // The main menu carries the nav links below md, where the row has no room for them.
    const [mainMenuOpen, setMainMenuOpen] = useState(false);
    const mainMenuId = useId();
    const mainMenuButton = useRef<HTMLButtonElement>(null);

    // Any navigation closes it — a back-swipe included, which touches nothing in the menu and so
    // would otherwise leave it open over the next page. Adjusted during render rather than in an
    // effect, which would paint it open over that page for a commit and trips
    // react-hooks/set-state-in-effect.
    const [lastLocationKey, setLastLocationKey] = useState(location.key);
    if (lastLocationKey !== location.key) {
        setLastLocationKey(location.key);
        setMainMenuOpen(false);
    }

    // Both states need explicit light: variants. Without them light mode inherited the dark
    // palette against a near-white bar: 2.45:1 inactive and 1.84:1 active, well under AA. The
    // main menu is painted in the bar's own colours, so the same pairs hold there.
    const navLinkColours = (isActive: boolean) =>
        isActive
            ? 'bg-blue-600/20 text-blue-400 light:bg-blue-100 light:text-blue-800'
            : 'text-slate-400 hover:text-white hover:bg-slate-800 '
              + 'light:text-slate-600 light:hover:text-slate-900 light:hover:bg-slate-200';

    const navLinkClass = ({ isActive }: { isActive: boolean }) =>
        `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${navLinkColours(isActive)}`;

    // Stacked full width in the main menu, and tall enough to hit with a thumb.
    const mainMenuLinkClass = ({ isActive }: { isActive: boolean }) =>
        `block px-3 py-2.5 rounded-lg text-base font-medium transition-colors ${navLinkColours(isActive)}`;

    const navItems: NavItem[] = [
        { to: '/', label: 'Home', end: true },
        { to: '/games', label: 'Games' },
        { to: '/lists', label: 'Lists' },
        // Gated on auth, unlike Lists: the wishlist has no signed-out story to tell, so an
        // anonymous visitor would land on a page that only asks them to sign in.
        ...(user ? [{ to: '/wishlist', label: 'Wishlist' }] : []),
    ];

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
                        <div className="flex items-center gap-2">
                            {/* Main menu. The panel follows its button in the DOM so that Tab
                                reaches the links next, and focus leaving the pair closes it, so a
                                keyboard user who tabs past the last link is not left with a panel
                                covering the page. */}
                            <nav
                                className="md:hidden"
                                aria-label="Main navigation"
                                onKeyDown={e => {
                                    if (e.key === 'Escape' && mainMenuOpen) {
                                        setMainMenuOpen(false);
                                        mainMenuButton.current?.focus();
                                    }
                                }}
                                onBlur={e => {
                                    if (mainMenuOpen && !e.currentTarget.contains(e.relatedTarget)) {
                                        setMainMenuOpen(false);
                                    }
                                }}
                            >
                                <button
                                    ref={mainMenuButton}
                                    type="button"
                                    className="navbar-menu-btn"
                                    onClick={() => {
                                        setMenuOpen(false);
                                        setMainMenuOpen(o => !o);
                                    }}
                                    aria-expanded={mainMenuOpen}
                                    aria-controls={mainMenuId}
                                    aria-label="Main menu"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d={mainMenuOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'}
                                        />
                                    </svg>
                                </button>

                                <div
                                    id={mainMenuId}
                                    className="navbar-main-menu grid gap-1 px-4 sm:px-6 py-3"
                                    hidden={!mainMenuOpen}
                                >
                                    {navItems.map(item => (
                                        <NavLink
                                            key={item.to}
                                            to={item.to}
                                            end={item.end}
                                            className={mainMenuLinkClass}
                                            onClick={() => setMainMenuOpen(false)}
                                        >
                                            {item.label}
                                        </NavLink>
                                    ))}
                                </div>
                            </nav>

                            {/* Logo / Brand */}
                            <Link to="/" className="flex items-center gap-2.5 text-slate-100 light:text-slate-900 font-bold text-lg hover:opacity-80 transition-opacity">
                                <Logo className="w-7 h-7" />
                                {/* Visually hidden below sm rather than removed: it is the link's
                                    only accessible name, and display: none would leave a link to
                                    the home page that says nothing at all. */}
                                <span className="sr-only sm:not-sr-only">MyVideoGame<span className="text-lime-400 light:text-lime-600">List</span></span>
                            </Link>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Navigation Links */}
                            <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
                                {navItems.map(item => (
                                    <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                                        {item.label}
                                    </NavLink>
                                ))}
                            </nav>

                            {/* Auth section */}
                            {user ? (
                                <div className="relative ml-2">
                                    <button
                                        className="navbar-user-btn"
                                        onClick={() => {
                                            setMainMenuOpen(false);
                                            setMenuOpen(o => !o);
                                        }}
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

            {/* Outside the header on purpose — see .navbar-scrim. */}
            {mainMenuOpen && (
                <div className="navbar-scrim md:hidden" onClick={() => setMainMenuOpen(false)} aria-hidden="true" />
            )}

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
