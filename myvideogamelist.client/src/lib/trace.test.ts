import { describe, expect, it } from 'vitest';
import { isUpstreamFailure } from '@/lib/trace';

describe('isUpstreamFailure', () => {
    it('recognises what a loader throws when the API failed it', () => {
        expect(isUpstreamFailure({ message: 'Failed to load game.', traceId: '4bf92f3577b34da6a3ce929d0e0e4736' }))
            .toBe(true);
    });

    it.each([
        ['the plain text a thrown 404 carries', 'Not Found'],
        ['nothing', null],
        ['a sentence with no id', { message: 'Failed to load game.' }],
        ['an id with no sentence', { traceId: '4bf92f3577b34da6a3ce929d0e0e4736' }],
        ['an id that is not text', { message: 'Failed.', traceId: 42 }],
    ])('refuses %s, which the error page shows without a reference', (_, data) => {
        expect(isUpstreamFailure(data)).toBe(false);
    });
});
