import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { PlaythroughToast, type ToastView } from '@/components/PlaythroughToast';
import { PROMPT_TIMING } from '@/lib/playthroughPrompt';
import { game, playthrough } from '@/test/factories';

const ASKING: ToastView = {
    id: 1,
    game: game({ id: 1, title: 'Celeste' }),
    ask: { kind: 'start', day: '2026-11-15' },
    phase: 'asking',
    refusal: null,
    saved: null,
};

function renderToast(view: ToastView | null, onDismiss = vi.fn()) {
    const props = {
        onAccept: vi.fn(),
        onDismiss,
        onDetails: vi.fn(),
        rememberReturn: vi.fn(),
        restoreFocus: vi.fn(),
    };
    const result = render(<PlaythroughToast toast={view} {...props} />);
    return { ...result, ...props, rerenderWith: (next: ToastView | null) => result.rerender(<PlaythroughToast toast={next} {...props} />) };
}

const box = () => screen.getByRole('group', { name: /Playthrough question/ });

describe('how long it stays', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('goes after the question\'s time, untouched', () => {
        const { onDismiss } = renderToast(ASKING);

        act(() => vi.advanceTimersByTime(PROMPT_TIMING.askMs - 1));
        expect(onDismiss).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));
        expect(onDismiss).toHaveBeenCalledWith(1);
    });

    it('stops while the pointer is over it, and goes on with what was left', () => {
        const { onDismiss } = renderToast(ASKING);

        act(() => vi.advanceTimersByTime(5_000));
        fireEvent.mouseEnter(box());
        act(() => vi.advanceTimersByTime(60_000));
        expect(onDismiss).not.toHaveBeenCalled();

        fireEvent.mouseLeave(box());
        act(() => vi.advanceTimersByTime(PROMPT_TIMING.askMs - 5_000 - 1));
        expect(onDismiss).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));
        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('stops while focus is inside it', () => {
        const { onDismiss } = renderToast(ASKING);

        act(() => screen.getByRole('button', { name: 'Start it' }).focus());
        act(() => vi.advanceTimersByTime(60_000));
        expect(onDismiss).not.toHaveBeenCalled();

        act(() => screen.getByRole('button', { name: 'Start it' }).blur());
        act(() => vi.advanceTimersByTime(PROMPT_TIMING.askMs));
        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('does not run while a yes is saving', () => {
        const { onDismiss } = renderToast({ ...ASKING, phase: 'saving' });

        act(() => vi.advanceTimersByTime(60_000));
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('keeps the confirmation up for less, starting again from its own time', () => {
        const { onDismiss, rerenderWith } = renderToast(ASKING);
        act(() => vi.advanceTimersByTime(PROMPT_TIMING.askMs - 1_000));

        rerenderWith({ ...ASKING, phase: 'confirmed', saved: playthrough({ id: 7 }) });
        act(() => vi.advanceTimersByTime(PROMPT_TIMING.confirmedMs - 1));
        expect(onDismiss).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));
        expect(onDismiss).toHaveBeenCalledOnce();
        expect(PROMPT_TIMING.confirmedMs).toBeLessThan(PROMPT_TIMING.askMs);
    });

    it('starts the next toast unpaused after one taken away under the pointer', () => {
        const { onDismiss, rerenderWith } = renderToast(ASKING);
        fireEvent.mouseEnter(box());

        rerenderWith(null);
        rerenderWith({ ...ASKING, id: 2 });
        act(() => vi.advanceTimersByTime(PROMPT_TIMING.askMs));

        expect(onDismiss).toHaveBeenCalledWith(2);
    });
});

describe('what it is to a screen reader', () => {
    it('puts the question in the polite region, and a failure in the alert', () => {
        const { rerenderWith } = renderToast(ASKING);
        expect(screen.getByRole('status')).toContainElement(box());
        expect(screen.getByRole('status')).toHaveTextContent('Press F8 to answer.');
        expect(screen.getByRole('alert')).toBeEmptyDOMElement();

        rerenderWith({ ...ASKING, phase: 'failed' });
        expect(screen.getByRole('alert')).toContainElement(box());
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('draws both regions empty when there is nothing to ask, so a question put in them is announced', () => {
        renderToast(null);
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
        expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    });

    it('is not in the server render at all, regions included', () => {
        const props = { onAccept: vi.fn(), onDismiss: vi.fn(), onDetails: vi.fn(), rememberReturn: vi.fn(), restoreFocus: vi.fn() };
        expect(renderToString(<PlaythroughToast toast={ASKING} {...props} />)).toBe('');
    });
});
