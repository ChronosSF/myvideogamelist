import type { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/AuthProvider';
import { ListsProvider } from '@/contexts/ListsProvider';
import { WishlistProvider } from '@/contexts/WishlistProvider';
import { FavouritesProvider } from '@/contexts/FavouritesProvider';

/**
 * The providers `root.tsx` puts around every page, in the same order, and nothing mocked.
 *
 * They read the API for themselves, through whatever `stubApi` answers: `/api/auth/me` always, and
 * once it names an account `/api/lists`, `/api/user/list-preferences`, `/api/wishlist` and
 * `/api/favourites` as well — `signedInRoutes` in `@/test/api` answers all five. A route left out
 * is a 404, which a provider takes for a failed load, so it shows up far from its cause: as a
 * control that never enables.
 *
 * For a test about what a page does with the app's own state — an optimistic move and its rollback,
 * the request a click sends — where a hand-built context would assert against a provider nobody
 * ships. It also cannot fall behind the contexts' types, which a hand-built value has to be
 * edited to follow. Keep it in step with `Root`.
 */
export function AppProviders({ children }: { children: ReactNode }) {
    return (
        <AuthProvider>
            <ListsProvider>
                <WishlistProvider>
                    <FavouritesProvider>
                        {children}
                    </FavouritesProvider>
                </WishlistProvider>
            </ListsProvider>
        </AuthProvider>
    );
}
