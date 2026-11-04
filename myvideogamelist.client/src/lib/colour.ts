/**
 * Colours as a browser's computed style writes them, read back into numbers: for the settings page's
 * readability checks on a custom palette (ADR 0082), which measure the palette the page is drawn in rather
 * than a copy of its formulas.
 *
 * A computed colour comes as `rgb`, `rgba`, `color(srgb …)` or, for a colour written in OKLCH — every
 * token is, and every colour worked out from one — as `oklch`. Anything else reads as null, and a check
 * that cannot read its colours fails rather than passing.
 */

/** A colour in sRGB, each channel gamma-encoded and clamped to 0–1. */
export interface Rgb {
    r: number;
    g: number;
    b: number;
}

function clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function channel(text: string, scale: number): number {
    if (text === 'none') return 0;
    return text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text) / scale;
}

/** The parts of a CSS colour function, its alpha left off. */
function partsOf(text: string): string[] {
    return text.split('/')[0].replace(/,/g, ' ').trim().split(/\s+/);
}

/** Linear sRGB to gamma-encoded. */
function encode(linear: number): number {
    return linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
}

/** Gamma-encoded sRGB to linear. */
function decode(value: number): number {
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** OKLCH to sRGB, by way of OKLab (Björn Ottosson's matrices), clamped into the gamut. */
function fromOklch(lightness: number, chroma: number, hue: number): Rgb {
    const a = chroma * Math.cos((hue * Math.PI) / 180);
    const b = chroma * Math.sin((hue * Math.PI) / 180);

    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

    return {
        r: clamp(encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
        g: clamp(encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
        b: clamp(encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    };
}

/** A computed colour as sRGB, or null for one this cannot read. */
export function parseColour(text: string): Rgb | null {
    const value = text.trim().toLowerCase();

    const hex = /^#([0-9a-f]{6})$/.exec(value);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return { r: (n >> 16) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
    }

    const fn = /^(rgba?|oklch|color)\((.*)\)$/.exec(value);
    if (!fn) return null;
    const parts = partsOf(fn[2]);

    let rgb: Rgb | null = null;
    if ((fn[1] === 'rgb' || fn[1] === 'rgba') && parts.length >= 3) {
        rgb = { r: channel(parts[0], 255), g: channel(parts[1], 255), b: channel(parts[2], 255) };
    } else if (fn[1] === 'color' && parts[0] === 'srgb' && parts.length >= 4) {
        rgb = { r: channel(parts[1], 1), g: channel(parts[2], 1), b: channel(parts[3], 1) };
    } else if (fn[1] === 'oklch' && parts.length >= 3) {
        rgb = fromOklch(channel(parts[0], 1), parts[1] === 'none' ? 0 : parseFloat(parts[1]), parts[2] === 'none' ? 0 : parseFloat(parts[2]));
    }

    if (rgb === null || [rgb.r, rgb.g, rgb.b].some(Number.isNaN)) return null;
    return { r: clamp(rgb.r), g: clamp(rgb.g), b: clamp(rgb.b) };
}

/** WCAG's relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
    return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
}

/** WCAG's contrast ratio, 1 to 21, whichever colour is the lighter. */
export function contrast(first: Rgb, second: Rgb): number {
    const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}

/**
 * A colour's hue in degrees as HSL reckons it, and its chroma, 0 to 1: how far its brightest channel is
 * from its darkest, which is how much hue there is to see. HSL's saturation would not do for that, since
 * it calls a near-white with a trace of warmth half saturated.
 */
export function hueOf({ r, g, b }: Rgb): { hue: number; chroma: number } {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const range = max - min;
    if (range === 0) return { hue: 0, chroma: 0 };

    let hue = max === r ? ((g - b) / range) % 6 : max === g ? (b - r) / range + 2 : (r - g) / range + 4;
    hue *= 60;
    if (hue < 0) hue += 360;

    return { hue, chroma: range };
}

/** How far apart two hues are around the wheel, 0 to 180. */
export function hueDistance(first: number, second: number): number {
    const apart = Math.abs(first - second) % 360;
    return Math.min(apart, 360 - apart);
}

/** A colour as `#rrggbb`, as a colour picker takes one. */
export function toHex({ r, g, b }: Rgb): string {
    return `#${[r, g, b].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
}
