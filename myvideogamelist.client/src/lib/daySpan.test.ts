import { describe, expect, it } from 'vitest';
import { formatDaySpan, localToday } from '@/lib/daySpan';

describe('formatDaySpan', () => {
    it('says a single day once', () => {
        expect(formatDaySpan('2026-11-27', '2026-11-27')).toBe('Nov 27, 2026');
    });

    it('names the month once for a run inside it', () => {
        expect(formatDaySpan('2026-10-01', '2026-10-08')).toBe('Oct 1 – 8, 2026');
    });

    it('names both months for a run across two', () => {
        expect(formatDaySpan('2026-10-19', '2026-11-02')).toBe('Oct 19 – Nov 2, 2026');
    });

    it('names both years for a run across New Year', () => {
        expect(formatDaySpan('2026-12-17', '2027-01-04')).toBe('Dec 17, 2026 – Jan 4, 2027');
    });
});

describe('localToday', () => {
    it('is the reader’s own calendar day, padded to compare as a string', () => {
        // Local components, not UTC: late evening in the Americas is already tomorrow in UTC.
        expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    });
});
