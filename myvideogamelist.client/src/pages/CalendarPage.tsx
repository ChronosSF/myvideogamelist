import { ReleaseCalendar } from '@/components/ReleaseCalendar';
import { useAuth } from '@/hooks/useAuth';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';

/**
 * One person's calendar, so never stored anywhere between the server and them (K6, C5). Declared here
 * rather than inherited from the root default, so that relaxing the root cannot make this page shared.
 */
export function headers() {
    return { 'Cache-Control': PRIVATE_NO_STORE };
}

export function meta() {
    return [
        { title: 'Release calendar - MyVideoGameList' },
        { name: 'description', content: 'What is coming for your games over the next year.' },
        // What a crawler is served here is the signed-out shell, which is a page about nothing.
        NOINDEX,
    ];
}

/**
 * `/calendar` (`specs/release-timeline-and-calendar.md` §2.2): what is coming for the user's games a
 * month at a time, a year ahead, with the showcases and sales beside it. Signed-in only (K6) — what is
 * connected to nobody's games is nothing.
 */
export function CalendarPage() {
    const { user, loading } = useAuth();

    return (
        <div className="min-h-screen">
            <div className="bg-gradient-to-b from-blue-950/60 to-slate-900 light:from-blue-50/80 light:to-slate-50 border-b border-slate-700/50 light:border-slate-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                    <h1 className="text-3xl sm:text-4xl font-bold text-white light:text-slate-900 mb-1">
                        Release calendar
                    </h1>
                    <p className="text-slate-400 light:text-slate-600 text-sm sm:text-base">
                        What is coming for your games over the next year, with the showcases and sales.
                    </p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Nobody is signed in or out until auth has answered: the server render never knows, and
                    the first client render has to match it. */}
                {loading && (
                    <div className="flex justify-center py-24" role="status">
                        <div className="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" aria-hidden="true" />
                        <span className="sr-only">Loading…</span>
                    </div>
                )}
                {!loading && user === null && (
                    <p className="py-24 text-center text-slate-400 light:text-slate-600 font-medium">
                        Sign in to see what is coming for your games.
                    </p>
                )}
                {!loading && user !== null && <ReleaseCalendar userId={user.id} />}
            </div>
        </div>
    );
}

export default CalendarPage;
