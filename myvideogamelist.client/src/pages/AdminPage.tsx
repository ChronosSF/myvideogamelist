import { useAuth } from '@/hooks/useAuth';
import { useCalendarAdmin } from '@/hooks/useCalendarAdmin';
import { CuratedEventsCard } from '@/components/CuratedEventsCard';
import { PageHeader } from '@/components/PageHeader';
import { ShowcaseNamesCard } from '@/components/ShowcaseNamesCard';
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

function Notice({ children, busy = false }: { children: React.ReactNode; busy?: boolean }) {
    return (
        <div className="flex flex-col items-center gap-4 py-24 text-center" role="status">
            {busy && (
                <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" aria-hidden="true" />
            )}
            <p className="text-slate-400 text-sm">{children}</p>
        </div>
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
        body = <Notice busy>Loading…</Notice>;
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
        body = <Notice busy>Loading the calendar&apos;s data…</Notice>;
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
