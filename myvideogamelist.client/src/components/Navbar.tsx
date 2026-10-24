import { useId, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '@/components/Avatar';
import { LoginDialog } from '@/components/LoginDialog';
import { SignupDialog } from '@/components/SignupDialog';
import { Logo } from '@/components/Logo';
import { NavbarSearch } from '@/components/NavbarSearch';
import { useMediaQuery } from '@/lib/useMediaQuery';
import './Navbar.css';

type DialogState = 'none' | 'login' | 'signup';

/** Where the search box moves into the bar, matching `NavbarSearch.css`. */
const SEARCH_IN_BAR = '(width >= 64rem)';

interface NavItem {
    to: string;
    label: string;
    end?: boolean;
}

export function Navbar() {
    const { user, loading: authLoading, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [dialog, setDialog] = useState<DialogState>('none');
    const [menuOpen, setMenuOpen] = useState(false);

    // The main menu carries the nav links below md, where the row has no room for them.
    const [mainMenuOpen, setMainMenuOpen] = useState(false);
    const mainMenuId = useId();
    const mainMenuButton = useRef<HTMLButtonElement>(null);

    // The search box below lg, where it opens from a button as a panel of its own. At most one of
    // it, the main menu and the user menu is open at a time.
    const [searchOpen, setSearchOpen] = useState(false);

    // From lg the box is in the bar and there is no panel, so a window widened past it with the panel
    // open drops it: left set, it would keep the box acting as the panel does — staying open when
    // focus goes nowhere — where nothing on screen says it is one.
    const searchInBar = useMediaQuery(SEARCH_IN_BAR);
    if (searchOpen && searchInBar) {
        setSearchOpen(false);
    }

    // Any navigation closes both panels — a back-swipe included, which touches nothing in either and
    // so would otherwise leave one open over the next page. Adjusted during render rather than in an
    // effect, which would paint it open over that page for a commit and trips
    // react-hooks/set-state-in-effect.
    const [lastLocationKey, setLastLocationKey] = useState(location.key);
    if (lastLocationKey !== location.key) {
        setLastLocationKey(location.key);
        setMainMenuOpen(false);
        setSearchOpen(false);
    }

    // The main menu is painted in the bar's own colours, so the same pairs hold there.
    const navLinkColours = (isActive: boolean) =>
        isActive
            ? 'bg-primary-600/20 text-primary-400'
            : 'text-fg-muted hover:text-fg-strong hover:bg-surface';

    // Narrower below lg, where the search button sits beside them: six links, the button and the
    // user menu only fit a 768px bar with eight pixels taken from each link.
    const navLinkClass = ({ isActive }: { isActive: boolean }) =>
        `px-2 lg:px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${navLinkColours(isActive)}`;

    // Stacked full width in the main menu, and tall enough to hit with a thumb.
    const mainMenuLinkClass = ({ isActive }: { isActive: boolean }) =>
        `block px-3 py-2.5 rounded-lg text-base font-medium transition-colors ${navLinkColours(isActive)}`;

    // Rendered twice, by the bar and by the main menu, so the two can never drift apart.
    const navItems: NavItem[] = [
        { to: '/', label: 'Home', end: true },
        { to: '/games', label: 'Games' },
        { to: '/lists', label: 'Lists' },
        // Gated on auth, unlike Lists: none has a signed-out story to tell, so an anonymous
        // visitor would land on a page that only asks them to sign in. Held back until auth has
        // answered, like the auth section below.
        ...(!authLoading && user
            ? [
                { to: '/wishlist', label: 'Wishlist' },
                { to: '/calendar', label: 'Calendar' },
                { to: '/news', label: 'News' },
            ]
            : []),
    ];

    // Why the last sign-out did not happen, shown in the menu it was pressed in. Cleared whenever the
    // menu closes, so it never greets the next opening; adjusted during render, as the main menu is.
    const [logoutError, setLogoutError] = useState<string | null>(null);
    if (!menuOpen && logoutError !== null) {
        setLogoutError(null);
    }

    // While the sign-out is out, which behind the edge can be a long while when it is failing.
    const [signingOut, setSigningOut] = useState(false);

    const handleLogout = async () => {
        if (signingOut) return;
        // Cleared first, so that a second refusal is a new alert, and is announced again.
        setLogoutError(null);
        setSigningOut(true);
        try {
            await logout();
        } catch (error) {
            // Still signed in: the cookie outlived the request. The menu stays open on the reason, or
            // opens again on it if it was closed meanwhile, rather than leaving nothing on screen to
            // say the sign-out did not happen.
            setMenuOpen(true);
            setLogoutError(error instanceof Error ? error.message : 'Could not sign you out. Please try again.');
            return;
        } finally {
            setSigningOut(false);
        }
        setMenuOpen(false);
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
                                        setSearchOpen(false);
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
                            <Link to="/" className="shrink-0 flex items-center gap-2.5 text-fg font-bold text-lg hover:opacity-80 transition-opacity">
                                <Logo className="w-7 h-7" />
                                {/* Icon-only below sm, where the bar has no room for the name
                                    beside the menu button and the account controls. Visually
                                    hidden rather than removed: it is the link's only accessible
                                    name, and display: none would leave a link to the home page
                                    that says nothing at all. Not `sr-only sm:not-sr-only`:
                                    ListTable.css defines an unlayered .sr-only that would outrank
                                    the sm: utility once the lists page had loaded. */}
                                <span className="max-sm:sr-only">MyVideoGame<span className="text-brand-lime">List</span></span>
                            </Link>
                        </div>

                        <div className="flex items-center gap-2 min-w-0">
                            <NavbarSearch
                                panelOpen={searchOpen}
                                onPanelOpenChange={open => {
                                    if (open) {
                                        setMainMenuOpen(false);
                                        setMenuOpen(false);
                                    }
                                    setSearchOpen(open);
                                }}
                            />

                            {/* Navigation Links */}
                            <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
                                {navItems.map(item => (
                                    <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                                        {item.label}
                                    </NavLink>
                                ))}
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
                                        onClick={() => {
                                            setMainMenuOpen(false);
                                            setSearchOpen(false);
                                            setMenuOpen(o => !o);
                                        }}
                                        aria-haspopup="true"
                                        aria-expanded={menuOpen}
                                        aria-label="User menu"
                                    >
                                        {/* The account's own picture, or its handle's initial when
                                            it has none or it does not load: the same circle the
                                            public profile draws (ADR 0056). The handle's and never
                                            the email's, which is not a name the user chose. */}
                                        <Avatar
                                            userName={user.userName}
                                            avatarUrl={user.avatarUrl}
                                            className="navbar-avatar"
                                        />
                                        <svg className="w-3.5 h-3.5 text-fg-muted ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>

                                    {menuOpen && (
                                        <>
                                            <div className="navbar-dropdown-overlay" onClick={() => setMenuOpen(false)} />
                                            <div className="navbar-dropdown">
                                                {/* The menu is the items alone, so that the reason a
                                                    sign-out failed, below, is not a child a menu may
                                                    not hold. */}
                                                <div role="menu">
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
                                                    {/* A convenience for the one person it is shown
                                                        to, and not the guard: every admin request is
                                                        refused by the server unless the account is an
                                                        admin, whoever finds the page. */}
                                                    {user.isAdmin && (
                                                        <Link
                                                            to="/admin"
                                                            className="navbar-dropdown-item"
                                                            role="menuitem"
                                                            onClick={() => setMenuOpen(false)}
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                            </svg>
                                                            Admin
                                                        </Link>
                                                    )}
                                                    {/* aria-disabled rather than disabled while the
                                                        request is out, so the item keeps the focus a
                                                        keyboard gave it; the press guards itself. */}
                                                    <button
                                                        className="navbar-dropdown-item navbar-dropdown-logout"
                                                        role="menuitem"
                                                        onClick={handleLogout}
                                                        aria-disabled={signingOut}
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                                        </svg>
                                                        {signingOut ? 'Signing out…' : 'Sign Out'}
                                                    </button>
                                                </div>
                                                {logoutError !== null && (
                                                    <p className="px-4 pb-3 text-sm text-danger-300" role="alert">
                                                        {logoutError}
                                                    </p>
                                                )}
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

            {/* Outside the header on purpose — see .navbar-scrim. */}
            {mainMenuOpen && (
                <div className="navbar-scrim md:hidden" onClick={() => setMainMenuOpen(false)} aria-hidden="true" />
            )}
            {searchOpen && (
                <div className="navbar-scrim lg:hidden" onClick={() => setSearchOpen(false)} aria-hidden="true" />
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
