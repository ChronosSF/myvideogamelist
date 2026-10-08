import { useState } from 'react';
import { useLists } from '@/hooks/useLists';
import type { GameDto } from '@/types/game';
import type { ConnectedRelease } from '@/types/releases';

/**
 * The release as the lists provider adds a game: what the line and the calendar know of it, and nothing
 * they do not. The Backlog's card shows the rest once the lists are next read.
 */
export function releaseAsGame(release: ConnectedRelease): GameDto {
    return {
        id: release.gameId,
        title: release.title,
        description: null,
        // Not the release's day. For a game reaching a new platform that is not when it came out, and a
        // wrong year on the card is worse than none until the lists are next read.
        releaseDate: null,
        coverImageUrl: release.coverImageUrl,
        backgroundImageUrl: null,
        trailerUrl: null,
        website: null,
        rating: null,
        ratingCount: null,
        criticScore: null,
        criticScoreCount: null,
        esrbRating: null,
        platforms: release.platforms,
        genres: [],
        developers: [],
        publishers: [],
        details: null,
    };
}

export interface AddToBacklog {
    /** Whether to offer the button: the lists have loaded, and the game is in none of them. */
    canAdd: boolean;
    pending: boolean;
    /** This card asked, and the game is still in no list once the request is over. */
    failed: boolean;
    /** The user's name for the list the game is in, when the card should say so. */
    listedIn: string | null;
    /** The user's name for the Backlog. */
    backlog: string;
    add: () => void;
}

/**
 * The one thing the line and the calendar let somebody do with a release: put it in the Backlog. The
 * lists' own cards offer every status, and on a view of what is coming the only one that fits is "I
 * want to play that".
 *
 * Only for a game in no list. "Add to Backlog" on a game that is in one would move it, so a finished
 * game reaching a new platform would leave Finished at a click — and until the lists have loaded every
 * game looks as though it were in none, which is why nothing is offered before then.
 *
 * The provider does the rest, as it does for every card: the optimistic change, the per-game lock, the
 * rollback, and the event the move records.
 */
export function useAddToBacklog(release: ConnectedRelease): AddToBacklog {
    const { loading, error, getListFor, addToList, isPending, nameFor } = useLists();

    // This card asked. A failed add is rolled back by the provider, and its error is shared by every
    // card on the page, so whether this one's request was the one that failed is read off the game:
    // asked, no longer pending, and still in no list.
    const [asked, setAsked] = useState(false);

    const known = !loading && error === null;
    const list = known ? getListFor(release.gameId) : null;
    const pending = isPending(release.gameId);

    return {
        canAdd: known && list === null,
        pending,
        failed: asked && known && !pending && list === null,
        // Said once the game is in a list — except of the game itself, whose reason already says where
        // it is ("You finished it"), unless it got there from this card.
        listedIn: list !== null && (asked || release.reason.relation !== 'itself') ? nameFor(list) : null,
        backlog: nameFor('backlog'),
        add: () => {
            setAsked(true);
            void addToList('backlog', releaseAsGame(release));
        },
    };
}
