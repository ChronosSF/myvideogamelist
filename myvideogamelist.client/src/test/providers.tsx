import type { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/AuthProvider';
import { ListsProvider } from '@/contexts/ListsProvider';
import { WishlistProvider } from '@/contexts/WishlistProvider';
import { FavouritesProvider } from '@/contexts/FavouritesProvider';

/**
 * The providers `root.tsx` puts around every page, in the same order, and nothing mocked: the
 * account comes from `/api/auth/me`, and the lists, the wishlist and the favourites from their own
 * endpoints, all answered by `stubApi`.
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
