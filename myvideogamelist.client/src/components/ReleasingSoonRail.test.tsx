import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ReleasingSoonRail } from '@/components/ReleasingSoonRail';
import type { UseUpcomingGamesResult } from '@/hooks/useUpcomingGames';
import { DEFAULT_SORT } from '@/lib/listSort';
import { emptyLists, type ListEntryDto, type ListId } from '@/types/list';
import type { WishlistItemDto } from '@/types/wishlist';
import { entry, game, platform } from '@/test/factories';

/**
 * Both providers, mocked rather than provided: the real ones fetch, and the rail only reads what they
 * hold. One module-level object each, handed back every call — a fresh literal per render re-runs any
 * effect depending on it, which ends in a heap crash rather than an assertion failure.
 */
const listsValue = {
    lists: emptyLists() as Record<ListId, ListEntryDto[]>,
    loading: false,
    error: null as string | null,
    mutationError: null as string | null,
    isPending: () => false,
    addToList: vi.fn(async () => {}),
    removeFromList: vi.fn(async () => {}),
    isInList: () => false,
    getListFor: () => null,
    scoreFor: () => null,
    setScore: vi.fn(async () => true),
    setOwnership: vi.fn(async () => true),
    setNotes: vi.fn(async () => true),
    deleteEntry: vi.fn(async () => {}),
    view: 'tiles' as const,
    setView: vi.fn(),
    sortFor: () => DEFAULT_SORT,
    setSort: vi.fn(),
};

const wishlistValue = {
    items: [] as WishlistItemDto[],
    loading: false,
    error: null as string | null,
    mutationError: null as string | null,
    isWishlisted: () => false,
    isPending: () => false,
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    reload: vi.fn(),
};

vi.mock('@/hooks/useLists', () => ({ useLists: () => listsValue }));
vi.mock('@/hooks/useWishlist', () => ({ useWishlist: () => wishlistValue }));

const PC = platform(6, 'PC (Microsoft Windows)', 'PC');
const PS5 = platform(167, 'PlayStation 5', 'PS5');

const HADES_II = game({ id: 1, title: 'Hades II', releaseDate: '2026-09-18', platforms: [PC, PS5] });
const SILKSONG = game({ id: 2, title: 'Silksong', releaseDate: '2026-09-16', platforms: [PC] });
const UNRELATED = game({ id: 3, title: 'Somebody Else\'s Game', releaseDate: '2026-09-16', platforms: [PC] });

function upcoming(overrides: Partial<UseUpcomingGamesResult> = {}): UseUpcomingGamesResult {
    return { games: [HADES_II, SILKSONG, UNRELATED], loading: false, error: null, ...overrides };
}

const noneHidden = new Set<number>();

function renderRail(
    result: UseUpcomingGamesResult = upcoming(),
    hidden: ReadonlySet<number> = noneHidden,
    hiddenLoading = false,
    hiddenLoadError: string | null = null,
) {
    return render(
        <MemoryRouter>
            <ReleasingSoonRail
                upcoming={result}
                hiddenPlatformIds={hidden}
                hiddenPlatformsLoading={hiddenLoading}
                hiddenPlatformsLoadError={hiddenLoadError}
            />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    // "Today" and "Tomorrow" are the reader's own, so the clock is pinned to a known day.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 15, 12));

    listsValue.lists = { ...emptyLists(), backlog: [entry({ game: { id: HADES_II.id, title: HADES_II.title } })] };
    listsValue.loading = false;
    listsValue.error = null;
    wishlistValue.items = [{ game: SILKSONG, addedAt: '2026-01-01T00:00:00+00:00' }];
    wishlistValue.loading = false;
    wishlistValue.error = null;
});

afterEach(() => vi.useRealTimers());

describe('ReleasingSoonRail', () => {
    it("shows the user's own releases, soonest first", () => {
        renderRail();

        const rail = screen.getByRole('list', { name: 'Your games releasing soon' });
        const titles = within(rail).getAllByRole('link').map(link => link.textContent);
        expect(titles).toEqual(['Silksong', 'Hades II']);
        expect(screen.queryByText("Somebody Else's Game")).not.toBeInTheDocument();
    });

    it('says when each releases, where, and why it is here', () => {
        renderRail();

        const [silksong, hades] = screen.getAllByRole('listitem');
        expect(silksong).toHaveTextContent('Tomorrow · PC');
        expect(silksong).toHaveTextContent('On your wishlist');
        expect(hades).toHaveTextContent('Fri, Sep 18 · PC, PS5');
        expect(hades).toHaveTextContent('In your backlog');
    });

    it('applies the hidden platforms, as the calendar does', () => {
        renderRail(upcoming(), new Set([PS5.id]));

        const [, hades] = screen.getAllByRole('listitem');
        expect(hades).toHaveTextContent('Fri, Sep 18 · PC');
        expect(hades).not.toHaveTextContent('PS5');
    });

    it('is a named, focusable region because it scrolls on its own', () => {
        renderRail();

        expect(screen.getByRole('list', { name: 'Your games releasing soon' })).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('heading', { name: 'Releasing soon' })).toBeInTheDocument();
    });
});

describe('ReleasingSoonRail staying out of the way', () => {
    it('renders nothing when none of the releases are the user\'s', () => {
        wishlistValue.items = [];
        listsValue.lists = emptyLists();
        const { container } = renderRail();

        expect(container).toBeEmptyDOMElement();
    });

    it.each([
        ['the releases', () => renderRail(upcoming({ loading: true, games: [] }))],
        ['the lists', () => { listsValue.loading = true; return renderRail(); }],
        ['the wishlist', () => { wishlistValue.loading = true; return renderRail(); }],
        ['the hidden platforms', () => renderRail(upcoming(), noneHidden, true)],
    ])('renders nothing while %s are loading', (_what, renderIt) => {
        const { container } = renderIt();

        expect(container).toBeEmptyDOMElement();
    });

    it.each([
        ['the releases', () => renderRail(upcoming({ error: 'Failed to load upcoming releases (500)' }))],
        ['the lists', () => { listsValue.error = 'Failed to load lists (500)'; return renderRail(); }],
        ['the wishlist', () => { wishlistValue.error = 'Failed to load your wishlist (500)'; return renderRail(); }],
        // The empty set a failed read leaves is not "nothing hidden", and treating it as that would
        // name releases on platforms the user has hidden.
        ['the hidden platforms', () => renderRail(upcoming(), noneHidden, false, 'Failed to load hidden platforms (500)')],
    ])('renders nothing when %s failed, rather than a partial answer', (_what, renderIt) => {
        const { container } = renderIt();

        expect(container).toBeEmptyDOMElement();
    });
});
