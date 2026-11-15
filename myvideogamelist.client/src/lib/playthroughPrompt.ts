import type { ListId, ListMoveDto, UnfinishedPlaythroughDto } from '@/types/list';
import { dayLabel, daysBetween } from '@/lib/daySpan';
import { formatCountOf } from '@/lib/format';

/**
 * The question a move asks about a playthrough, and everything it says (ADR 0097).
 *
 * Every sentence, every label and every duration of the toast and its popup is here and nowhere else,
 * because the owner settled what it does and left what it says, and for how long, to be tried: the
 * wording and the timings are provisional.
 */

/**
 * How long each state stays up untouched, in milliseconds. The timer stops while the pointer is over the
 * toast or focus is inside it, and does not run while a yes is saving.
 */
export const PROMPT_TIMING = {
    /** The question, and a failure or a refusal, which the reader has to read before acting on. */
    askMs: 12_000,
    /** The confirmation, which only reports what the reader has just done. */
    confirmedMs: 7_000,
} as const;

/** The key that takes focus to the toast from anywhere on the page, without taking it when it appears. */
export const PROMPT_HOTKEY = 'F8';

/** Which question a saved move asks, on which day, and of which run. */
export type PromptAsk =
    | { kind: 'start'; day: string }
    | { kind: 'finish'; day: string; run: UnfinishedPlaythroughDto };

export type PromptKind = PromptAsk['kind'];

/**
 * The question a saved move asks, or null for one that asks nothing.
 *
 * - To Playing with no unfinished run: start one. A replay, every run finished, is asked too, and so is a
 *   game added straight into Playing.
 * - To Finished with an unfinished run: finish it. Not when that run starts after `today`, since it cannot
 *   finish before it started: the reader puts that right on the Your game tab.
 * - Anything else asks nothing: back to Playing with a run going, which carries on; Finished with nothing
 *   unfinished, a game added straight into Finished among them; Dropped, On Hold and the Backlog, since a
 *   run cannot say "abandoned"; and a move to the list the game was already in, which records nothing.
 *
 * `today` is the reader's own calendar day (`localToday`), read once when the move is saved: the toast
 * names it, and a yes sends that day rather than one read again later.
 */
export function askFor(listId: ListId, answer: ListMoveDto, today: string): PromptAsk | null {
    if (!answer.moved) return null;

    const run = answer.unfinishedPlaythrough;
    if (listId === 'playing') return run === null ? { kind: 'start', day: today } : null;

    if (listId === 'finished') {
        if (run === null) return null;
        // `yyyy-MM-dd` compares as a string.
        if (run.startedOn !== null && run.startedOn > today) return null;
        return { kind: 'finish', day: today, run };
    }

    return null;
}

/** Why a yes changed nothing although the server answered: a run already going, or gone or changed. */
export type PromptRefusal = 'running' | 'gone' | 'changed';

/** The words, in one place. */
export const PROMPT_WORDS = {
    /** What the toast is called, to a screen reader, with the key that reaches it. */
    region: `Playthrough question (${PROMPT_HOTKEY})`,
    /** Read with the question, for a reader who cannot see it to know how to reach it. */
    hotkeyHint: `Press ${PROMPT_HOTKEY} to answer.`,
    kicker: (title: string) => `Playthrough · ${title}`,
    question: {
        start: 'Start a playthrough today?',
        finish: 'Finish your playthrough today?',
    },
    yes: { start: 'Start it', finish: 'Finish it' },
    saving: { start: 'Starting…', finish: 'Finishing…' },
    notNow: 'Not now',
    failed: {
        start: 'Your playthrough was not started.',
        finish: 'Your playthrough was not finished.',
    },
    failedDetail: 'It could not be saved, so nothing has changed.',
    tryAgain: 'Try again',
    refused: {
        running: 'A playthrough of this game is already under way, so nothing has changed.',
        gone: 'That playthrough is no longer there, so nothing has changed.',
        changed: 'That playthrough has changed since you were asked, so nothing has changed.',
    } satisfies Record<PromptRefusal, string>,
    close: 'Close',
    confirmed: {
        start: 'Playthrough started today.',
        finish: 'Playthrough finished today.',
    },
    details: { start: 'Add details', finish: 'Add your hours' },
    popupTitle: 'Your playthrough',
    /** The popup's failure when the server gave no sentence of its own, or could not be reached. */
    popupFailed: 'Your playthrough could not be saved. Please try again.',
} as const;

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(day: string): { year: number; month: string; date: number } {
    const [year, month, date] = day.split('-').map(Number);
    return { year, month: SHORT_MONTHS[month - 1], date };
}

/** "Sunday 15 November 2026", from the string alone: it reads no clock and no locale. */
export function fullDay(day: string): string {
    const { longWeekday, longMonth, date } = dayLabel(day);
    return `${longWeekday} ${date} ${longMonth} ${day.slice(0, 4)}`;
}

/** "2 Aug 2026". */
function shortDate(day: string): string {
    const { year, month, date } = parts(day);
    return `${date} ${month} ${year}`;
}

/** "today", "yesterday", "105 days ago". */
function ago(days: number): string {
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${formatCountOf(days, 'day', 'days')} ago`;
}

/**
 * The line under the question. The day in full for a start; when the run started, and how long ago, for
 * a finish; nothing for a finish of a run that does not say when it started.
 */
export function askMeta(ask: PromptAsk): string | null {
    if (ask.kind === 'start') return fullDay(ask.day);
    const started = ask.run.startedOn;
    if (started === null) return null;
    return `Started ${shortDate(started)} · ${ago(daysBetween(started, ask.day))}`;
}

/**
 * The line under the confirmation. The day in full for a start, and for a finish of a run that does not
 * say when it started; the span and its length for any other finish: "2 Aug to 15 Nov 2026 · 105 days".
 */
export function confirmedMeta(ask: PromptAsk): string {
    if (ask.kind === 'start' || ask.run.startedOn === null) return fullDay(ask.day);

    const from = parts(ask.run.startedOn);
    const to = parts(ask.day);
    const days = daysBetween(ask.run.startedOn, ask.day);

    if (days <= 0) return `${shortDate(ask.day)} · the same day`;

    const span = from.year === to.year
        ? `${from.date} ${from.month} to ${to.date} ${to.month} ${to.year}`
        : `${shortDate(ask.run.startedOn)} to ${shortDate(ask.day)}`;
    return `${span} · ${formatCountOf(days, 'day', 'days')}`;
}
