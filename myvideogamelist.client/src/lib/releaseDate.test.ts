import { describe, expect, it } from 'vitest';
import { formatReleaseDay, isReleaseToday, parseReleaseDate } from '@/lib/releaseDate';

/** Late evening, local time, so a date parsed as UTC midnight would land on the wrong day. */
const NOW = new Date(2026, 8, 15, 23, 30);

describe('parseReleaseDate', () => {
    it('is the local calendar day, not UTC midnight', () => {
        const day = parseReleaseDate('2026-09-19');

        expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 8, 19]);
        expect(day.getHours()).toBe(0);
    });
});

describe('formatReleaseDay', () => {
    it('says today and tomorrow in words', () => {
        expect(formatReleaseDay('2026-09-15', NOW)).toBe('Today');
        expect(formatReleaseDay('2026-09-16', NOW)).toBe('Tomorrow');
    });

    it('gives any other day as a short date', () => {
        expect(formatReleaseDay('2026-09-19', NOW)).toBe('Sat, Sep 19');
    });

    it('crosses a month end', () => {
        expect(formatReleaseDay('2026-10-01', new Date(2026, 8, 30, 12))).toBe('Tomorrow');
    });
});

describe('isReleaseToday', () => {
    it('is true only for the reader\'s own today', () => {
        expect(isReleaseToday('2026-09-15', NOW)).toBe(true);
        expect(isReleaseToday('2026-09-16', NOW)).toBe(false);
    });
});
