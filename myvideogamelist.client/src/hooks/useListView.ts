import { useContext } from 'react';
import { ListViewContext, type ListViewContextValue } from '@/contexts/ListViewContext';

export function useListView(): ListViewContextValue {
    const ctx = useContext(ListViewContext);
    if (!ctx) throw new Error('useListView must be used within ListsProvider');
    return ctx;
}
