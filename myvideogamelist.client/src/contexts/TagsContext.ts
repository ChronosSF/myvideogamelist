import { createContext } from 'react';
import type { TagDto } from '@/types/tag';

/**
 * Where the account's tags stand. `idle` is nobody signed in; `failed` is a read that did not arrive,
 * which is not the same as an account with no tags — an editor offered over it would let somebody
 * "create" tags they already have, and show none of a game's.
 */
export type TagsStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * How a write to one tag ended: the tag as it now stands, or the sentence to show beside the name — with
 * `gone` when the tag was deleted somewhere else, so there is no longer a row to show it beside.
 */
export type TagWriteResult = { ok: true; tag: TagDto } | { ok: false; error: string; gone?: boolean };

export interface TagsContextValue {
    /** The account's tags, in name order. Empty until they arrive, and for nobody signed in. */
    tags: TagDto[];
    status: TagsStatus;
    /** Asks again, keeping what is shown until the answer lands. */
    reload: () => void;
    tagFor: (id: number) => TagDto | undefined;
    /** Lookup by id, for resolving the ids a list row carries. Stable until the tags change. */
    byId: ReadonlyMap<number, TagDto>;
    /**
     * Makes a tag, or finds the one the account already has under that name in any letter case — so a
     * create pressed twice, or sent with an out-of-date list, is an answer rather than an error. Not
     * optimistic: the tag has no id until the server gives it one.
     */
    createTag: (name: string) => Promise<TagWriteResult>;
    /** Renames a tag; every game it is on keeps it. Refused beside the field for another tag's name. */
    renameTag: (id: number, name: string) => Promise<TagWriteResult>;
    /** Deletes a tag and takes it off every game. False when the delete did not happen. */
    deleteTag: (id: number) => Promise<boolean>;
    /**
     * Moves the counts by one game's change of tags, once the server has stored it: up for each tag the
     * game gained, down for each it lost. The counts are the server's, but no read of them is worth a
     * request after every change on the panel.
     */
    adjustCounts: (before: readonly number[], after: readonly number[]) => void;
}

export const TagsContext = createContext<TagsContextValue | null>(null);
