import { describe, expect, it } from 'vitest';
import { colourDistance, contrast, parseColour, toHex, toOklab } from './colour';

function parsed(text: string) {
    const rgb = parseColour(text);
    if (rgb === null) throw new Error(`${text} did not parse`);
    return rgb;
}

describe('parseColour', () => {
    it('reads each way a computed style writes a colour', () => {
        expect(toHex(parsed('rgb(16, 24, 42)'))).toBe('#10182a');
        expect(toHex(parsed('rgba(16, 24, 42, 0.5)'))).toBe('#10182a');
        expect(toHex(parsed('rgb(16 24 42 / 50%)'))).toBe('#10182a');
        expect(toHex(parsed('color(srgb 1 0.5 0)'))).toBe('#ff8000');
        expect(toHex(parsed('#C8F560'))).toBe('#c8f560');
    });

    it('reads OKLCH as sRGB, the tokens among them', () => {
        // The page and the primary of the default palette, whose hex `theme.css` gives beside each.
        expect(toHex(parsed('oklch(0.215 0.003 67.7)'))).toBe('#1a1918');
        expect(toHex(parsed('oklch(21.5% 0.003 67.7)'))).toBe('#1a1918');
        expect(toHex(parsed('oklch(0.841 0.238 128.85)'))).toBe('#9ae600');
        expect(toHex(parsed('oklch(0.5 0 none)'))).toBe('#636363');
    });

    it('reads anything else as nothing, so a check that cannot read its colours fails', () => {
        expect(parseColour('')).toBeNull();
        expect(parseColour('canvastext')).toBeNull();
        expect(parseColour('lab(50 20 30)')).toBeNull();
        expect(parseColour('rgb(a b c)')).toBeNull();
    });
});

describe('contrast', () => {
    it("is WCAG's ratio", () => {
        expect(contrast(parsed('#000000'), parsed('#ffffff'))).toBeCloseTo(21, 5);
        expect(contrast(parsed('#ffffff'), parsed('#ffffff'))).toBe(1);
        // Either way round.
        expect(contrast(parsed('#767676'), parsed('#ffffff'))).toBeCloseTo(4.54, 2);
        expect(contrast(parsed('#ffffff'), parsed('#767676'))).toBeCloseTo(4.54, 2);
    });
});

describe('toOklab', () => {
    it('is the inverse of reading OKLCH', () => {
        // The default palette's primary, written in the tokens as oklch(84.1% 0.238 128.85).
        const { l, a, b } = toOklab(parsed('oklch(0.841 0.238 128.85)'));

        expect(l).toBeCloseTo(0.841, 2);
        expect(Math.hypot(a, b)).toBeCloseTo(0.238, 1);
    });

    it('puts a grey on neither axis', () => {
        const { a, b } = toOklab(parsed('#808080'));

        expect(Math.abs(a)).toBeLessThan(1e-4);
        expect(Math.abs(b)).toBeLessThan(1e-4);
    });
});

describe('colourDistance', () => {
    it('is nothing between a colour and itself, and the same either way round', () => {
        expect(colourDistance(parsed('#db2777'), parsed('#db2777'))).toBe(0);
        expect(colourDistance(parsed('#db2777'), parsed('#e0368a')))
            .toBeCloseTo(colourDistance(parsed('#e0368a'), parsed('#db2777')), 10);
    });

    it('counts lightness: a pale periwinkle is far from a saturated blue of nearly its hue', () => {
        // indigo-300 against Playing's blue, blue-500, which a hue alone puts 13 degrees apart.
        expect(colourDistance(parsed('#a5b4fc'), parsed('#3b82f6'))).toBeGreaterThan(0.15);
        // A pink a shade off the wishlist's is close.
        expect(colourDistance(parsed('#e0368a'), parsed('#db2777'))).toBeLessThan(0.06);
    });
});
