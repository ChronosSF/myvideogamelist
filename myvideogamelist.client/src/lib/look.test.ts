import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, type Look } from '@/types/look';
import { applyLook, LOOK_SCRIPT, LOOK_SCRIPT_HASH, LOOK_STORAGE_KEY, storeLook } from './look';

const root = document.documentElement;

const CUSTOM: Look = { palette: 'custom', background: '#10182a', accent: '#c8f560', pattern: 'pixels', tint: 'accent' };

function runScript() {
    // The text the document renders, run as the browser runs it.
    new Function(LOOK_SCRIPT)();
}

function attributes() {
    return {
        palette: root.getAttribute('data-palette'),
        pattern: root.getAttribute('data-pattern'),
        tint: root.getAttribute('data-pattern-tint'),
        page: root.style.getPropertyValue('--look-page'),
        accent: root.style.getPropertyValue('--look-accent'),
    };
}

afterEach(() => {
    localStorage.clear();
    for (const name of ['data-palette', 'data-pattern', 'data-pattern-tint', 'style']) root.removeAttribute(name);
});

describe('LOOK_SCRIPT_HASH', () => {
    it("is the script's own SHA-256, so the policy admits the script the page renders", () => {
        const hash = `sha256-${createHash('sha256').update(LOOK_SCRIPT, 'utf8').digest('base64')}`;

        expect(LOOK_SCRIPT_HASH).toBe(hash);
    });
});

describe('the head script', () => {
    it('puts the stored look on the document', () => {
        storeLook(CUSTOM);

        runScript();

        expect(attributes()).toEqual({ palette: 'custom', pattern: 'pixels', tint: 'accent', page: '#10182a', accent: '#c8f560' });
    });

    it('does nothing when nothing is stored, so the page is the default', () => {
        runScript();

        expect(attributes()).toEqual({ palette: null, pattern: null, tint: null, page: '', accent: '' });
    });

    it('reads a name it does not know as the default', () => {
        localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify({ palette: 'light', pattern: 'hexes', tint: 'lime' }));

        runScript();

        expect(attributes()).toMatchObject({ palette: 'ink', pattern: 'honeycomb', tint: 'grey' });
    });

    it('draws a custom palette whose colours are not colours as the default, and sets neither', () => {
        localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify({ ...CUSTOM, background: 'red;color:red' }));

        runScript();

        expect(attributes()).toMatchObject({ palette: 'ink', page: '', accent: '' });
    });

    it('survives a stored value that is not JSON', () => {
        localStorage.setItem(LOOK_STORAGE_KEY, '{not json');

        expect(runScript).not.toThrow();
        expect(attributes().palette).toBeNull();
    });
});

describe('applyLook', () => {
    it('puts a look on the document as the head script does', () => {
        applyLook(CUSTOM);
        const applied = attributes();
        root.removeAttribute('style');
        storeLook(CUSTOM);

        runScript();

        expect(attributes()).toEqual(applied);
    });

    it("takes a custom palette's colours away when a preset replaces it", () => {
        applyLook(CUSTOM);

        applyLook({ ...DEFAULT_LOOK, palette: 'plum' });

        expect(attributes()).toEqual({ palette: 'plum', pattern: 'honeycomb', tint: 'grey', page: '', accent: '' });
    });
});

describe('storeLook', () => {
    it('keeps the look, and forgets it given nothing', () => {
        storeLook(CUSTOM);
        expect(JSON.parse(localStorage.getItem(LOOK_STORAGE_KEY) ?? 'null')).toEqual(CUSTOM);

        storeLook(null);
        expect(localStorage.getItem(LOOK_STORAGE_KEY)).toBeNull();
    });
});
