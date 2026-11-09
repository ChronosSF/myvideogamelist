import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import type { UserProfile } from '@/types/auth';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '@/components/Avatar';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { type PageTab, PageTabs } from '@/components/PageTabs';
import { Skeleton } from '@/components/Skeleton';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';
import type { UserPageOutlet } from '@/lib/userPage';
import './UserPage.css';

/** A part of the page before it can be filled: a label, a line, and the part's height. */
function CardSkeleton({ height }: { height: string }) {
    return (
        <div className={`user-card skeleton-sheen ${height}`}>
            <Skeleton className="block h-3 w-24 rounded-sm" />
            <Skeleton className="block h-4 w-3/4 mt-3 rounded-sm" />
            <Skeleton className="block h-4 w-1/2 mt-2 rounded-sm" />
        </div>
    );
}

/**
 * Either tab before auth has answered: the parts as tall as they first render at a desktop's width — the
 * favourites and the statistics while they load, or the account's first settings. They then fill in on
 * their own, as they do once signed in.
 */
function UserPageSkeleton() {
    return (
        <div className="flex flex-col gap-12">
            <CardSkeleton height="min-h-[177px]" />
            <CardSkeleton height="min-h-[240px]" />
        </div>
    );
}

/**
 * This route renders the signed-in user's own profile and settings. Stated explicitly rather than left to
 * inherit the root default, so that changing the root's policy later cannot silently make this page shared.
 * Both tabs inherit it.
 */
export function headers() {
    return { 'Cache-Control': PRIVATE_NO_STORE };
}

export function meta() {
    return [
        { title: 'My profile - MyVideoGameList' },
        { name: 'description', content: 'Your tracking, and the settings for your account.' },
        // What a crawler is served here is the signed-out shell, which is a page about nothing.
        NOINDEX,
    ];
}

/** The page's two tabs (ADR 0084): what the reader has done, which is why they came, then the settings. */
const TABS: PageTab[] = [
    { to: '/user', label: 'Your tracking', end: true },
    { to: '/user/settings', label: 'Settings' },
];

/**
 * The band the other pages open with, so this one reads as part of the same site rather than a settings
 * dialog floating in it — with, once somebody is signed in, who they are to everybody else: their picture,
 * their handle, and whether anybody can read their profile.
 */
function ProfileHeader({ user }: { user: UserProfile | null }) {
    return (
        <PageHeader title="My Profile" description={user === null ? 'Your tracking, and the settings for your account.' : undefined}>
            {user !== null && (
                <div className="mt-5 flex items-center gap-3">
                    <Avatar userName={user.userName} avatarUrl={user.avatarUrl} className="w-11 h-11 text-lg" />
                    <div className="min-w-0">
                        <p className="type-title text-lg text-fg-strong truncate">
                            {user.displayName ?? `@${user.userName}`}
                            {user.displayName !== null && <span className="ml-2 type-meta text-fg-faint">@{user.userName}</span>}
                        </p>
                        <p className="type-meta text-fg-faint">
                            {user.profileVisibility === 'public' ? (
                                <>Public profile · <Link to={`/u/${user.userName}`} className="text-link">See it as others do</Link></>
                            ) : (
                                <>Private profile · <Link to="/user/settings#account" className="text-link">Who can see it</Link></>
                            )}
                        </p>
                    </div>
                </div>
            )}
        </PageHeader>
    );
}

export function UserPage() {
    const { user, loading, logout, deleteAccount } = useAuth();
    const navigate = useNavigate();

    /**
     * Set before the deletion request rather than after it, and that ordering is the point. The
     * render in which the account disappears is the one `deleteAccount` causes, and it has to know
     * why nobody is signed in — set afterwards, that render would say "Sign in to see your profile"
     * to somebody who has just deleted theirs, and correct itself a frame later.
     */
    const [accountDeleted, setAccountDeleted] = useState(false);

    // A sign-out the server refused, or could not be asked for: the account is still signed in, and
    // this says so under the button rather than leaving a press that did nothing.
    const [logoutError, setLogoutError] = useState<string | null>(null);
    const [signingOut, setSigningOut] = useState(false);

    // `loading` before `user`: the server render never knows who is signed in, and neither does the
    // first client render, so without it every visit opened on "sign in" and then replaced it.
    if (loading) {
        return (
            <div className="min-h-screen">
                <ProfileHeader user={null} />
                <PageTabs label="My profile" tabs={TABS} />
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                    <LoadingState label="Loading your profile…">
                        <UserPageSkeleton />
                    </LoadingState>
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen">
                <ProfileHeader user={null} />
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <div className="flex items-center justify-center py-24">
                        {accountDeleted ? (
                            // A live region, so the outcome of a request made from a dialog that
                            // has just vanished is announced rather than left to be discovered.
                            <div className="text-center max-w-md" role="status">
                                <p className="text-fg font-medium mb-2">
                                    Your account has been deleted.
                                </p>
                                <p className="text-fg-muted text-sm mb-6">
                                    Everything you had recorded went with it.
                                </p>
                                <Link
                                    to="/"
                                    className="inline-flex items-center gap-1.5 px-4 py-2 btn-primary text-sm"
                                >
                                    Back to the home page
                                </Link>
                            </div>
                        ) : (
                            <div className="text-center">
                                <svg className="w-14 h-14 text-fg-dim mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                <p className="text-fg-muted font-medium">
                                    Sign in to see your profile.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    const handleLogout = async () => {
        if (signingOut) return;
        setLogoutError(null);
        setSigningOut(true);
        try {
            await logout();
        } catch (error) {
            setLogoutError(error instanceof Error ? error.message : 'Could not sign you out. Please try again.');
            return;
        } finally {
            setSigningOut(false);
        }
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

    const outlet: UserPageOutlet = {
        user,
        signOut: () => void handleLogout(),
        signingOut,
        signOutError: logoutError,
        deleteAccount: handleDeleteAccount,
    };

    return (
        <div className="min-h-screen">
            <ProfileHeader user={user} />
            <PageTabs label="My profile" tabs={TABS} />
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <Outlet context={outlet} />
            </div>
        </div>
    );
}

export default UserPage;
