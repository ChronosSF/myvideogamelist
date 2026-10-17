import { useAuth } from '@/hooks/useAuth';
import { useCalendarAdmin } from '@/hooks/useCalendarAdmin';
import { CuratedEventsCard } from '@/components/CuratedEventsCard';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { ShowcaseNamesCard } from '@/components/ShowcaseNamesCard';
import { Skeleton } from '@/components/Skeleton';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';
import './AdminPage.css';

/** One person's working page: never stored anywhere between the server and them (spec §7, A4). */
export function headers() {
    return { 'Cache-Control': PRIVATE_NO_STORE };
}

export function meta() {
    return [
        { title: 'Admin - MyVideoGameList' },
        // A crawler is served the signed-out shell, which is a page about nothing.
        NOINDEX,
    ];
}

function Notice({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-4 py-24 text-center" role="status">
            <p className="text-fg-muted text-sm">{children}</p>
        </div>
    );
}

/** One of the page's cards before its data: the card's own frame and height, its title and its hint. */
function CardSkeleton({ height }: { height: string }) {
    return (
        <div className={`admin-card skeleton-sheen ${height}`}>
            <Skeleton className="block h-6 w-48 rounded" />
            <Skeleton className="block h-4 w-full max-w-lg mt-2 rounded-sm" />
            <Skeleton className="block h-10 w-full max-w-md mt-5 rounded-lg" />
        </div>
    );
}

/**
 * The two cards before the calendar's data arrives, in the cards' own frames and at the heights they
 * came to at a desktop's width with the calendar's data in them (543 and 249 pixels), so the cards land
 * on them. A narrower screen stacks the forms' fields, and the cards grow past these.
 */
function AdminSkeleton({ label }: { label: string }) {
    return (
        <LoadingState label={label}>
            <CardSkeleton height="min-h-[543px]" />
            <CardSkeleton height="min-h-[249px]" />
        </LoadingState>
    );
}

/**
 * The admin page (spec §7). It edits the release calendar's curated events and showcase names and
 * nothing else.
 *
 * The page is the same for everybody who reaches it, and the navbar links to it only for an admin;
 * neither is the guard. Every request it makes is refused by the server's policy unless the account
 * is named in configuration, so somebody who types the address in gets a sentence, not the data.
 */
export function AdminPage() {
    const { user, loading } = useAuth();
    const admin = user?.isAdmin ? user : null;
    const curation = useCalendarAdmin(admin?.id ?? null);

    let body: React.ReactNode;
    if (loading) {
        body = <AdminSkeleton label="Loading the admin page…" />;
    } else if (!user) {
        body = <Notice>Sign in to use this page.</Notice>;
    } else if (!admin) {
        body = <Notice>Only an admin can use this page.</Notice>;
    } else if (curation.error !== null) {
        body = (
            <div className="flex flex-col items-center gap-4 py-24 text-center">
                <p className="admin-error" role="alert">{curation.error}</p>
                {!curation.errorIsPermanent && (
                    <button type="button" className="admin-btn" onClick={curation.reload}>Try again</button>
                )}
            </div>
        );
    } else if (curation.data === null) {
        body = <AdminSkeleton label="Loading the calendar's data…" />;
    } else {
        body = (
            <>
                <CuratedEventsCard
                    events={curation.data.events}
                    addEvent={curation.addEvent}
                    replaceEvent={curation.replaceEvent}
                    removeEvent={curation.removeEvent}
                />
                <ShowcaseNamesCard
                    names={curation.data.names}
                    addName={curation.addName}
                    removeName={curation.removeName}
                />
            </>
        );
    }

    return (
        <div className="min-h-screen">
            {/* The band every other page opens with, so this one reads as part of the same site. */}
            <PageHeader
                title="Admin"
                width="4xl"
                description="The release calendar's hand-kept dates, and the showcases it shows from IGDB."
            />
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{body}</div>
        </div>
    );
}

export default AdminPage;
