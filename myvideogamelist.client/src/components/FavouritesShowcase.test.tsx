import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { FavouritesShowcase } from '@/components/FavouritesShowcase';
import { FavouritesContext, type FavouritesContextValue } from '@/contexts/FavouritesContext';
import type { ProfileVisibility } from '@/types/auth';
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
