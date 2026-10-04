import { useAuth } from '@/hooks/useAuth';
import { useCalendarAdmin } from '@/hooks/useCalendarAdmin';
import { CuratedEventsCard } from '@/components/CuratedEventsCard';
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

/** The band every other page opens with, so this one reads as part of the same site. */
function PageHeader() {
    return (
        <div className="bg-gradient-to-b from-blue-950/60 to-slate-900 light:from-blue-50/80 light:to-slate-50 border-b border-slate-700/50 light:border-slate-200">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <h1 className="text-3xl sm:text-4xl font-bold text-white light:text-slate-900 mb-1">Admin</h1>
                <p className="text-slate-400 light:text-slate-600 text-sm sm:text-base">
                    The release calendar&apos;s hand-kept dates, and the showcases it shows from IGDB.
                </p>
            </div>
        </div>
    );
}

function Notice({ children, busy = false }: { children: React.ReactNode; busy?: boolean }) {
    return (
        <div className="flex flex-col items-center gap-4 py-24 text-center" role="status">
            {busy && (
                <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" aria-hidden="true" />
            )}
            <p className="text-slate-400 light:text-slate-600 text-sm">{children}</p>
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
            <PageHeader />
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{body}</div>
        </div>
    );
}

export default AdminPage;
