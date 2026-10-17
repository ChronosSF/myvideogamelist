import { describe, expect, it } from 'vitest';
import { parseReleaseDate, releaseYear } from '@/lib/releaseDate';

describe('parseReleaseDate', () => {
    it('is the local calendar day, not UTC midnight', () => {
        const day = parseReleaseDate('2026-09-19');

        expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 8, 19]);
        expect(day.getHours()).toBe(0);
    });
});

describe('the suite', () => {
    it('runs west of Greenwich, where Date reads a bare day as the day before', () => {
        // The zone's effect rather than process.env.TZ, which a worker thread would report without
        // taking up the zone, leaving every date test where both readings agree.
        expect(new Date('2027-01-01').getFullYear()).toBe(2026);
    });
});

describe('releaseYear', () => {
    it('is the year of the day named, wherever the reader is', () => {
        // New Year's Day at UTC midnight is still the old year west of Greenwich.
        expect(releaseYear('2027-01-01')).toBe(2027);
    });
});
