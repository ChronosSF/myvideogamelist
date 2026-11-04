import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LookCard } from '@/components/LookCard';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { LookCheck } from '@/lib/lookChecks';
import { DEFAULT_LOOK, type Look } from '@/types/look';

/** One object for every render: a fresh one per call re-runs whatever depends on it. */
const auth: AuthContextValue = {
    user: null,
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    updateProfileDetails: vi.fn(async () => {}),
    updateLook: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};
const look = { preview: vi.fn() };

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useLook', () => ({ useLook: () => look }));

// The checks read the page's computed colours, which jsdom does not compute; what they decide is
// `lookChecks.test.ts`'s, and here they pass or fail as a test says.
const checks = vi.hoisted(() => ({ ok: true }));
vi.mock('@/lib/lookChecks', () => ({
    lookChecks: (): LookCheck[] => [
        { id: 'body', label: 'Body text on background 12.3:1', ok: true },
        { id: 'faint', label: 'Faint text on background 5.9:1', ok: checks.ok },
        { id: 'accent', label: 'Accent against background 11.4:1', ok: true },
        { id: 'button', label: 'Button words on accent 11.4:1', ok: true },
        { id: 'meaning', label: 'Clear of the colours with a meaning', ok: true },
    ],
    currentColours: () => ({ background: '#1a1918', accent: '#9ae600' }),
}));

const saveLook = vi.mocked(auth.updateLook);
const root = document.documentElement;

function renderCard(saved: Look = DEFAULT_LOOK, canChoose = true) {
    return render(<LookCard look={saved} canChoose={canChoose} />);
}

beforeEach(() => {
    checks.ok = true;
    saveLook.mockReset();
    saveLook.mockResolvedValue(undefined);
    look.preview.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
    for (const name of ['data-palette', 'data-pattern', 'data-pattern-tint', 'style']) root.removeAttribute(name);
});

describe('LookCard', () => {
    it("opens on the account's look, saved", () => {
        renderCard({ ...DEFAULT_LOOK, palette: 'dusk', pattern: 'pixels', tint: 'accent' });

        expect(screen.getByRole('radio', { name: 'Dusk and periwinkle' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'Pixel matrix' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'Accent' })).toBeChecked();
        expect(screen.getByText('Saved to your account')).toBeInTheDocument();
    });

    it('draws a preset on the page at once and saves it to the account', async () => {
        renderCard();

        await userEvent.click(screen.getByRole('radio', { name: 'Slate and ice' }));

        const slate = { ...DEFAULT_LOOK, palette: 'slate' };
        expect(root.getAttribute('data-palette')).toBe('slate');
        expect(look.preview).toHaveBeenLastCalledWith(slate);
        expect(saveLook).toHaveBeenCalledWith(slate);
        expect(await screen.findByText('Saved to your account')).toBeInTheDocument();
    });

    it('saves a pattern and its colour the same way', async () => {
        renderCard();

        await userEvent.click(screen.getByRole('radio', { name: 'Isometric' }));
        await userEvent.click(screen.getByRole('radio', { name: 'Accent' }));

        expect(root.getAttribute('data-pattern')).toBe('isometric');
        expect(root.getAttribute('data-pattern-tint')).toBe('accent');
        expect(saveLook).toHaveBeenLastCalledWith({ ...DEFAULT_LOOK, pattern: 'isometric', tint: 'accent' });
    });

    it('has no pattern colour to choose with no pattern', async () => {
        renderCard({ ...DEFAULT_LOOK, pattern: 'none' });

        expect(screen.getByRole('radio', { name: 'Grey' })).toBeDisabled();
        expect(screen.getByRole('radio', { name: 'Accent' })).toBeDisabled();
    });

    it("starts a custom palette from the page's colours, checks it and saves it", async () => {
        renderCard();

        await userEvent.click(screen.getByRole('radio', { name: 'Custom' }));

        expect(screen.getByLabelText('Background colour')).toHaveValue('#1a1918');
        expect(screen.getByLabelText('Accent colour')).toHaveValue('#9ae600');
        expect(screen.getByRole('list', { name: 'Readability' })).toHaveTextContent('Passes: Body text on background 12.3:1');
        expect(root.style.getPropertyValue('--look-page')).toBe('#1a1918');
        expect(saveLook).toHaveBeenCalledWith({ ...DEFAULT_LOOK, palette: 'custom', background: '#1a1918', accent: '#9ae600' });
    });

    it('saves a picked colour once the picker rests, not at every colour it passes', () => {
        vi.useFakeTimers();
        renderCard({ ...DEFAULT_LOOK, palette: 'custom', background: '#1a1918', accent: '#9ae600' });

        fireEvent.change(screen.getByLabelText('Background colour'), { target: { value: '#10182a' } });
        fireEvent.change(screen.getByLabelText('Background colour'), { target: { value: '#101820' } });

        expect(root.style.getPropertyValue('--look-page')).toBe('#101820');
        expect(saveLook).not.toHaveBeenCalled();
        expect(screen.getByText('Saving…')).toBeInTheDocument();

        act(() => vi.advanceTimersByTime(500));

        expect(saveLook).toHaveBeenCalledTimes(1);
        expect(saveLook).toHaveBeenCalledWith({ ...DEFAULT_LOOK, palette: 'custom', background: '#101820', accent: '#9ae600' });
    });

    it('draws a custom palette that fails a check, and does not save it', async () => {
        checks.ok = false;
        renderCard();

        await userEvent.click(screen.getByRole('radio', { name: 'Custom' }));

        expect(root.getAttribute('data-palette')).toBe('custom');
        expect(screen.getByRole('list', { name: 'Readability' })).toHaveTextContent('Fails: Faint text on background 5.9:1');
        expect(screen.getByText('Not saved until every check passes')).toBeInTheDocument();
        expect(saveLook).not.toHaveBeenCalled();
    });

    it("goes back to the account's look when a save fails, and says why", async () => {
        saveLook.mockRejectedValueOnce(new Error('We could not reach MyVideoGameList just now. Please try again.'));
        renderCard();

        await userEvent.click(screen.getByRole('radio', { name: 'Plum and orchid' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach MyVideoGameList just now.');
        expect(screen.getByRole('radio', { name: 'Ink and lime' })).toBeChecked();
        expect(root.getAttribute('data-palette')).toBe('ink');
        expect(look.preview).toHaveBeenLastCalledWith(null);
    });

    it('saves one choice at a time, and the latest after the one in flight', async () => {
        let answer = () => {};
        saveLook.mockImplementationOnce(() => new Promise<void>(resolve => { answer = resolve; }));
        renderCard();

        await userEvent.click(screen.getByRole('radio', { name: 'Slate and ice' }));
        await userEvent.click(screen.getByRole('radio', { name: 'Dusk and periwinkle' }));
        await userEvent.click(screen.getByRole('radio', { name: 'Graphite and chalk' }));

        expect(saveLook).toHaveBeenCalledTimes(1);

        await act(async () => answer());

        expect(saveLook).toHaveBeenCalledTimes(2);
        expect(saveLook).toHaveBeenLastCalledWith({ ...DEFAULT_LOOK, palette: 'graphite' });
    });

    it('resets to the default, which it cannot do from the default', async () => {
        const { unmount } = renderCard();
        expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
        unmount();

        renderCard({ ...DEFAULT_LOOK, palette: 'slate', pattern: 'none' });
        await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));

        expect(saveLook).toHaveBeenCalledWith(DEFAULT_LOOK);
    });

    it('shows an account that may not choose the choices as coming soon, and lets it make none', async () => {
        renderCard(DEFAULT_LOOK, false);

        expect(screen.getByText('Coming soon')).toBeInTheDocument();
        for (const name of ['Ink and lime', 'Slate and ice', 'Custom', 'Isometric', 'None', 'Grey', 'Accent']) {
            expect(screen.getByRole('radio', { name })).toBeDisabled();
        }
        expect(screen.getByRole('radio', { name: 'Ink and lime' })).toBeChecked();
        expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();
        expect(screen.queryByText('Saved to your account')).not.toBeInTheDocument();

        await userEvent.click(screen.getByText('Slate and ice'));

        expect(saveLook).not.toHaveBeenCalled();
        expect(root.getAttribute('data-palette')).toBeNull();
    });

    it('says nothing is coming to an account that may choose', () => {
        renderCard();

        expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Slate and ice' })).toBeEnabled();
    });

    it("ends its preview when the page is left, so the account's look comes back", () => {
        const { unmount } = renderCard();

        unmount();

        expect(look.preview).toHaveBeenLastCalledWith(null);
    });
});
