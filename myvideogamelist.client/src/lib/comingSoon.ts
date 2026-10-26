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

/** A period of the Coming soon schedule: a month, or a quarter for what is known only to one. */
export interface ScheduleGroup {
    key: string;
    /** "November", "January 2027", "Q1 2027": the year where it is not this one, and always on a quarter. */
    label: string;
    games: ComingSoonGame[];
}

/**
 * The Coming soon panel as a schedule (ADR 0075): its games under the month they arrive in, and those known
 * only to a quarter under the quarter, each period once and in the order its first game arrives. The games
 * keep the order they came in, which is the order they arrive.
 *
 * @param today `YYYY-MM-DD`: the day the page was rendered for, which decides when a month needs its year.
 */
export function scheduleGroups(games: readonly ComingSoonGame[], today: string): ScheduleGroup[] {
    const groups = new Map<string, ScheduleGroup>();
    for (const game of games) {
        const key = game.precision === 'quarter'
            ? comingSoonWhen(game, today)
            : game.starts.slice(0, 7);
        let group = groups.get(key);
        if (group === undefined) {
            const label = game.precision === 'quarter'
                ? key
                : comingSoonWhen({ precision: 'month', starts: game.starts }, today);
            group = { key, label, games: [] };
            groups.set(key, group);
        }
        group.games.push(game);
    }
    return [...groups.values()];
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
