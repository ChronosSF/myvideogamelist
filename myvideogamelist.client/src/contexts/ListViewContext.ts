import { createContext } from 'react';
import type { ListId, ViewMode } from '@/types/list';
import type { SortState } from '@/lib/listSort';

/**
 * How the lists page draws the lists: as tiles or a table, and each list in which order. Saved on the
 * account with the rest of the list preferences, and held by `ListsProvider` beside the lists.
 *
 * A context of its own because only the lists page reads it. In `ListsContext` a change of sort handed
 * every card on every page a new context, and every card was drawn again for an order it does not show
 * (`docs/decisions/0086-*`). `setView` and `setSort` are the same functions for as long as the provider
 * is mounted; `sortFor` changes with the sorts.
 */
export interface ListViewContextValue {
    view: ViewMode;
    setView: (view: ViewMode) => void;
    sortFor: (listId: ListId) => SortState;
    setSort: (listId: ListId, sort: SortState) => void;
}

export const ListViewContext = createContext<ListViewContextValue | null>(null);
