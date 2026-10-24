import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { GameCard } from '@/components/GameCard';
import { GameCardSkeleton } from '@/components/GameCardSkeleton';
import { GameGridSkeleton } from '@/components/GameGridSkeleton';
import { CARD_BODY, CARD_COVER, CARD_FRAME, GAME_GRID } from '@/lib/gameGrid';
import { game } from '@/test/factories';

// The card reads these four, and their real providers would fetch.
vi.mock('@/hooks/useAuth', () => {
    const value = { user: null, loading: false };
    return { useAuth: () => value };
});
vi.mock('@/hooks/useLists', () => {
    const value = { addToList: vi.fn(), removeFromList: vi.fn(), isInList: () => false, isPending: () => false, nameFor: () => '' };
    return { useLists: () => value };
});
vi.mock('@/hooks/useWishlist', () => {
    const value = { isWishlisted: () => false, isPending: () => false, add: vi.fn(), remove: vi.fn() };
    return { useWishlist: () => value };
});
vi.mock('@/hooks/useFavourites', () => {
    const value = { isFavourite: () => false };
    return { useFavourites: () => value };
});

/**
 * A box's classes as a set. jsdom lays nothing out, so a size cannot be measured here; what decides a
 * box's size is the classes it carries, and those can be compared. The measuring was done in a
 * browser, and is in the pull request that added these.
 */
const classes = (element: Element | null) => new Set((element?.getAttribute('class') ?? '').split(/\s+/));

function expectToCarry(element: Element | null, wanted: string) {
    const has = classes(element);
    for (const name of wanted.split(' ')) expect(has, `missing ${name}`).toContain(name);
}

describe('GameCardSkeleton', () => {
    it("is drawn in the card's own frame, cover box and body, so the card lands on it", () => {
        const card = render(<MemoryRouter><GameCard game={game({ title: 'Hades' })} /></MemoryRouter>).container.firstElementChild;
        const skeleton = render(<GameCardSkeleton />).container.firstElementChild;

        for (const [box, wanted] of [[0, CARD_COVER], [1, CARD_BODY]] as const) {
            expectToCarry(card?.children[box] ?? null, wanted);
            expectToCarry(skeleton?.children[box] ?? null, wanted);
        }
        expectToCarry(card, CARD_FRAME);
        expectToCarry(skeleton, CARD_FRAME);
    });

    it('has nothing in it for a screen reader to read', () => {
        const { container } = render(<GameCardSkeleton />);

        expect(container.textContent).toBe('');
        for (const shape of container.querySelectorAll('.skeleton')) {
            expect(shape).toHaveAttribute('aria-hidden', 'true');
        }
    });
});

describe('GameGridSkeleton', () => {
    it("lays its cards out in the games grid's own columns, as many as it is asked for", () => {
        const { container } = render(<GameGridSkeleton count={7} />);

        expectToCarry(container.firstElementChild, GAME_GRID);
        expect(container.firstElementChild?.children).toHaveLength(7);
    });
});
