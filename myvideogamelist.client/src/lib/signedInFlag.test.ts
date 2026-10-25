import { describe, expect, it } from 'vitest';
import { signedInFlagIn } from '@/lib/signedInFlag';

describe('signedInFlagIn', () => {
    it('finds the flag among the cookies a browser sends', () => {
        expect(signedInFlagIn('mvgl_signed_in=1')).toBe(true);
        expect(signedInFlagIn('theme=dark; mvgl_signed_in=1; other=x')).toBe(true);
    });

    it('is false for no cookies, a cleared flag, and a name that only begins the same', () => {
        expect(signedInFlagIn(null)).toBe(false);
        expect(signedInFlagIn('')).toBe(false);
        expect(signedInFlagIn('mvgl_signed_in=')).toBe(false);
        expect(signedInFlagIn('mvgl_signed_in=0')).toBe(false);
        expect(signedInFlagIn('mvgl_signed_in_old=1')).toBe(false);
    });
});
