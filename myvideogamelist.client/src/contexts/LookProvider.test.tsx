import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { LookProvider } from '@/contexts/LookProvider';
import { useLook } from '@/hooks/useLook';
import { LOOK_STORAGE_KEY } from '@/lib/look';
import { userProfile } from '@/test/factories';
import { DEFAULT_LOOK, type Look } from '@/types/look';

const auth = vi.hoisted(() => ({ value: null as unknown as Pick<AuthContextValue, 'user' | 'loading'> }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth.value }));

const root = document.documentElement;
const SLATE: Look = { ...DEFAULT_LOOK, palette: 'slate', pattern: 'perspective' };
const PLUM: Look = { ...DEFAULT_LOOK, palette: 'plum' };

let preview: (next: Look | null) => void = () => {};
const takePreview = (show: (next: Look | null) => void) => { preview = show; };

/** Hands the test the provider's `preview`, as the settings page would use it. */
function Previewer() {
    const { preview: show } = useLook();
    useEffect(() => takePreview(show), [show]);
    return null;
}

function renderProvider() {
    return render(<LookProvider><Previewer /></LookProvider>);
}

const stored = () => JSON.parse(localStorage.getItem(LOOK_STORAGE_KEY) ?? 'null') as Look | null;

beforeEach(() => {
    auth.value = { user: null, loading: true };
});

afterEach(() => {
    localStorage.clear();
    for (const name of ['data-palette', 'data-pattern', 'data-pattern-tint', 'style']) root.removeAttribute(name);
});

describe('LookProvider', () => {
    it('leaves the page as the head script drew it until auth answers', () => {
        root.setAttribute('data-palette', 'dusk');
        localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify(SLATE));

        renderProvider();

        expect(root.getAttribute('data-palette')).toBe('dusk');
        expect(stored()).toEqual(SLATE);
    });

    it("draws the account's look once auth answers, and keeps the browser's copy of it", () => {
        const { rerender } = renderProvider();

        auth.value = { user: userProfile({ look: SLATE }), loading: false };
        rerender(<LookProvider><Previewer /></LookProvider>);

        expect(root.getAttribute('data-palette')).toBe('slate');
        expect(root.getAttribute('data-pattern')).toBe('perspective');
        expect(stored()).toEqual(SLATE);
    });

    it('draws the default for nobody, and forgets the last reader', () => {
        localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify(SLATE));
        auth.value = { user: null, loading: false };

        renderProvider();

        expect(root.getAttribute('data-palette')).toBe('ink');
        expect(root.getAttribute('data-pattern')).toBe('honeycomb');
        expect(localStorage.getItem(LOOK_STORAGE_KEY)).toBeNull();
    });

    it("draws a preview over the account's look without keeping it, and the account's again after", () => {
        auth.value = { user: userProfile({ look: SLATE }), loading: false };
        renderProvider();

        act(() => preview(PLUM));
        expect(root.getAttribute('data-palette')).toBe('plum');
        expect(stored()).toEqual(SLATE);

        act(() => preview(null));
        expect(root.getAttribute('data-palette')).toBe('slate');
    });

    it("never draws one account's preview for another", () => {
        auth.value = { user: userProfile({ id: 'alex', look: SLATE }), loading: false };
        const { rerender } = renderProvider();
        act(() => preview(PLUM));

        auth.value = { user: userProfile({ id: 'sam', look: DEFAULT_LOOK }), loading: false };
        rerender(<LookProvider><Previewer /></LookProvider>);

        expect(root.getAttribute('data-palette')).toBe('ink');
    });
});
