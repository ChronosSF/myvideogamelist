import { describe, expect, it } from 'vitest';
import { expiresInWords } from '@/lib/importExpiry';

const now = new Date('2026-09-24T12:00:00Z');

describe('expiresInWords', () => {
    it('counts whole days ahead', () => {
        expect(expiresInWords('2026-10-06T12:00:00Z', now)).toBe('in 12 days');
    });

    it('says tomorrow for the next day', () => {
        expect(expiresInWords('2026-09-25T18:00:00Z', now)).toBe('tomorrow');
    });

    it('floors rather than rounds, so a day and an hour is still tomorrow', () => {
        expect(expiresInWords('2026-09-25T13:00:00Z', now)).toBe('tomorrow');
    });

    it('says today for anything inside the next twenty-four hours', () => {
        expect(expiresInWords('2026-09-24T23:59:00Z', now)).toBe('today');
    });

    it('says nothing for a job whose time is already up', () => {
        // It is about to disappear on the next sweep, so a countdown would be a countdown to
        // nothing. The list it is on will not show it again.
        expect(expiresInWords('2026-09-24T11:59:00Z', now)).toBeNull();
    });

    it('says nothing for a date it cannot read', () => {
        expect(expiresInWords('not a date', now)).toBeNull();
    });
});
