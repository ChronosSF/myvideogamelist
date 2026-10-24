import { describe, expect, it } from 'vitest';
import { historyDays, localDay } from '@/lib/history';
import type { HistoryItem } from '@/types/history';
import { playthroughDateItem, scoreItem, statusItem } from '@/test/factories';

/*
 * The zone is named wherever the answer depends on it, so these hold on any machine — CI's is UTC,
 * where a day read in UTC by mistake would be indistinguishable from the reader's.
 */

describe('historyDays', () => {
    it('puts consecutive items of one day under one heading, in the order they came', () => {
        const items: HistoryItem[] = [
            statusItem({ gameId: 1, at: '2026-10-16T12:30:00+00:00' }),
            playthroughDateItem({ gameId: 2, on: '2026-10-16' }),
            scoreItem({ gameId: 3, at: '2026-10-16T11:00:00+00:00' }),
            statusItem({ gameId: 4, at: '2026-10-14T12:00:00+00:00' }),
        ];

        const days = historyDays(items, 'UTC');

        expect(days.map(day => day.label)).toEqual(['16 October 2026', '14 October 2026']);
        expect(days[0].items.map(item => item.gameId)).toEqual([1, 2, 3]);
        expect(days[1].items.map(item => item.gameId)).toEqual([4]);
    });

    it('puts an instant under the reader\'s day, and a playthrough\'s under the day written', () => {
        // 05:00 UTC on the 17th is still the evening of the 16th in Los Angeles, where the run dated
        // the 16th belongs beside it. In UTC the two are a day apart.
        const items: HistoryItem[] = [
            statusItem({ gameId: 1, at: '2026-10-17T05:00:00+00:00' }),
            playthroughDateItem({ gameId: 2, on: '2026-10-16' }),
        ];

        expect(historyDays(items, 'America/Los_Angeles').map(day => day.key)).toEqual(['2026-10-16']);
        expect(historyDays(items, 'UTC').map(day => day.key)).toEqual(['2026-10-17', '2026-10-16']);
    });

    it('reads a playthrough day as written, never through a Date', () => {
        // `new Date('2026-03-01')` is UTC midnight and the last day of February west of Greenwich.
        const [day] = historyDays([playthroughDateItem({ on: '2026-03-01' })], 'America/Los_Angeles');

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

        expect(historyDays(items, 'UTC').map(day => day.key)).toEqual(['2026-10-16', '2026-10-15', '2026-10-16']);
    });

    it('passes over a kind it does not know rather than misreading it', () => {
        const unknown = { ...statusItem({ gameId: 9 }), kind: 'review' } as unknown as HistoryItem;

        const days = historyDays([unknown, scoreItem({ gameId: 1 })], 'UTC');

        expect(days.flatMap(day => day.items).map(item => item.gameId)).toEqual([1]);
    });

    it('is empty for no items', () => {
        expect(historyDays([])).toEqual([]);
    });
});

describe('localDay', () => {
    it('is the calendar day in the zone named, either side of Greenwich', () => {
        expect(localDay('2026-10-17T05:00:00Z', 'America/Los_Angeles')).toBe('2026-10-16');
        expect(localDay('2026-10-16T20:00:00Z', 'Asia/Tokyo')).toBe('2026-10-17');
        expect(localDay('2026-10-16T23:59:59Z', 'UTC')).toBe('2026-10-16');
    });

    it('is the day on this machine\'s own calendar when no zone is named', () => {
        // Both ends of a local day, built from the local calendar and read back without a zone.
        const early = new Date(2026, 9, 16, 0, 30);
        const late = new Date(2026, 9, 16, 23, 30);

        expect(localDay(early.toISOString())).toBe('2026-10-16');
        expect(localDay(late.toISOString())).toBe('2026-10-16');
    });
});
