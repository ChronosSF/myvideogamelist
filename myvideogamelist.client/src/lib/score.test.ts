import { describe, expect, it } from 'vitest';
import {
    MAX_SCORE,
    MIN_CRITIC_REVIEWS,
    STAR_COUNT,
    aggregateTitle,
    hasCriticScore,
    ratingPercent,
    scoreBandSolid,
    scoreBandSubtle,
    scoreBandTint,
    starFill,
} from '@/lib/score';

describe('the score scale', () => {
    it('is ten values over five stars, so half stars land on whole numbers', () => {
        // If these ever disagree the star control silently stops covering the range the API
        // accepts, which is the kind of bug that shows up as "I cannot give a 7".
        expect(MAX_SCORE).toBe(STAR_COUNT * 2);
        expect(MAX_SCORE).toBe(10);
    });
});

describe('starFill', () => {
    const fills = (score: number | null) =>
        Array.from({ length: STAR_COUNT }, (_, i) => starFill(i, score));

    it('fills nothing when there is no score', () => {
        expect(fills(null)).toEqual([0, 0, 0, 0, 0]);
    });

    it('fills half a star for the lowest score', () => {
        expect(fills(1)).toEqual([0.5, 0, 0, 0, 0]);
    });

    it('fills every star for the highest', () => {
        expect(fills(10)).toEqual([1, 1, 1, 1, 1]);
    });

    it('leaves the fourth star half filled for a seven', () => {
        // The whole point of half stars: an odd score has to be representable.
        expect(fills(7)).toEqual([1, 1, 1, 0.5, 0]);
    });

    it('never fills past a star or below empty', () => {
        for (const score of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
            for (const fill of fills(score)) {
                expect(fill).toBeGreaterThanOrEqual(0);
                expect(fill).toBeLessThanOrEqual(1);
            }
        }
    });

    it('fills a total of half a star per point, whatever the score', () => {
        for (const score of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
            const total = fills(score).reduce((sum, fill) => sum + fill, 0);
            expect(total, `score ${score}`).toBeCloseTo(score / 2);
        }
    });
});

describe('ratingPercent', () => {
    it('puts IGDB 0-10 player ratings on the 0-100 scale the critic score uses', () => {
        expect(ratingPercent(9.3)).toBe(93);
        expect(ratingPercent(10)).toBe(100);
        expect(ratingPercent(0)).toBe(0);
    });

    it('rounds to a whole number, since a badge has no room for a decimal', () => {
        expect(ratingPercent(8.44)).toBe(84);
        expect(ratingPercent(8.45)).toBe(85);
    });
});

describe('hasCriticScore', () => {
    it('accepts a score backed by the review floor', () => {
        expect(hasCriticScore({ criticScore: 93, criticScoreCount: MIN_CRITIC_REVIEWS })).toBe(true);
    });

    it('rejects one backed by fewer, however good it looks', () => {
        // ADR 0016: IGDB averages with no minimum, so one perfect review scores 100.
        expect(hasCriticScore({ criticScore: 100, criticScoreCount: MIN_CRITIC_REVIEWS - 1 })).toBe(false);
    });

    it('rejects one with no count at all, rather than assuming', () => {
        expect(hasCriticScore({ criticScore: 88, criticScoreCount: null })).toBe(false);
    });

    it('rejects a missing score', () => {
        expect(hasCriticScore({ criticScore: null, criticScoreCount: 400 })).toBe(false);
    });
});

describe('score bands', () => {
    // The three styles differ, but they must agree on where the boundaries are — a score that
    // reads green on a card and amber in a table is worse than either colour on its own.
    const styles = [scoreBandSolid, scoreBandTint, scoreBandSubtle];

    it('turns at 75 and at 50', () => {
        for (const style of styles) {
            expect(style(75)).not.toBe(style(74));
            expect(style(50)).not.toBe(style(49));
            expect(style(100)).toBe(style(75));
            expect(style(74)).toBe(style(50));
            expect(style(49)).toBe(style(0));
        }
    });

    it('gives three distinct looks and nothing else', () => {
        for (const style of styles) {
            const looks = new Set(Array.from({ length: 101 }, (_, n) => style(n)));
            expect(looks.size).toBe(3);
        }
    });
});

describe('aggregateTitle', () => {
    it('names the scale as well as the score', () => {
        expect(aggregateTitle('critics', 93, 12)).toBe('Critic score: 93 out of 100, from 12 reviews');
    });

    it('distinguishes a player rating from a critic score', () => {
        expect(aggregateTitle('players', 88, 24)).toBe('Player rating: 88 out of 100, from 24 ratings');
    });

    it('groups a large count the way the reader locale does', () => {
        // Asserted against toLocaleString rather than a literal, because whether four digits get
        // a separator at all is locale-dependent and CI need not run in the same one.
        expect(aggregateTitle('players', 88, 24000)).toContain((24000).toLocaleString());
    });

    it('does not say "1 reviews"', () => {
        expect(aggregateTitle('critics', 70, 1)).toBe('Critic score: 70 out of 100, from 1 review');
    });

    it('says nothing about the sample when there is no count, rather than implying zero', () => {
        expect(aggregateTitle('players', 61, null)).toBe('Player rating: 61 out of 100');
    });
});
