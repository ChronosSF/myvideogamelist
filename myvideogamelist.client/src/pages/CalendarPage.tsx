import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { ReleaseCalendar } from '@/components/ReleaseCalendar';
import { Skeleton } from '@/components/Skeleton';
import { useAuth } from '@/hooks/useAuth';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';

/**
 * The calendar before it can be drawn, in the shape it opens in: the strip of months, the month's name
 * with its two steps, the weekdays and the month's grid. Measured from the calendar itself at a
 * desktop's width — 44, 36 and 23 pixels, with the gaps between them — and the grid as five weeks of
 * empty days, the least a month takes. The calendar comes in as soon as auth answers and fills in as
 * its data arrives, so this stands in for its frame, not for its releases.
 */
function CalendarSkeleton() {
    return (
        <div className="skeleton-sheen">
            <Skeleton className="block h-11 w-full rounded-lg" />
            <div className="flex items-center justify-between mt-8">
                <Skeleton className="block h-7 w-44 rounded" />
                <div className="flex gap-2">
                    <Skeleton className="block h-9 w-9 rounded-lg" />
                    <Skeleton className="block h-9 w-9 rounded-lg" />
                </div>
            </div>
            <Skeleton className="block h-3 w-full mt-3 mb-2.5 rounded-sm" />
            <Skeleton className="block h-[31.25rem] w-full rounded-xl" />
        </div>
    );
}

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
            <PageHeader
                title="Release calendar"
                description="What is coming for your games over the next year, with the showcases and sales."
            />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Nobody is signed in or out until auth has answered: the server render never knows, and
                    the first client render has to match it. */}
                {loading && (
                    <LoadingState label="Loading your calendar…">
                        <CalendarSkeleton />
                    </LoadingState>
                )}
                {!loading && user === null && (
                    <p className="py-24 text-center text-fg-muted font-medium">
                        Sign in to see what is coming for your games.
                    </p>
                )}
                {!loading && user !== null && <ReleaseCalendar userId={user.id} />}
            </div>
        </div>
    );
}

export default CalendarPage;
