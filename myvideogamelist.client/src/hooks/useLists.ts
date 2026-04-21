import { useContext } from 'react';
import { ListsContext, type ListsContextValue } from '@/contexts/ListsContext';

export function useLists(): ListsContextValue {
    const ctx = useContext(ListsContext);
    if (!ctx) throw new Error('useLists must be used within ListsProvider');
    return ctx;
}
