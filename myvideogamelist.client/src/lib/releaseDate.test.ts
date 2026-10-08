import { describe, expect, it } from 'vitest';
import { parseReleaseDate, releaseYear } from '@/lib/releaseDate';

describe('parseReleaseDate', () => {
    it('is the local calendar day, not UTC midnight', () => {
        const day = parseReleaseDate('2026-09-19');

        expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 8, 19]);
        expect(day.getHours()).toBe(0);
    });
});

describe('releaseYear', () => {
    it('is the year of the day named, wherever the reader is', () => {
        // New Year's Day at UTC midnight is still the old year west of Greenwich.
        expect(releaseYear('2027-01-01')).toBe(2027);
    });
});
