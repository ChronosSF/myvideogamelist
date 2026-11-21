import { useSearchParams } from 'react-router';
import { listFromAddress, withList } from '@/lib/listsAddress';
import type { ListId } from '@/types/list';

/**
 * The list the lists page has open, and the way to open another: the address's, not state of the
 * page's own (`@/lib/listsAddress`). A reload and a saved link come back to the list that was open,
 * and the server render draws the tab the browser will.
 *
 * A hook, and not two lines in the page, for the React Compiler's sake: what a hook returns it takes
 * as settled, where a list read by a plain function in the page's body is a value it cannot tell from
 * one a later call might change, and it then gives up on the page's memoised sort.
 */
export function useOpenList(): [ListId, (listId: ListId) => void] {
    const [searchParams, setSearchParams] = useSearchParams();
    const open = listFromAddress(searchParams);

    // A step in the history, as the game page's tabs are, so Back returns to the list before; and
    // without the jump to the top that a navigation otherwise makes.
    const openList = (listId: ListId) => {
        if (listId === open) return;
        setSearchParams(current => withList(current, listId), { preventScrollReset: true });
    };

    return [open, openList];
}
