import { useCallback } from 'react';
import { useFavourites } from '@/hooks/useFavourites';
import { useLists } from '@/hooks/useLists';
import { useTags } from '@/hooks/useTags';
import { useWishlist } from '@/hooks/useWishlist';
import { startOver, type StartOverResult } from '@/lib/startOver';

/**
 * Starts over, then has every provider holding part of the library read it again (ADR 0095).
 *
 * The lists, the wishlist, the favourites and the tags' counts are held at the root for the whole
 * session and fetched once per account. A start over keeps the account, so nothing else would tell
 * them the games had gone: the lists page, the marks on every card and the tags' counts would go on
 * showing a library that no longer exists. Read again only on success; a refused start over changed
 * nothing.
 */
export function useStartOver(): (password: string) => Promise<StartOverResult> {
    const { reload: reloadLists } = useLists();
    const { reload: reloadWishlist } = useWishlist();
    const { reload: reloadFavourites } = useFavourites();
    const { reload: reloadTags } = useTags();

    return useCallback(async (password: string) => {
        const result = await startOver(password);
        reloadLists();
        reloadWishlist();
        reloadFavourites();
        reloadTags();
        return result;
    }, [reloadLists, reloadWishlist, reloadFavourites, reloadTags]);
}
