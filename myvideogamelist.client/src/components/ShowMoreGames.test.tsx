import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShowMoreGames } from '@/components/ShowMoreGames';

/**
 * jsdom has no `IntersectionObserver`, so each test that scrolls stands one in: it records what it was
 * asked to watch, and the test says when that came into reach.
 */
class FakeObserver {
    static made: FakeObserver[] = [];
    watched: Element[] = [];
    disconnected = false;

    constructor(readonly report: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
        FakeObserver.made.push(this);
    }

    observe(element: Element) {
        this.watched.push(element);
    }

    disconnect() {
        this.disconnected = true;
    }

    /** The watched button coming within reach, or going out of it. */
    reach(isIntersecting: boolean) {
        const entries = this.watched.map(target => ({ target, isIntersecting }) as IntersectionObserverEntry);
        act(() => this.report(entries, this as unknown as IntersectionObserver));
    }
}

const live = () => FakeObserver.made.filter(observer => !observer.disconnected);

describe('ShowMoreGames', () => {
    beforeEach(() => {
        FakeObserver.made = [];
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('says how much of the list is drawn and how many are left, and draws more when pressed', async () => {
        const onShowMore = vi.fn();
        render(<ShowMoreGames shown={60} left={1580} onShowMore={onShowMore} />);

        expect(screen.getByRole('status')).toHaveTextContent('Showing 60 of 1,640');
        await userEvent.click(screen.getByRole('button', { name: 'Show more (1,580 left)' }));

        expect(onShowMore).toHaveBeenCalledOnce();
    });

    it('is pressed for the reader once it is within a screen of being scrolled to', () => {
        vi.stubGlobal('IntersectionObserver', FakeObserver);
        const onShowMore = vi.fn();
        render(<ShowMoreGames shown={60} left={70} onShowMore={onShowMore} />);

        const [observer] = live();
        expect(observer.watched).toEqual([screen.getByRole('button', { name: /^Show more/ })]);
        expect(observer.options?.rootMargin).toBe('0px 0px 100% 0px');

        observer.reach(false);
        expect(onShowMore).not.toHaveBeenCalled();

        observer.reach(true);
        expect(onShowMore).toHaveBeenCalledOnce();
    });

    it('watches again after each chunk, so a button still in reach is pressed again', () => {
        vi.stubGlobal('IntersectionObserver', FakeObserver);
        const onShowMore = vi.fn();
        const { rerender } = render(<ShowMoreGames shown={60} left={130} onShowMore={onShowMore} />);
        const first = live()[0];

        rerender(<ShowMoreGames shown={120} left={70} onShowMore={onShowMore} />);

        expect(first.disconnected).toBe(true);
        expect(live()).toHaveLength(1);
        expect(live()[0].watched).toEqual([screen.getByRole('button', { name: 'Show more (70 left)' })]);
    });
});
