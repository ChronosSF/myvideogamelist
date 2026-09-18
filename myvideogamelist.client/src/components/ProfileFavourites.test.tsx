import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ProfileFavourites } from '@/components/ProfileFavourites';
import type { PublicFavourites } from '@/types/profile';

const FAVOURITES: PublicFavourites = {
    userName: 'alex',
    games: [
        { id: 2, name: 'Hades', coverImageUrl: null },
        { id: 1, name: 'Celeste', coverImageUrl: null },
    ],
};

function renderSection(count: number, favourites: PublicFavourites | null) {
    return render(
        <MemoryRouter>
            <ProfileFavourites userName="alex" count={count} favourites={favourites} />
        </MemoryRouter>,
    );
}

describe('ProfileFavourites', () => {
    it('shows their favourites as links to each game, in the order the API sent', () => {
        renderSection(2, FAVOURITES);

        const rail = screen.getByRole('list', { name: "alex's favourite games" });
        expect(Array.from(rail.querySelectorAll('a')).map(a => a.getAttribute('href')))
            .toEqual(['/games/2', '/games/1']);
    });

    it('shows nothing at all for somebody with no favourites', () => {
        const { container } = renderSection(0, { userName: 'alex', games: [] });

        expect(container).toBeEmptyDOMElement();
    });

    it('says the favourites could not be loaded rather than hiding that there are some', () => {
        // The count comes from the profile, which needs no IGDB; the covers do, and failed.
        renderSection(3, null);

        expect(screen.getByRole('heading', { name: 'Favourites' })).toBeInTheDocument();
        expect(screen.getByText('alex has 3 favourites, but they could not be loaded just now.'))
            .toBeInTheDocument();
    });

    it('says the same when the request answered with none of them', () => {
        // Not only an outage: a row whose game IGDB can no longer resolve is left out of the answer
        // and still counted on the profile, so the heading would otherwise stand over nothing.
        renderSection(1, { userName: 'alex', games: [] });

        expect(screen.getByText('alex has 1 favourite, but it could not be loaded just now.'))
            .toBeInTheDocument();
    });
});
