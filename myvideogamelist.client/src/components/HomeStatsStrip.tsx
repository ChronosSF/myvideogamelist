import { useUserStats } from '@/hooks/useUserStats';
import { formatHours } from '@/lib/stats';
import type { ActivityMonth } from '@/types/stats';

/**
 * Three figures across the top of the signed-in home page: finished this year, hours logged, and
 * the current finishing streak (ROADMAP H6).
 *
 * No new API — all three come from `/api/user/stats`, which ADR 0025 gave hours to. That is why
 * this waited on the home page forking rather than on any backend work.
 *
 * Every figure here is about the user's own rows and none of it touches IGDB, so this section
 * survives an outage that takes out the trending rail below it.
 */
export function HomeStatsStrip({ userId }: { userId: string }) {
    const { stats, loading, error } = useUserStats(userId);

    // Silent on both. This is a strip of encouragement above a page that works perfectly well
    // without it, and an error banner for it would be louder than the thing it is reporting —
    // unlike the profile page, where these figures are the entire point and a failure has to say
    // so.
    if (loading || error !== null || stats === null) return null;

    const { activity, playtime, library } = stats;

    const finishedThisYear = countFinishedIn(activity.months, new Date().getUTCFullYear());

    // Nothing recorded at all: three zeroes would be a scoreboard of failure on somebody's first
    // visit. One sentence pointing at the thing to do is the whole answer.
    if (library.recorded === 0 && activity.transitions === 0) return null;

    return (
        <dl className="home-strip">
            <div className="home-strip-item">
                <dt>finished this year</dt>
                <dd>{finishedThisYear}</dd>
            </div>
            <div className="home-strip-item">
                <dt>hours logged</dt>
                {/* An em dash rather than "0 hours": nobody has logged zero hours, they have
                    logged nothing, and the two read very differently under a number. */}
                <dd>{playtime.withHours === 0 ? '—' : formatHours(playtime.totalMinutes / 60)}</dd>
            </div>
            <div className="home-strip-item">
                <dt>month finishing streak</dt>
                <dd>{activity.currentStreakMonths}</dd>
            </div>
        </dl>
    );
}

/**
 * Finishes in one calendar year, from the months the API already returned.
 *
 * The window is at most twelve months, so early in a year this covers the whole of it and late in
 * one it covers all of it too — the only case it could miss is a year longer than twelve months.
 * Computed from `month` string prefixes rather than `new Date(month)`, which parses `2026-06` as
 * UTC midnight and lands in May for anybody west of Greenwich.
 */
function countFinishedIn(months: ActivityMonth[], year: number): number {
    const prefix = `${year}-`;
    return months
        .filter(month => month.month.startsWith(prefix))
        .reduce((total, month) => total + month.finished, 0);
}
