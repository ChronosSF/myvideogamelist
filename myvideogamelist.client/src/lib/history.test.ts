import { describe, expect, it } from 'vitest';
import { historyDays, localDay } from '@/lib/history';
import { formatDay } from '@/lib/stats';
import type { HistoryItem } from '@/types/history';
import { playthroughDateItem, scoreItem, statusItem } from '@/test/factories';

/*
 * The instants here are at midday UTC, which is the same calendar day on any machine from UTC−11 to
 * UTC+11. The day of an instant is the reader's own by design, so a test can only pin it where every
 * zone a test machine is likely to be in agrees.
 */

describe('historyDays', () => {
    it('puts consecutive items of one day under one heading, in the order they came', () => {
        const items: HistoryItem[] = [
            statusItem({ gameId: 1, at: '2026-10-16T12:30:00+00:00' }),
            playthroughDateItem({ gameId: 2, on: '2026-10-16' }),
            scoreItem({ gameId: 3, at: '2026-10-16T11:00:00+00:00' }),
            statusItem({ gameId: 4, at: '2026-10-14T12:00:00+00:00' }),
        ];

        const days = historyDays(items);

        expect(days.map(day => day.label)).toEqual(['16 October 2026', '14 October 2026']);
        expect(days[0].items.map(item => item.gameId)).toEqual([1, 2, 3]);
        expect(days[1].items.map(item => item.gameId)).toEqual([4]);
    });

    it('reads a playthrough day as written, never through a Date', () => {
        // `new Date('2026-03-01')` is UTC midnight and the last day of February west of Greenwich.
        const [day] = historyDays([playthroughDateItem({ on: '2026-03-01' })]);

        expect(day.key).toBe('2026-03-01');
        expect(day.label).toBe('1 March 2026');
    });

    it('gives a day that recurs after another its own heading rather than moving items', () => {
        // Only a reader far enough east sees this — a dated item among the next morning's moves —
        // and the order stays the server's, so the day is headed twice.
        const items: HistoryItem[] = [
            statusItem({ gameId: 1, at: '2026-10-16T12:00:00+00:00' }),
            playthroughDateItem({ gameId: 2, on: '2026-10-15' }),
            statusItem({ gameId: 3, at: '2026-10-16T11:00:00+00:00' }),
        ];

        expect(historyDays(items).map(day => day.key)).toEqual(['2026-10-16', '2026-10-15', '2026-10-16']);
    });

    it('passes over a kind it does not know rather than misreading it', () => {
        const unknown = { ...statusItem({ gameId: 9 }), kind: 'review' } as unknown as HistoryItem;

        const days = historyDays([unknown, scoreItem({ gameId: 1 })]);

        expect(days.flatMap(day => day.items).map(item => item.gameId)).toEqual([1]);
    });

    it('is empty for no items', () => {
        expect(historyDays([])).toEqual([]);
    });
});

describe('localDay', () => {
    it('is the calendar day of an instant on this machine, not in UTC', () => {
        // Both ends of a local day. Off UTC, one of the two is another day in UTC — east of
        // Greenwich the first, west of it the second — so a reading in UTC fails one of them.
        const early = new Date(2026, 9, 16, 0, 30);
        const late = new Date(2026, 9, 16, 23, 30);

        expect(localDay(early.toISOString())).toBe('2026-10-16');
        expect(localDay(late.toISOString())).toBe('2026-10-16');
    });
});

describe('formatDay', () => {
    it('writes a day out in words, and leaves anything that is not one as it was', () => {
        expect(formatDay('2026-10-07')).toBe('7 October 2026');
        expect(formatDay('soon')).toBe('soon');
    });
});
