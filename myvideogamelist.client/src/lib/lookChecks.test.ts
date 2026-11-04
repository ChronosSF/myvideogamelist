import { describe, expect, it } from 'vitest';
import { parseColour, type Rgb } from './colour';
import { currentColours, lookChecks, type TokenReader } from './lookChecks';

/** The default palette's tokens, as a browser computes them. */
const INK: Record<string, string> = {
    page: 'oklch(0.215 0.003 67.7)',
    fg: 'oklch(0.883 0.016 86.4)',
    'fg-faint': 'oklch(0.67 0.019 84.6)',
    'primary-500': 'oklch(0.841 0.238 128.85)',
    'on-primary': 'oklch(0.215 0.003 67.7)',
    'wishlist-600': 'oklch(0.592 0.249 0.584)',
    'favourite-500': 'oklch(0.606 0.25 292.717)',
    'ownership-500': 'oklch(0.704 0.14 182.503)',
    'tag-300': 'oklch(0.837 0.128 66.29)',
    star: 'oklch(0.852 0.199 91.936)',
    'danger-500': 'oklch(0.637 0.237 25.331)',
    'status-playing': 'oklch(0.623 0.214 259.815)',
};

function reader(overrides: Record<string, string> = {}): TokenReader {
    const tokens = { ...INK, ...overrides };
    return names => Object.fromEntries(names.map(name => [name, parseColour(tokens[name] ?? '')])) as Record<string, Rgb | null>;
}

const byId = (checks: ReturnType<typeof lookChecks>) => Object.fromEntries(checks.map(check => [check.id, check]));

describe('lookChecks', () => {
    it('passes the default palette on every count', () => {
        const checks = lookChecks(reader());

        expect(checks.map(check => check.ok)).toEqual([true, true, true, true, true]);
        expect(checks.map(check => check.label)).toEqual([
            'Body text on background 12.3:1',
            'Faint text on background 5.9:1',
            'Accent against background 11.4:1',
            'Button words on accent 11.4:1',
            'Clear of the colours with a meaning',
        ]);
    });

    it('fails a background too light for the text', () => {
        const checks = byId(lookChecks(reader({ page: '#8a8a8a', 'on-primary': '#8a8a8a' })));

        expect(checks.body.ok).toBe(false);
        expect(checks.faint.ok).toBe(false);
    });

    it('fails an accent the button words cannot be read on', () => {
        expect(byId(lookChecks(reader({ 'primary-500': '#6b6b6b' }))).button.ok).toBe(false);
    });

    it('fails an accent near a colour with a meaning, and names it', () => {
        const meaning = byId(lookChecks(reader({ 'primary-500': '#e0368a' }))).meaning;

        expect(meaning).toEqual({ id: 'meaning', label: 'Too close to the wishlist’s pink', ok: false });
    });

    it('lets a grey accent be any hue, since it has none', () => {
        expect(byId(lookChecks(reader({ 'primary-500': '#f3efe6' }))).meaning.ok).toBe(true);
    });

    it('fails every check whose colours it cannot read', () => {
        const checks = lookChecks(() => ({}));

        expect(checks.map(check => check.ok)).toEqual([false, false, false, false, false]);
    });
});

describe('currentColours', () => {
    it("is the page's background and accent, as a colour picker takes them", () => {
        expect(currentColours(reader())).toEqual({ background: '#1a1918', accent: '#9ae600' });
    });
});
