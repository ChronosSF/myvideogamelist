import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useListTagFilter } from '@/hooks/useListTagFilter';
import { TagsContext, type TagsContextValue } from '@/contexts/TagsContext';
import { emptyLists, type ListEntryDto, type ListId } from '@/types/list';
import type { TagDto } from '@/types/tag';
import { entry, tag } from '@/test/factories';

const COOP = tag({ id: 1, name: 'Co-op' });
const SHORT = tag({ id: 2, name: 'short' });
const UNUSED = tag({ id: 3, name: 'someday' });

const BOTH = entry({ game: { id: 10, title: 'Both' }, tagIds: [2, 1] });
const COOP_ONLY = entry({ game: { id: 11, title: 'Co-op only' }, tagIds: [1] });
const NONE = entry({ game: { id: 12, title: 'None' } });

function tagsValue(tags: TagDto[]): TagsContextValue {
    const byId = new Map(tags.map(t => [t.id, t]));
    return {
        tags,
        status: 'ready',
        reload: vi.fn(),
        tagFor: id => byId.get(id),
        byId,
        createTag: vi.fn(async () => ({ ok: false as const, error: 'unused' })),
        renameTag: vi.fn(async () => ({ ok: false as const, error: 'unused' })),
        deleteTag: vi.fn(async () => true),
        adjustCounts: vi.fn(),
    };
}

interface Props {
    lists: Record<ListId, ListEntryDto[]>;
    account: string | null;
    tags: TagsContextValue;
}

/** The hook reads the tags from context, so the wrapper has to follow the props. */
function renderWithTags(initial: Props) {
    let current = initial;
    const view = renderHook((props: Props) => useListTagFilter(props.lists, props.account), {
        initialProps: initial,
        wrapper: ({ children }: { children: ReactNode }) => (
            <TagsContext.Provider value={current.tags}>{children}</TagsContext.Provider>
        ),
    });
    return {
        ...view,
        rerenderWith: (next: Props) => {
            current = next;
            view.rerender(next);
        },
    };
}

const LISTS = { ...emptyLists(), playing: [BOTH, NONE], finished: [COOP_ONLY] };
const TAGS = tagsValue([COOP, SHORT, UNUSED]);

describe('useListTagFilter', () => {
    it('offers the account’s tags some game in any list carries, in name order', () => {
        const { result } = renderWithTags({ lists: LISTS, account: 'u1', tags: TAGS });

        expect(result.current.offered.map(t => t.name)).toEqual(['Co-op', 'short']);
    });

    it('lets everything through while nothing is ticked', () => {
        const { result } = renderWithTags({ lists: LISTS, account: 'u1', tags: TAGS });

        expect([BOTH, COOP_ONLY, NONE].filter(result.current.matches)).toEqual([BOTH, COOP_ONLY, NONE]);
    });

    it('lets through only the games carrying every tag ticked', () => {
        const { result } = renderWithTags({ lists: LISTS, account: 'u1', tags: TAGS });

        act(() => result.current.setSelected([1]));
        expect([BOTH, COOP_ONLY, NONE].filter(result.current.matches)).toEqual([BOTH, COOP_ONLY]);

        act(() => result.current.setSelected([1, 2]));
        expect([BOTH, COOP_ONLY, NONE].filter(result.current.matches)).toEqual([BOTH]);
    });

    it('never filters the next account’s lists by the previous account’s ticks', () => {
        // Tag ids are one account's. Signing somebody else in on this page must not narrow their lists
        // by ids that mean nothing to them — and must not wait an effect to stop doing it.
        const view = renderWithTags({ lists: LISTS, account: 'u1', tags: TAGS });
        act(() => view.result.current.setSelected([1]));

        view.rerenderWith({ lists: LISTS, account: 'u2', tags: TAGS });

        expect(view.result.current.selected).toEqual([]);
        expect([NONE].filter(view.result.current.matches)).toEqual([NONE]);
    });

    it('stops narrowing by a tag that is no longer offered', () => {
        // Deleted, or taken off its last game: a tick nobody can see must not hide every game.
        const view = renderWithTags({ lists: LISTS, account: 'u1', tags: TAGS });
        act(() => view.result.current.setSelected([2]));
        expect(view.result.current.selected).toEqual([2]);

        view.rerenderWith({ lists: LISTS, account: 'u1', tags: tagsValue([COOP, UNUSED]) });

        expect(view.result.current.selected).toEqual([]);
        expect([NONE].filter(view.result.current.matches)).toEqual([NONE]);
    });

    it('resolves a row’s tags for its chips, and counts the rows carrying one', () => {
        const { result } = renderWithTags({ lists: LISTS, account: 'u1', tags: TAGS });

        expect(result.current.tagsOf(BOTH).map(t => t.name)).toEqual(['Co-op', 'short']);
        expect(result.current.countIn([BOTH, COOP_ONLY, NONE], 1)).toBe(2);
    });
});
