import { describe, expect, it } from 'vitest';
import {
    CACHE_GAME,
    CACHE_GAMES_LIST,
    CACHE_HOME,
    CACHE_NOT_FOUND,
    CACHE_PROFILE,
    CACHE_STATIC_PAGE,
    mayBeShared,
    PRIVATE_NO_STORE,
} from '@/lib/cache';

describe('mayBeShared', () => {
    it('is true of every policy a route shares with the edge', () => {
        for (const policy of [CACHE_HOME, CACHE_GAME, CACHE_GAMES_LIST, CACHE_PROFILE, CACHE_STATIC_PAGE, CACHE_NOT_FOUND]) {
            expect(mayBeShared(policy)).toBe(true);
        }
    });

    it('is false of the root’s default, and of either directive on its own, however it is written', () => {
        expect(mayBeShared(PRIVATE_NO_STORE)).toBe(false);
        expect(mayBeShared('no-store')).toBe(false);
        expect(mayBeShared('max-age=0, Private')).toBe(false);
    });

    it('counts a response that says nothing as shared, which is the safe way to be wrong', () => {
        // A shared document is sent whole rather than streamed: guessing shared costs a slower
        // first byte, guessing private could show a cached page's nonce before its body is final.
        expect(mayBeShared(null)).toBe(true);
        expect(mayBeShared('')).toBe(true);
    });

    it('counts a private naming fields as shared, since the response itself stays storable', () => {
        expect(mayBeShared('private="Set-Cookie", max-age=60')).toBe(true);
    });
});
