import { createContext } from 'react';
import type { ProfileVisibility } from '@/types/auth';
import type { GameDto } from '@/types/game';
import type { ListId, Ownership } from '@/types/list';
import type { PlaythroughDto, PlaythroughInputDto, ReviewDto, ReviewInputDto } from '@/types/playthrough';
import type { TagDto } from '@/types/tag';
import type { TagsStatus } from '@/contexts/TagsContext';

/**
 * Where the provider's own read of the entry stands. Nothing that writes the entry is offered until it
 * is `ready`: a read that failed is not an empty entry, and a form filled from one would save over a
 * score, notes or a review the user already has.
 */
export type EntryStatus = 'loading' | 'ready' | 'failed';

/**
 * Everything the signed-in reader has recorded about one game, and every way to change it: what the
 * game page's tracking row in the hero and its Your game tab both read (ADR 0084).
 */
export interface GameEntryContextValue {
    game: GameDto;
    /** Whether the reader's profile is public, which decides what marking a review for anyone publishes. */
    profileVisibility: ProfileVisibility;

    entryStatus: EntryStatus;
    /** The entry has been read, so its fields can be written. */
    ready: boolean;
    retryEntry: () => void;
    /** A write to the entry is out — the game's lock, or a tag being made — so no other may start. */
    pending: boolean;
    /** Whether anything is recorded at all, which is when deleting it all is offered. */
    hasData: boolean;

    currentList: ListId | null;
    moveTo: (listId: ListId) => Promise<void>;
    /** Takes the game out of the list it is in. Its score and everything else stay. */
    takeOut: () => Promise<void>;
    listError: string | null;

    score: number | null;
    changeScore: (next: number | null) => Promise<void>;
    scoreError: string | null;

    wishlisted: boolean;
    wishlistPending: boolean;
    toggleWishlist: () => Promise<void>;
    wishlistError: string | null;

    favourite: boolean;
    favouritePending: boolean;
    toggleFavourite: () => Promise<void>;
    /** The favourites could not be read, so the toggle cannot be trusted until they are. */
    favouritesFailed: boolean;
    reloadFavourites: () => void;
    favouriteError: string | null;

    ownership: Ownership | null;
    changeOwnership: (next: Ownership | null) => Promise<void>;
    ownershipError: string | null;

    /** The game's tags, resolved to the account's names; an id the account's tags do not know is not drawn. */
    tags: TagDto[];
    vocabulary: TagDto[];
    tagsStatus: TagsStatus;
    reloadTags: () => void;
    addTag: (tag: TagDto) => void;
    removeTag: (tag: TagDto) => void;
    createTag: (name: string) => Promise<boolean>;
    tagsError: string | null;

    notes: string | null;
    saveNotes: (next: string | null) => Promise<void>;
    savingNotes: boolean;
    notesError: string | null;

    playthroughs: PlaythroughDto[];
    /** The run being edited, or null when the form logs a new one. */
    editing: PlaythroughDto | null;
    setEditing: (playthrough: PlaythroughDto | null) => void;
    /** Logs a new run or saves the one being edited. True once it is saved. */
    savePlaythrough: (input: PlaythroughInputDto) => Promise<boolean>;
    savingPlaythrough: boolean;
    deletePlaythrough: (playthrough: PlaythroughDto) => Promise<void>;
    deletingPlaythroughId: number | null;
    playthroughError: string | null;

    review: ReviewDto | null;
    saveReview: (input: ReviewInputDto) => Promise<void>;
    deleteReview: () => Promise<void>;
    savingReview: boolean;
    reviewError: string | null;

    /** Deletes everything recorded about the game. True once it is gone. */
    deleteAll: () => Promise<boolean>;
    deleteError: string | null;
}

export const GameEntryContext = createContext<GameEntryContextValue | null>(null);
