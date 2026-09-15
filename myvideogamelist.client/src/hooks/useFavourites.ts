import { useContext } from 'react';
import { FavouritesContext, type FavouritesContextValue } from '@/contexts/FavouritesContext';

export function useFavourites(): FavouritesContextValue {
    const ctx = useContext(FavouritesContext);
    if (!ctx) throw new Error('useFavourites must be used within FavouritesProvider');
    return ctx;
}
