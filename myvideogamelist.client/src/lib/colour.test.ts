import { describe, expect, it } from 'vitest';
import { contrast, hueDistance, hueOf, parseColour, toHex } from './colour';

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

describe('hueOf', () => {
    it("is HSL's hue, with the chroma", () => {
        expect(hueOf(parsed('#ff0000'))).toEqual({ hue: 0, chroma: 1 });
        expect(hueOf(parsed('#00ff00')).hue).toBe(120);
        expect(hueOf(parsed('#db2777')).hue).toBeCloseTo(333, 0);
        expect(hueOf(parsed('#808080'))).toEqual({ hue: 0, chroma: 0 });
        // Paper has a trace of warmth, and next to no hue to see.
        expect(hueOf(parsed('#f3efe6')).chroma).toBeCloseTo(0.05, 2);
    });
});

describe('hueDistance', () => {
    it('goes the short way round the wheel', () => {
        expect(hueDistance(350, 10)).toBe(20);
        expect(hueDistance(10, 350)).toBe(20);
        expect(hueDistance(0, 180)).toBe(180);
    });
});
