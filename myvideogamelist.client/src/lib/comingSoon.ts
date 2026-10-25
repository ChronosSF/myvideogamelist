import { dayLabel } from '@/lib/daySpan';
import { monthName } from '@/lib/releaseCalendar';
import type { ComingSoonGame } from '@/types/releases';

/**
 * When a game on the Coming soon panel arrives, as its card says it: "Nov 19", "December", "Q1 2027".
 *
 * The year goes beside a day or a month only when it is not this one, and always beside a quarter, which
 * reads as nothing without it. Built from the strings alone, so it reads no clock and no locale and renders
 * the same on the server as in the browser.
 *
 * @param today `YYYY-MM-DD`: the day the page was rendered for, which the loader hands the browser too.
 */
export function comingSoonWhen(
    { precision, starts }: Pick<ComingSoonGame, 'precision' | 'starts'>,
    today: string,
): string {
    const year = Number(starts.slice(0, 4));
    const thisYear = year === Number(today.slice(0, 4));

    if (precision === 'quarter') return `Q${Math.floor((Number(starts.slice(5, 7)) - 1) / 3) + 1} ${year}`;

    if (precision === 'month') {
        const { name } = monthName(starts.slice(0, 7));
        return thisYear ? name : `${name} ${year}`;
    }

    const { month, date } = dayLabel(starts);
    return thisYear ? `${month} ${date}` : `${month} ${date}, ${year}`;
}

/**
 * The game a typed id or a pasted address names, for the admin page's picks: `52189`, or a game page's
 * address ending in `/games/52189`. Null for anything else.
 */
export function gameIdIn(text: string): number | null {
    const match = /^(?:(\d+)|.*\/games\/(\d+))\/?$/.exec(text.trim());
    if (match === null) return null;

    const id = Number(match[1] ?? match[2]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}
