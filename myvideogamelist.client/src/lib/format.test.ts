import { describe, expect, it } from 'vitest';
import { formatCount } from '@/lib/format';

// Every assertion is a literal. The point of the formatter is that its output does not depend on
// the machine, so a test that computed its expectation from the machine's locale would prove nothing.
describe('formatCount', () => {
    it('separates a four-digit count, which several locales do not', () => {
        // The case that broke hydration on the game page: Node, in bg-BG, rendered "5487" and the
        // browser "5,487". es-ES, pl-PL and pt-PT leave four digits unseparated as well.
        expect(formatCount(5487)).toBe('5,487');
    });

    it('groups every three digits with a comma, not a space or a full stop', () => {
        expect(formatCount(24000)).toBe('24,000');
        expect(formatCount(1234567)).toBe('1,234,567');
    });

    it('leaves a count under a thousand alone', () => {
        expect(formatCount(0)).toBe('0');
        expect(formatCount(1)).toBe('1');
        expect(formatCount(999)).toBe('999');
    });
});
