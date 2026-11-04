import { describe, expect, it } from 'vitest';
import { parseColour, type Rgb } from './colour';
import { currentColours, lookChecks, savable, type TokenReader } from './lookChecks';

/** The default palette's tokens, as a browser computes them. */
const INK: Record<string, string> = {
    page: 'oklch(0.215 0.003 67.7)',
    fg: 'oklch(0.883 0.016 86.4)',
    'fg-faint': 'oklch(0.67 0.019 84.6)',
    'primary-400': 'oklch(0.897 0.196 126.665)',
    'primary-500': 'oklch(0.841 0.238 128.85)',
    'on-primary': 'oklch(0.215 0.003 67.7)',
    'wishlist-600': 'oklch(0.592 0.249 0.584)',
    'wishlist-700': 'oklch(0.525 0.223 3.958)',
    'favourite-300': 'oklch(0.811 0.111 293.571)',
    'favourite-400': 'oklch(0.702 0.183 293.541)',
    'favourite-500': 'oklch(0.606 0.25 292.717)',
    'favourite-600': 'oklch(0.541 0.281 293.009)',
    'favourite-700': 'oklch(0.491 0.27 292.581)',
    'ownership-500': 'oklch(0.704 0.14 182.503)',
    'ownership-700': 'oklch(0.511 0.096 186.391)',
    'tag-300': 'oklch(0.837 0.128 66.29)',
    'tag-800': 'oklch(0.47 0.157 37.304)',
    'tag-900': 'oklch(0.408 0.123 38.172)',
    star: 'oklch(0.852 0.199 91.936)',
    'danger-300': 'oklch(0.808 0.114 19.571)',
    'danger-400': 'oklch(0.704 0.191 22.216)',
    'danger-500': 'oklch(0.637 0.237 25.331)',
    'danger-600': 'oklch(0.577 0.245 27.325)',
    'danger-700': 'oklch(0.505 0.213 27.518)',
    'danger-900': 'oklch(0.396 0.141 25.723)',
    'status-playing': 'oklch(0.623 0.214 259.815)',
};

function reader(overrides: Record<string, string> = {}): TokenReader {
    const tokens = { ...INK, ...overrides };
    return names => Object.fromEntries(names.map(name => [name, parseColour(tokens[name] ?? '')])) as Record<string, Rgb | null>;
}

/** An accent drawn filled and as text in the same colour, which is enough to measure it by. */
const accent = (colour: string) => ({ 'primary-500': colour, 'primary-400': colour });

const byId = (checks: ReturnType<typeof lookChecks>) => Object.fromEntries(checks.map(check => [check.id, check]));

describe('lookChecks', () => {
    it('passes the default palette on every count', () => {
        const checks = lookChecks(reader());

        expect(checks.map(check => check.ok)).toEqual([true, true, true, true, true]);
        expect(checks.map(check => check.label)).toEqual([
            'Body text on background 12.3:1',
            'Faint text on background 5.9:1',
            'Accent text on background 13.4:1',
            'Button words on accent 11.4:1',
            'Clear of the colours with a meaning',
        ]);
    });

    it('requires the body text to read and advises on the rest', () => {
        expect(lookChecks(reader()).map(check => [check.id, check.required])).toEqual([
            ['body', true], ['faint', false], ['accent', false], ['button', false], ['meaning', false],
        ]);
    });

    it('will not save a background too light for the text', () => {
        const checks = lookChecks(reader({ page: '#8a8a8a', 'on-primary': '#8a8a8a' }));

        expect(byId(checks).body.ok).toBe(false);
        expect(savable(checks)).toBe(false);
    });

    it('saves an accent that only fails the advice, such as a dark red', () => {
        // The red a reader wanted: too dark to read as text on a dark page, and an error's red.
        const checks = byId(lookChecks(reader(accent('#8b1a1a'))));

        expect(checks.accent.ok).toBe(false);
        expect(checks.meaning).toMatchObject({ label: 'Close to an error’s red', ok: false });
        expect(savable(Object.values(checks))).toBe(true);
    });

    it('names the meaning an accent is near', () => {
        expect(byId(lookChecks(reader(accent('#e0368a')))).meaning.label).toBe('Close to the wishlist’s pink');
    });

    it('lets an accent of the same family as a meaning through when it does not look like it', () => {
        // Ice, sky-300: the hue of a blue, far lighter than Playing's.
        expect(byId(lookChecks(reader(accent('#7dd3fc')))).meaning.ok).toBe(true);
        // Paper has no hue to speak of.
        expect(byId(lookChecks(reader(accent('#f3efe6')))).meaning.ok).toBe(true);
    });

    it('fails every check whose colours it cannot read, and so will not save', () => {
        const checks = lookChecks(() => ({}));

        expect(checks.map(check => check.ok)).toEqual([false, false, false, false, false]);
        expect(savable(checks)).toBe(false);
    });
});

describe('currentColours', () => {
    it("is the page's background and accent, as a colour picker takes them", () => {
        expect(currentColours(reader())).toEqual({ background: '#1a1918', accent: '#9ae600' });
    });
});
