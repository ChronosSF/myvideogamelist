import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useFavourites } from '@/hooks/useFavourites';
import { useLists } from '@/hooks/useLists';
import { useWishlist } from '@/hooks/useWishlist';
import type { GameDto, PlatformDto } from '@/types/game';
import type { ListId } from '@/types/list';

/**
 * What every view of what is coming or just out knows of a game: the home page's Coming soon and Just out,
 * and the releases of the two-week line and the calendar.
 */
export interface ReleaseGame {
    gameId: number;
    title: string;
    coverImageUrl: string | null;
    platforms: PlatformDto[];
}

export interface ReleaseGameState {
    /** Whether somebody is signed in, which is when either action is offered at all. */
    signedIn: boolean;
    /** Whether the game is one of the reader's favourites: a mark to draw, never a control here. */
    favourite: boolean;
    /** The reader's own name for the list the game is in, or null for none. */
    listName: string | null;

    wishlisted: boolean;
    /** While a change is out, and while the wishlist is unknown: a press then would write over what it cannot see. */
    wishlistPending: boolean;
    /** Puts the game on the wishlist, or takes it off. Has handled its own failure: fire with `void`. */
    toggleWishlist: () => Promise<void>;
    /** Whether the last wishlist change, made by the account signed in now, did not stick. */
    wishlistFailed: boolean;

    /** Whether to offer the Backlog: the lists have loaded, and the game is in none of them. */
    canAddToBacklog: boolean;
    /** The reader's own name for the Backlog. */
    backlogName: string;
    backlogPending: boolean;
    addToBacklog: () => void;
    /** This account asked from this card, and the game is still in no list once the request is over. */
    backlogFailed: boolean;
    /** This account put the game in the Backlog from this card, which is worth saying even where its reason says where it is. */
    addedHere: boolean;
}

/**
 * The game as the lists and the wishlist providers add one: what these views know of it, and nothing they
 * do not. The lists show the rest once they are next read.
 */
export function releaseAsGame(game: ReleaseGame): GameDto {
    return {
        id: game.gameId,
        title: game.title,
        description: null,
        // Not the release's day. For a game reaching a new platform that is not when it came out, and a
        // wrong year on the card is worse than none until the lists are next read.
        releaseDate: null,
        coverImageUrl: game.coverImageUrl,
        backgroundImageUrl: null,
        trailerUrl: null,
        website: null,
        rating: null,
        ratingCount: null,
        criticScore: null,
        criticScoreCount: null,
        esrbRating: null,
        platforms: game.platforms,
        genres: [],
        developers: [],
        publishers: [],
        details: null,
    };
}

/**
 * The reader's own side of a game wherever the site shows what is coming or just out: which of their lists
 * it is in, whether it is a favourite, and the two things to do with it there — wishlist it, which is how a
 * game seen on the home page reaches their own two weeks when its day comes (ADR 0073), and put it in the
 * Backlog. The lists' own cards offer every status; on a view of what is coming the one that fits is "I want
 * to play that". A favourite is shown here and changed on the game's page. One hook for every such view, so
 * that none of them can drift from the others.
 *
 * The Backlog is offered only for a game in no list. "Add to Backlog" on a game in one would move it, so a
 * finished game reaching a new platform would leave Finished at a click; and until the lists have loaded
 * every game looks as though it were in none, which is why nothing is offered before then. The provider
 * does the rest, as it does for every card: the optimistic change, the per-game lock, the rollback, and the
 * event the move records.
 *
 * Each failure is held as the account it happened to rather than as a flag, read off this card rather than
 * a provider's shared error, which belongs to whichever card was pressed last. The page outlives a sign-out:
 * a flag would go on telling the visitor, or the next account, that a change they never made did not stick.
 */
export function useReleaseGame(game: ReleaseGame): ReleaseGameState {
    const { user } = useAuth();
    const { isFavourite } = useFavourites();
    const lists = useLists();
    const wishlist = useWishlist();
    const [wishlistFailedFor, setWishlistFailedFor] = useState<string | null>(null);
    const [backlogAskedFor, setBacklogAskedFor] = useState<string | null>(null);

    const account = user?.id ?? null;
    const list: ListId | null = lists.getListFor(game.gameId);
    const listsKnown = !lists.loading && lists.error === null;
    const backlogPending = lists.isPending(game.gameId);
    const wishlisted = wishlist.isWishlisted(game.gameId);
    const askedHere = account !== null && backlogAskedFor === account;

    const toggleWishlist = async () => {
        setWishlistFailedFor(null);
        const saved = wishlisted ? await wishlist.remove(game.gameId) : await wishlist.add(releaseAsGame(game));
        setWishlistFailedFor(saved ? null : account);
    };

    return {
        signedIn: account !== null,
        favourite: isFavourite(game.gameId),
        listName: list === null ? null : lists.nameFor(list),

        wishlisted,
        wishlistPending: wishlist.isPending(game.gameId),
        toggleWishlist,
        wishlistFailed: account !== null && wishlistFailedFor === account,

        canAddToBacklog: account !== null && listsKnown && list === null,
        backlogName: lists.nameFor('backlog'),
        backlogPending,
        addToBacklog: () => {
            setBacklogAskedFor(account);
            void lists.addToList('backlog', releaseAsGame(game));
        },
        // Asked, no longer pending, and still in no list: the provider rolled it back.
        backlogFailed: askedHere && listsKnown && !backlogPending && list === null,
        addedHere: askedHere,
    };
}
