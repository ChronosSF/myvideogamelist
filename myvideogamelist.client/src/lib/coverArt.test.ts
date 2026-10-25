import { describe, expect, it } from 'vitest';
import { COVER_HEIGHT, COVER_WIDTH, coverSrcSet } from '@/lib/coverArt';

const BASE = 'https://images.igdb.com/igdb/image/upload';

describe('coverSrcSet', () => {
    it("offers IGDB's three cover sizes, smallest first, each at the width it was measured at", () => {
        // 90×120, 180×240 and 264×352: what images.igdb.com served for every cover sampled.
        expect(coverSrcSet(`${BASE}/t_cover_big/co4p0f.jpg`)).toBe([
            `${BASE}/t_cover_small/co4p0f.jpg 90w`,
            `${BASE}/t_cover_small_2x/co4p0f.jpg 180w`,
            `${BASE}/t_cover_big/co4p0f.jpg 264w`,
        ].join(', '));
    });

    it('never offers a bigger cover than the API sent', () => {
        // The retina variant of the big size would triple a retina screen's bytes for every card.
        expect(coverSrcSet(`${BASE}/t_cover_big/co4p0f.jpg`)).not.toContain('t_cover_big_2x');
    });

    it('leaves a URL it does not recognise as it was, rather than guessing at a rewrite', () => {
        expect(coverSrcSet('https://images.igdb.com/cover.jpg')).toBeUndefined();
        expect(coverSrcSet(`${BASE}/t_screenshot_big/sc1.jpg`)).toBeUndefined();
        expect(coverSrcSet(`${BASE}/t_cover_small/co4p0f.jpg`)).toBeUndefined();
        expect(coverSrcSet(`http://images.igdb.com/igdb/image/upload/t_cover_big/co4p0f.jpg`)).toBeUndefined();
    });

    it('describes the size the API sends, in the proportions every size shares', () => {
        expect(COVER_WIDTH / COVER_HEIGHT).toBe(3 / 4);
        expect(COVER_WIDTH).toBe(264);
    });
});
