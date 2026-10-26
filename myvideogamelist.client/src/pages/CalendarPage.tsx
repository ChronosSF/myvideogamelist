import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { ReleaseCalendar } from '@/components/ReleaseCalendar';
import { Skeleton } from '@/components/Skeleton';
import { useAuth } from '@/hooks/useAuth';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';

/**
 * The calendar before it can be drawn, in the shape it opens in (ADR 0075): the strip of months, then
 * under its rule the month's name with its two steps and the index of its days, and beside them at a
 * desktop's width the first lines of its list. The calendar comes in as soon as auth answers and fills
 * in as its data arrives, so this stands in for its frame, not for its releases.
 */
function CalendarSkeleton() {
    return (
        <div className="skeleton-sheen">
            <Skeleton className="block h-16 w-full rounded-sm" />
            <div className="mt-12 pt-5 border-t-2 border-fg-strong grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-14">
                <div>
                    <div className="flex items-end justify-between">
                        <Skeleton className="block h-10 w-44 rounded-sm" />
                        <div className="flex gap-1.5">
                            <Skeleton className="block h-9 w-9 rounded-sm" />
                            <Skeleton className="block h-9 w-9 rounded-sm" />
                        </div>
                    </div>
                    <Skeleton className="block h-60 w-full mt-5 rounded-sm" />
                </div>
                <div className="hidden lg:block">
                    {[0, 1, 2].map(line => (
                        <div key={line} className="flex gap-6 py-4 border-b border-line">
                            <Skeleton className="block h-5 w-36 rounded-sm" />
                            <Skeleton className="block h-16 flex-1 rounded-sm" />
                        </div>
                    ))}
                </div>
            </div>
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
