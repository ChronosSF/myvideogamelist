import { useCallback, useMemo, useState } from 'react';
import { useTags } from '@/hooks/useTags';
import { type ListEntryDto, type ListId, LIST_IDS } from '@/types/list';
import { type TagDto, tagsFor } from '@/types/tag';

export interface ListTagFilter {
    /** The account's tags that at least one game in the lists carries, in name order. */
    offered: TagDto[];
    /** The ticked tags still offered. A game is shown when it carries every one of them. */
    selected: number[];
    /**
     * Whether the tag filter narrows anything — what a page asks when it needs to know if any filter is on,
     * as a hand-arranged order does before letting games be moved among ones it hides.
     */
    active: boolean;
    setSelected: (ids: number[]) => void;
    /** Whether a row passes the tag filter. Every row does while nothing is ticked. */
    matches: (entry: ListEntryDto) => boolean;
    /** A row's tags, resolved and in name order, for its chips. */
    tagsOf: (entry: ListEntryDto) => TagDto[];
    /** How many rows of `entries` carry each offered tag. */
    countIn: (entries: readonly ListEntryDto[], tagId: number) => number;
}

interface Ticks {
    /** Whose ticks these are. Tag ids are the account's own, so another account's mean nothing. */
    account: string | null;
    ids: number[];
}

/**
 * The lists page's filter by tag: what it offers, what is ticked, and what that lets through.
 *
 * Client-side, as the platform filter is — the lists are already loaded whole (ADR 0020) — and transient
 * like it: nothing is saved, because a filter still applied on the next visit is how people conclude
 * their games have vanished.
 *
 * Ticked tags combine: a game is shown when it carries **every** one of them, where the platforms let a
 * game through on any. A platform is an alternative — a game is on PS5 or Switch — and a tag is a facet
 * of the game itself, "co-op" and "short" being a question about one game.
 *
 * The ticks carry the account they were made under, and count only while it is the one on screen: a tag
 * id is one account's, so a sign-in on this page must never filter the next account's lists by the
 * previous account's choices — derived here at render, with no effect and no frame in between. They also
 * count only while their tag is still offered, so a tag deleted, or taken off its last game, stops
 * narrowing rather than leaving an invisible filter that matches nothing.
 */
export function useListTagFilter(
    lists: Record<ListId, ListEntryDto[]>,
    accountId: string | null,
): ListTagFilter {
    const { tags, byId } = useTags();
    const [ticks, setTicks] = useState<Ticks>({ account: null, ids: [] });

    const offered = useMemo(() => {
        const present = new Set<number>();
        for (const id of LIST_IDS) {
            for (const entry of lists[id]) {
                for (const tagId of entry.tagIds) present.add(tagId);
            }
        }
        return tags.filter(tag => present.has(tag.id));
    }, [lists, tags]);

    const selected = useMemo(
        () => (ticks.account === accountId
            ? ticks.ids.filter(id => offered.some(tag => tag.id === id))
            : []),
        [ticks, accountId, offered],
    );

    // Stable while what they read is, so a page can memoise what it filters with them.
    const matches = useCallback(
        (entry: ListEntryDto) => selected.every(id => entry.tagIds.includes(id)),
        [selected],
    );
    const tagsOf = useCallback((entry: ListEntryDto) => tagsFor(entry.tagIds, byId), [byId]);

    return {
        offered,
        selected,
        active: selected.length > 0,
        setSelected: ids => setTicks({ account: accountId, ids }),
        matches,
        tagsOf,
        countIn: (entries, tagId) => entries.filter(entry => entry.tagIds.includes(tagId)).length,
    };
}
