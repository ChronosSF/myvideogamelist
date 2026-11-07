/**
 * How the site looks to its owner, mirroring `LookDto` on the server (ADR 0082): a palette by name, a
 * custom palette's two colours, the background pattern and what it is drawn in.
 *
 * Names rather than colours, as the server stores them: what a preset looks like is `theme.css`'s, so a
 * preset retuned later reaches everybody who chose it. The lists are `LookPolicy`'s, and
 * `serverMirrors.test.ts` fails when the two differ.
 */
export interface Look {
    palette: PaletteId;
    /** A custom palette's background, `#rrggbb`; null for a preset. */
    background: string | null;
    /** A custom palette's accent, `#rrggbb`; null for a preset. */
    accent: string | null;
    pattern: PatternId;
    tint: TintId;
}

/** The palettes, the default first; `custom` is the one with colours of its own. */
export const PALETTE_IDS = ['ink', 'slate', 'dusk', 'plum', 'graphite', 'onyx', 'custom'] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

/** The background patterns, the default first, and `none`. */
export const PATTERN_IDS = ['pixels', 'honeycomb', 'isometric', 'perspective', 'none'] as const;
export type PatternId = (typeof PATTERN_IDS)[number];

/** What the pattern is drawn in, the default first: the palette's accent, or its own grey. */
export const TINT_IDS = ['accent', 'grey'] as const;
export type TintId = (typeof TINT_IDS)[number];

/** What each is called on the settings page. */
export const PALETTE_NAMES: Readonly<Record<PaletteId, string>> = {
    ink: 'Ink and lime',
    slate: 'Slate and ice',
    dusk: 'Dusk and periwinkle',
    plum: 'Plum and orchid',
    graphite: 'Graphite and chalk',
    onyx: 'Onyx and wine',
    custom: 'Custom',
};

export const PATTERN_NAMES: Readonly<Record<PatternId, string>> = {
    pixels: 'Pixel matrix',
    honeycomb: 'Honeycomb',
    isometric: 'Isometric',
    perspective: 'Perspective',
    none: 'None',
};

export const TINT_NAMES: Readonly<Record<TintId, string>> = {
    accent: 'Accent',
    grey: 'Grey',
};

/**
 * The look of a new account, of anybody signed out, and of every page before it knows better: ink, and the
 * pixel matrix in its lime (ADR 0085). `PagePattern.css` draws the same when `<html>` names no look.
 */
export const DEFAULT_LOOK: Readonly<Look> = {
    palette: 'ink',
    background: null,
    accent: null,
    pattern: 'pixels',
    tint: 'accent',
};

/** A colour as a colour picker writes one and as the server keeps it: `#` and six hex digits. */
export const LOOK_COLOUR = /^#[0-9a-f]{6}$/i;

export function sameLook(a: Look, b: Look): boolean {
    return a.palette === b.palette
        && a.background === b.background
        && a.accent === b.accent
        && a.pattern === b.pattern
        && a.tint === b.tint;
}
