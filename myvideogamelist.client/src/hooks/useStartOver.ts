import { useCallback, useContext } from 'react';
import { useFavourites } from '@/hooks/useFavourites';
import { useLists } from '@/hooks/useLists';
import { useTags } from '@/hooks/useTags';
import { useWishlist } from '@/hooks/useWishlist';
import { PlaythroughPromptContext } from '@/contexts/PlaythroughPromptContext';
import { startOver, StartOverUncertainError, type StartOverResult } from '@/lib/startOver';

/**
 * Starts over, then has every provider holding part of the library read it again (ADR 0095).
 *
 * The lists, the wishlist, the favourites and the tags' counts are held at the root for the whole
 * session and fetched once per account. A start over keeps the account, so nothing else would tell
 * them the games had gone: the lists page, the marks on every card and the tags' counts would go on
 * showing a library that no longer exists. Read again on success, and when no answer arrived, since
 * the library may be gone then too; a refused start over changed nothing. The playthrough toast is
 * cleared at the same moments, since what it asks or reports is about a game that may be gone (ADR 0097).
 */
export function useStartOver(): (password: string) => Promise<StartOverResult> {
    const { reload: reloadLists } = useLists();
    const { reload: reloadWishlist } = useWishlist();
    const { reload: reloadFavourites } = useFavourites();
    const { reload: reloadTags } = useTags();
    const { clear: clearPrompt } = useContext(PlaythroughPromptContext);

    return useCallback(async (password: string) => {
        const readAgain = () => {
            reloadLists();
            reloadWishlist();
            reloadFavourites();
            reloadTags();
            clearPrompt();
        };

        let result: StartOverResult;
        try {
            result = await startOver(password);
        } catch (error) {
            if (error instanceof StartOverUncertainError) readAgain();
            throw error;
        }

        readAgain();
        return result;
    }, [reloadLists, reloadWishlist, reloadFavourites, reloadTags, clearPrompt]);
}
