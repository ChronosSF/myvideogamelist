import { colourDistance, contrast, parseColour, toHex, type Rgb } from '@/lib/colour';

/**
 * Whether a custom palette reads, measured on the page while it is drawn in it (ADR 0082 §5).
 *
 * The palette's surfaces, text and accent steps are `theme.css`'s, worked out from its two colours by the
 * browser, so the checks read the tokens back off the document rather than restating those formulas here:
 * a formula retuned there is a formula checked here.
 *
 * One check is required: the body text on the background. The text is not the reader's to choose — every
 * palette is dark and its text light (ADR 0048) — so a background it cannot be read on makes the whole site
 * unreadable, this page with it, and a palette failing it is drawn and not saved. The rest are advice: a
 * look is its owner's alone and shown to nobody else, so somebody who can read faint text, or wants an
 * accent near a colour that means something, is told and then given it.
 */
export interface LookCheck {
    id: 'body' | 'faint' | 'accent' | 'fill' | 'button' | 'meaning';
    label: string;
    ok: boolean;
    /** Whether a palette failing it is not saved. */
    required: boolean;
}

/**
 * The colours that mean something and stay the same in every palette, each with every shade the site
 * draws it in and what it means, as a sentence ends: an accent near any of them would make a mark of the
 * reader's own read as one of these. The success green is not among them, since the default accent is the
 * lime beside it, and neither are the statuses but Playing, whose blue is the one drawn as a fill wherever
 * a game is.
 */
const MEANINGS = [
    { tokens: ['wishlist-600', 'wishlist-700'], meaning: 'the wishlist’s pink' },
    { tokens: ['favourite-300', 'favourite-400', 'favourite-500', 'favourite-600', 'favourite-700'], meaning: 'the favourite’s violet' },
    { tokens: ['ownership-500', 'ownership-700'], meaning: 'how you own a game, in teal' },
    { tokens: ['tag-300', 'tag-800', 'tag-900'], meaning: 'your tags’ orange' },
    { tokens: ['star'], meaning: 'your score’s stars' },
    { tokens: ['danger-300', 'danger-400', 'danger-500', 'danger-600', 'danger-700', 'danger-900'], meaning: 'an error’s red' },
    { tokens: ['status-playing'], meaning: 'Playing’s blue' },
] as const;

/**
 * How near, as `colourDistance` measures, the accent or its text shade may come to a shade with a meaning.
 * Several just noticeable differences: a near-copy is caught, a colour merely of the same family is not.
 */
const MEANING_DISTANCE = 0.06;

/** The accent as it is drawn: filled, and as text. */
const ACCENT_SHADES = ['primary-500', 'primary-400'] as const;

const TOKENS = [
    'page', 'fg', 'fg-faint', 'on-primary', ...ACCENT_SHADES,
    ...MEANINGS.flatMap(({ tokens }) => tokens),
] as const;

export type TokenReader = (tokens: readonly string[]) => Partial<Record<string, Rgb | null>>;

/**
 * Each token's colour as the document draws it now, read off a probe that is never shown. A token whose
 * colour does not parse is null, which fails whatever check needs it.
 */
export const readTokens: TokenReader = tokens => {
    const probe = document.createElement('span');
    probe.hidden = true;
    document.body.appendChild(probe);
    try {
        const colours: Partial<Record<string, Rgb | null>> = {};
        for (const token of tokens) {
            probe.style.color = `var(--color-${token})`;
            colours[token] = parseColour(getComputedStyle(probe).color);
        }
        return colours;
    } finally {
        probe.remove();
    }
};

function ratio(first: Rgb | null | undefined, second: Rgb | null | undefined): number {
    return first && second ? contrast(first, second) : 0;
}

function ratioText(value: number): string {
    return `${value.toFixed(1)}:1`;
}

/**
 * The meaning an accent shade comes nearest, if it comes too near any; undefined when every one is clear,
 * or cannot be read. The nearest rather than the first, since a dark red is near both the tags' deep orange
 * and an error's deep red, and is the second.
 */
function nearMeaning(colours: Partial<Record<string, Rgb | null>>): string | undefined {
    const shades = ACCENT_SHADES.map(token => colours[token]).filter((colour): colour is Rgb => !!colour);
    let nearest: { meaning: string; distance: number } | undefined;

    for (const { tokens, meaning } of MEANINGS) {
        for (const token of tokens) {
            const meant = colours[token];
            if (!meant) continue;
            for (const shade of shades) {
                const distance = colourDistance(shade, meant);
                if (distance < MEANING_DISTANCE && (nearest === undefined || distance < nearest.distance)) {
                    nearest = { meaning, distance };
                }
            }
        }
    }

    return nearest?.meaning;
}

/** The six checks, in the order the settings page lists them. */
export function lookChecks(read: TokenReader = readTokens): LookCheck[] {
    const colours = read(TOKENS);
    const accent = colours['primary-500'];

    const body = ratio(colours.fg, colours.page);
    const faint = ratio(colours['fg-faint'], colours.page);
    const accentText = ratio(colours['primary-400'], colours.page);
    const fill = ratio(accent, colours.page);
    const button = ratio(colours['on-primary'], accent);
    const near = nearMeaning(colours);

    return [
        { id: 'body', label: `Body text on background ${ratioText(body)}`, ok: body >= 4.5, required: true },
        { id: 'faint', label: `Faint text on background ${ratioText(faint)}`, ok: faint >= 4.5, required: false },
        { id: 'accent', label: `Accent text on background ${ratioText(accentText)}`, ok: accentText >= 4.5, required: false },
        // The filled accent, which the text shade's floor does not reach: a part of the page, not text, so
        // WCAG's three to one for a control (1.4.11).
        { id: 'fill', label: `Accent against background ${ratioText(fill)}`, ok: fill >= 3, required: false },
        { id: 'button', label: `Button words on accent ${ratioText(button)}`, ok: button >= 4.5, required: false },
        near
            ? { id: 'meaning', label: `Close to ${near}`, ok: false, required: false }
            : { id: 'meaning', label: 'Clear of the colours with a meaning', ok: accent != null, required: false },
    ];
}

/** Whether a palette may be saved: every required check passes. */
export function savable(checks: readonly LookCheck[]): boolean {
    return checks.every(check => check.ok || !check.required);
}

/** The page's background and accent as the document draws them, for a custom palette to start from. */
export function currentColours(read: TokenReader = readTokens): { background: string; accent: string } | null {
    const colours = read(['page', 'primary-500']);
    const page = colours.page;
    const accent = colours['primary-500'];
    return page && accent ? { background: toHex(page), accent: toHex(accent) } : null;
}
