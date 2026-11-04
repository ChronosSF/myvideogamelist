import { contrast, hueDistance, hueOf, parseColour, toHex, type Rgb } from '@/lib/colour';

/**
 * Whether a custom palette reads, measured on the page while it is drawn in it (ADR 0082).
 *
 * The palette's surfaces, text and accent steps are `theme.css`'s, worked out from its two colours by the
 * browser, so the checks read the tokens back off the document rather than restating those formulas here:
 * a formula retuned there is a formula checked here. The server checks only that the colours are colours,
 * so these are what keep a custom palette readable; one that fails them is shown and not saved.
 */
export interface LookCheck {
    id: 'body' | 'faint' | 'accent' | 'button' | 'meaning';
    label: string;
    ok: boolean;
}

/**
 * The colours that mean something and stay the same in every palette, each with what it means, as a
 * sentence ends: an accent near one of them would make a mark of the reader's own read as one of these.
 * The success green is not among them, since the default accent is the lime beside it, and neither are the
 * statuses but Playing, whose blue is the one drawn as a fill wherever a game is.
 */
const MEANINGS = [
    ['wishlist-600', 'the wishlist’s pink'],
    ['favourite-500', 'the favourite’s violet'],
    ['ownership-500', 'how you own a game, in teal'],
    ['tag-300', 'your tags’ orange'],
    ['star', 'your score’s stars'],
    ['danger-500', 'an error’s red'],
    ['status-playing', 'Playing’s blue'],
] as const;

/** How near in hue, in degrees, an accent may come to one of them, once it has enough colour to have a hue. */
const MEANING_HUE_DISTANCE = 14;
const MEANING_CHROMA = 0.2;

const TOKENS = ['page', 'fg', 'fg-faint', 'primary-500', 'on-primary', ...MEANINGS.map(([token]) => token)] as const;

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

/** The five checks, in the order the settings page lists them. */
export function lookChecks(read: TokenReader = readTokens): LookCheck[] {
    const colours = read(TOKENS);
    const accent = colours['primary-500'];

    const body = ratio(colours.fg, colours.page);
    const faint = ratio(colours['fg-faint'], colours.page);
    const against = ratio(accent, colours.page);
    const button = ratio(colours['on-primary'], accent);

    const tone = accent ? hueOf(accent) : null;
    const near = tone && tone.chroma > MEANING_CHROMA
        ? MEANINGS.find(([token]) => {
            const colour = colours[token];
            return colour ? hueDistance(tone.hue, hueOf(colour).hue) < MEANING_HUE_DISTANCE : false;
        })
        : undefined;

    return [
        { id: 'body', label: `Body text on background ${ratioText(body)}`, ok: body >= 4.5 },
        { id: 'faint', label: `Faint text on background ${ratioText(faint)}`, ok: faint >= 4.5 },
        // A part of the page, not text, so WCAG's three to one for a control (1.4.11).
        { id: 'accent', label: `Accent against background ${ratioText(against)}`, ok: against >= 3 },
        { id: 'button', label: `Button words on accent ${ratioText(button)}`, ok: button >= 4.5 },
        near
            ? { id: 'meaning', label: `Too close to ${near[1]}`, ok: false }
            : { id: 'meaning', label: 'Clear of the colours with a meaning', ok: tone !== null },
    ];
}

/** The page's background and accent as the document draws them, for a custom palette to start from. */
export function currentColours(read: TokenReader = readTokens): { background: string; accent: string } | null {
    const colours = read(['page', 'primary-500']);
    const page = colours.page;
    const accent = colours['primary-500'];
    return page && accent ? { background: toHex(page), accent: toHex(accent) } : null;
}
