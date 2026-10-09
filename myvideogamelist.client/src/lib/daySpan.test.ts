import { describe, expect, it } from 'vitest';
import { addDays, dayLabel, daysBetween, formatDaySpan, localToday } from '@/lib/daySpan';

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

describe('addDays', () => {
    it('crosses the end of a month and of a year', () => {
        expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
        expect(addDays('2026-12-25', 13)).toBe('2027-01-07');
        expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    });

    it('counts the night the clocks change as one day', () => {
        // 25 October 2026 is 25 hours long in most of Europe; counted on the reader's clock, a day's
        // milliseconds from midnight would land at 23:00 on the same day.
        expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
        expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    });
});

describe('daysBetween', () => {
    it('is how many days one day is after another, negative before it', () => {
        expect(daysBetween('2026-10-06', '2026-10-19')).toBe(13);
        expect(daysBetween('2026-10-06', '2026-10-01')).toBe(-5);
        expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    });
});

describe('dayLabel', () => {
    it('names the weekday and the month from the string alone', () => {
        expect(dayLabel('2026-10-06')).toEqual({
            weekday: 'Tue',
            month: 'Oct',
            date: 6,
            longWeekday: 'Tuesday',
            longMonth: 'October',
            full: 'Tuesday, October 6',
        });
        expect(dayLabel('2027-01-01').full).toBe('Friday, January 1');
    });
});
