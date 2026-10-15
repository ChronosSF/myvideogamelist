import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { FavouritesShowcase } from '@/components/FavouritesShowcase';
import { FavouritesContext, type FavouritesContextValue } from '@/contexts/FavouritesContext';
import type { ProfileVisibility } from '@/types/auth';
import type { FavouriteDto } from '@/types/favourite';
import { game } from '@/test/factories';

function favouritesValue(overrides: Partial<FavouritesContextValue> = {}): FavouritesContextValue {
    return {
        items: [],
        loading: false,
        error: null,
        mutationError: null,
        isFavourite: () => false,
        isPending: () => false,
        add: vi.fn(async () => true),
        remove: vi.fn(async () => true),
        moveInOrder: vi.fn(async () => true),
        reload: vi.fn(),
        ...overrides,
    };
}

function renderShowcase(
    overrides: Partial<FavouritesContextValue> = {},
    profileVisibility: ProfileVisibility = 'private',
) {
    const value = favouritesValue(overrides);
    render(
        <MemoryRouter>
            <FavouritesContext.Provider value={value}>
                <FavouritesShowcase profileVisibility={profileVisibility} />
            </FavouritesContext.Provider>
        </MemoryRouter>,
    );
    return value;
}

const HADES = { game: game({ id: 2, title: 'Hades', coverImageUrl: 'https://img/hades.jpg' }), addedAt: '2026-09-02T00:00:00Z' };
const CELESTE = { game: game({ id: 1, title: 'Celeste' }), addedAt: '2026-08-01T00:00:00Z' };

describe('FavouritesShowcase', () => {
    it('links each favourite to its game page, in the order the provider holds', () => {
        renderShowcase({ items: [HADES, CELESTE] });

        const rail = screen.getByRole('list', { name: 'Your favourite games' });
        const links = Array.from(rail.querySelectorAll('a'));

        expect(links.map(link => link.textContent)).toEqual(['Hades', 'Celeste']);
        expect(links[0]).toHaveAttribute('href', '/games/2');
    });

    it('counts them', () => {
        renderShowcase({ items: [HADES, CELESTE] });

        expect(screen.getByText(/2 games, most recent first/)).toBeInTheDocument();
    });

    it('says the public profile shows them when it is public', () => {
        renderShowcase({ items: [HADES] }, 'public');

        expect(screen.getByText(/your public profile shows them too/i)).toBeInTheDocument();
    });

    it('says nobody else sees them while the profile is private', () => {
        renderShowcase({ items: [HADES] }, 'private');

        expect(screen.getByText(/nobody else sees them/i)).toBeInTheDocument();
    });

    it('explains how to add one when there are none', () => {
        renderShowcase();

        expect(screen.getByText(/none yet/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Browse games' })).toHaveAttribute('href', '/games');
    });

    it('says it is loading rather than that there are none', () => {
        renderShowcase({ loading: true });

        expect(screen.getByText(/loading your favourites/i)).toBeInTheDocument();
        expect(screen.queryByText(/none yet/i)).not.toBeInTheDocument();
    });

    it('reports a failed load with a retry, rather than claiming there are none', async () => {
        const actor = userEvent.setup();
        const value = renderShowcase({ error: 'Failed to load your favourites (500)' });

        expect(screen.getByRole('alert')).toHaveTextContent('Failed to load your favourites (500)');
        expect(screen.queryByText(/none yet/i)).not.toBeInTheDocument();

        await actor.click(screen.getByRole('button', { name: 'Try again' }));
        expect(value.reload).toHaveBeenCalled();
    });
});

describe('FavouritesShowcase order', () => {
    const TUNIC = { game: game({ id: 3, title: 'Tunic' }), addedAt: '2026-07-01T00:00:00Z' };

    it('says how the row is ordered once some are placed', () => {
        renderShowcase({ items: [{ ...CELESTE, position: 0 }, HADES, TUNIC] });

        expect(screen.getByText(/3 games, the ones you placed first, then the rest most recent first/))
            .toBeInTheDocument();
    });

    it('says the row is in the order arranged once every one is placed', () => {
        renderShowcase({ items: [{ ...CELESTE, position: 0 }, { ...HADES, position: 1024 }] });

        expect(screen.getByText(/2 games, in the order you arranged them/)).toBeInTheDocument();
    });

    it('tells the owner of a public profile that it shows them in this order', () => {
        // The order is published with the favourites (ADR 0064), so the owner is told so where they
        // arrange it.
        renderShowcase({ items: [HADES, CELESTE] }, 'public');

        expect(screen.getByText(/your public profile shows them too, in the same order/i)).toBeInTheDocument();
    });

    it("marks each of the row's covers as a favourite", () => {
        // Every cover here is one — the same mark as on a card anywhere else, read from the same context.
        renderShowcase({ items: [HADES, CELESTE], isFavourite: () => true });

        const rail = screen.getByRole('list', { name: 'Your favourite games' });
        expect(within(rail).getAllByRole('link').map(link => link.textContent))
            .toEqual(['Hades, one of your favourites', 'Celeste, one of your favourites']);
    });
});

describe('FavouritesShowcase arranging', () => {
    const TUNIC = { game: game({ id: 3, title: 'Tunic' }), addedAt: '2026-07-01T00:00:00Z' };
    const ITEMS = [HADES, CELESTE, TUNIC];

    const arrange = () => userEvent.click(screen.getByRole('button', { name: 'Arrange' }));
    const grips = () => screen.queryAllByRole('button', { name: /^Move / }).map(grip => grip.getAttribute('aria-label'));

    afterEach(() => vi.restoreAllMocks());

    it('is offered only once there are two to arrange', () => {
        renderShowcase({ items: [HADES] });

        expect(screen.queryByRole('button', { name: 'Arrange' })).not.toBeInTheDocument();
    });

    it('is not offered while the favourites are unknown', () => {
        renderShowcase({ items: ITEMS, error: 'Failed to load your favourites (500)' });

        expect(screen.queryByRole('button', { name: 'Arrange' })).not.toBeInTheDocument();
    });

    it('lays the favourites out with a handle on each, in their order, and says how to use them', async () => {
        renderShowcase({ items: ITEMS });
        expect(grips()).toEqual([]);

        await arrange();

        expect(screen.getByRole('button', { name: 'Arrange' })).toHaveAttribute('aria-pressed', 'true');
        expect(grips()).toEqual(['Move Hades', 'Move Celeste', 'Move Tunic']);
        expect(screen.getByRole('button', { name: 'Move Celeste' }))
            .toHaveAccessibleDescription(/press space or enter to pick it up/i);
        expect(screen.getByText(/drag a cover by its handle/i)).toBeInTheDocument();

        // A list while it is an order, so each favourite's place is heard with it.
        const order = screen.getByRole('list', { name: 'Your favourite games' });
        expect(within(order).getAllByRole('listitem')).toHaveLength(3);
    });

    it('puts the row back when Arrange is pressed again', async () => {
        renderShowcase({ items: ITEMS });

        await arrange();
        await arrange();

        expect(screen.getByRole('button', { name: 'Arrange' })).toHaveAttribute('aria-pressed', 'false');
        expect(grips()).toEqual([]);
        expect(screen.getByText(/3 games, most recent first/)).toBeInTheDocument();
    });

    it('moves a favourite from the keyboard through the provider, after the favourite it now follows', async () => {
        const value = renderShowcase({ items: ITEMS });
        await arrange();

        screen.getByRole('button', { name: 'Move Tunic' }).focus();
        await userEvent.keyboard(' {ArrowLeft} ');

        expect(value.moveInOrder).toHaveBeenCalledExactlyOnceWith(3, 2);
    });

    it('drags a cover to a new place through the provider', async () => {
        // Covers on a fifty-pixel pitch down the page, since jsdom lays nothing out.
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            if (!this.hasAttribute('data-reorder-item')) return new DOMRect(0, 0, 800, 600);
            return new DOMRect(0, [...this.parentElement!.children].indexOf(this) * 50, 800, 40);
        });
        const value = renderShowcase({ items: ITEMS });
        await arrange();

        const grip = screen.getByRole('button', { name: 'Move Hades' });
        fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
        fireEvent.pointerMove(grip, { button: 0, pointerId: 1, clientX: 10, clientY: 30 });
        fireEvent.pointerMove(grip, { button: 0, pointerId: 1, clientX: 10, clientY: 120 });
        fireEvent.pointerUp(grip, { button: 0, pointerId: 1, clientX: 10, clientY: 120 });

        expect(value.moveInOrder).toHaveBeenCalledExactlyOnceWith(2, 3);
    });

    it('leaves the grip of a favourite whose save is out unable to move it', async () => {
        renderShowcase({ items: ITEMS, isPending: id => id === 1 });
        await arrange();

        expect(screen.getByRole('button', { name: 'Move Celeste' })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: 'Move Hades' })).not.toHaveAttribute('aria-disabled');
    });

    it('shows why a move did not happen beside the covers while they are arranged, and only then', async () => {
        // A refused or failed move has already been put back, so the covers stay; the reason is the
        // only thing a sighted user would otherwise not know.
        renderShowcase({ items: ITEMS, mutationError: 'Failed to save the order of your favourites. Please try again.' });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        await arrange();

        expect(screen.getByRole('alert')).toHaveTextContent('Failed to save the order of your favourites.');
        expect(grips()).toHaveLength(3);
    });

    it('stops arranging once there is only one favourite left, and does not start again by itself', async () => {
        const view = render(
            <MemoryRouter>
                <FavouritesContext.Provider value={favouritesValue({ items: ITEMS })}>
                    <FavouritesShowcase profileVisibility="private" />
                </FavouritesContext.Provider>
            </MemoryRouter>,
        );
        await arrange();

        const rerender = (items: FavouriteDto[]) => view.rerender(
            <MemoryRouter>
                <FavouritesContext.Provider value={favouritesValue({ items })}>
                    <FavouritesShowcase profileVisibility="private" />
                </FavouritesContext.Provider>
            </MemoryRouter>,
        );

        rerender([HADES]);
        expect(grips()).toEqual([]);

        rerender(ITEMS);
        expect(screen.getByRole('button', { name: 'Arrange' })).toHaveAttribute('aria-pressed', 'false');
        expect(grips()).toEqual([]);
    });
});
