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

/** A colour in OKLab: its lightness, 0 to 1, and where it sits on the two opponent axes. */
export function toOklab({ r, g, b }: Rgb): { l: number; a: number; b: number } {
    const [lr, lg, lb] = [decode(r), decode(g), decode(b)];

    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

    return {
        l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    };
}

/**
 * How different two colours look, as the straight distance between them in OKLab: lightness counts as
 * much as hue and chroma, so a pale periwinkle and a saturated blue of the same hue are far apart, and a
 * near-copy of a pink is close. A just noticeable difference is about 0.02.
 */
export function colourDistance(first: Rgb, second: Rgb): number {
    const x = toOklab(first);
    const y = toOklab(second);
    return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
}

/** A colour as `#rrggbb`, as a colour picker takes one. */
export function toHex({ r, g, b }: Rgb): string {
    return `#${[r, g, b].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
}
