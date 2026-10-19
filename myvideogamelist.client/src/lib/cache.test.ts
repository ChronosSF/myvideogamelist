import { describe, expect, it } from 'vitest';
import { CACHE_PROFILE } from '@/lib/cache';

describe('CACHE_PROFILE', () => {
    it('is five minutes fresh and an hour stale, the window the API retries a withdrawal within', () => {
        // `CloudFrontEdgeInvalidator.Horizon` on the server is these two added together (ADR 0058).
        expect(CACHE_PROFILE).toContain('s-maxage=300');
        expect(CACHE_PROFILE).toContain('stale-while-revalidate=3600');
    });

    it('may not be served stale when the origin fails', () => {
        // Without it CloudFront serves an expired copy through any later 5xx, for up to the cache
        // policy's maximum TTL, and a withdrawn profile whose invalidation failed comes back.
        expect(CACHE_PROFILE).toContain('stale-if-error=0');
    });
});
