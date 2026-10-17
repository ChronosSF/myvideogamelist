import { useMemo, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAccountResource } from '@/hooks/useAccountResource';
import { apiFetch } from '@/lib/api';
import { type TagDto, sortTags } from '@/types/tag';
import { TagsContext, type TagWriteResult, type TagsStatus } from './TagsContext';

const NONE: TagDto[] = [];

/** Module-level, so it is the stable function `useAccountResource` asks for. */
async function loadTags(signal: AbortSignal): Promise<TagDto[]> {
    const res = await fetch('/api/tags', { credentials: 'include', signal });
    if (!res.ok) throw new Error(`Failed to load your tags (${res.status})`);
    return sortTags((await res.json()) as TagDto[]);
}

/**
 * The sentence the server gave for a refusal — a `ValidationProblemDetails` keyed by field for a name it
 * will not take — or the fallback for a body that says nothing useful, which is what a 500 or a proxy's
 * error page looks like.
 */
async function refusal(res: Response, fallback: string): Promise<string> {
    try {
        const problem = (await res.json()) as { title?: string; detail?: string; errors?: Record<string, string[]> };
        return Object.values(problem.errors ?? {}).flat()[0] ?? problem.detail ?? fallback;
    } catch {
        return fallback;
    }
}

function upsert(tags: TagDto[], tag: TagDto): TagDto[] {
    return sortTags([...tags.filter(t => t.id !== tag.id), tag]);
}

/**
 * The signed-in account's tags: the words its owner files games under, and how many games carry each.
 *
 * Built on `useAccountResource`, which is the account guard ADR 0022 settled on written once — the
 * account in the reducer beside the data, every completion stamped and dropped on a mismatch, and the
 * transition applied during render — rather than a fourth copy of it. Every write below lands through
 * its `patch`, which carries the account it was started under, so a create still out when somebody signs
 * out cannot put the previous account's tag in front of the next one.
 *
 * Nothing here is optimistic. A new tag has no id until the server gives it one, and a rename or a delete
 * is answered in a moment by a form that has to show a refusal beside the field — the shape the list
 * names took (ADR 0031). Which tags a *game* carries is the lists' business, under the game's lock, in
 * `ListsProvider.setTags`.
 *
 * Fetched once per sign-in, like the wishlist and the favourites: a list row carries only tag ids, and
 * every page that draws one needs the names the moment it renders.
 */
export function TagsProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const accountId = user?.id ?? null;
    const { data, error, reload, patch } = useAccountResource<TagDto[]>(accountId, 'tags', loadTags);

    const tags = data ?? NONE;
    const status: TagsStatus = accountId === null
        ? 'idle'
        : data !== null ? 'ready' : error !== null ? 'failed' : 'loading';

    const byId = useMemo(() => new Map(tags.map(tag => [tag.id, tag])), [tags]);

    const createTag = async (name: string): Promise<TagWriteResult> => {
        const failed = 'Could not create that tag. Please try again.';
        try {
            const res = await apiFetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (!res.ok) return { ok: false, error: await refusal(res, failed) };

            // 201 for a new tag, 200 for one the account already had under that name: both are the tag.
            const tag = (await res.json()) as TagDto;
            patch(current => upsert(current, tag));
            return { ok: true, tag };
        } catch {
            // Unreachable, or a body that was not the JSON it claimed to be.
            return { ok: false, error: failed };
        }
    };

    const renameTag = async (id: number, name: string): Promise<TagWriteResult> => {
        const failed = 'Could not rename that tag. Please try again.';
        try {
            const res = await apiFetch(`/api/tags/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });

            if (res.status === 404) {
                // Deleted somewhere else since this list was read. It is not coming back, so it goes.
                patch(current => current.filter(t => t.id !== id));
                return { ok: false, error: 'That tag no longer exists.' };
            }
            if (!res.ok) return { ok: false, error: await refusal(res, failed) };

            const tag = (await res.json()) as TagDto;
            patch(current => upsert(current, tag));
            return { ok: true, tag };
        } catch {
            return { ok: false, error: failed };
        }
    };

    const deleteTag = async (id: number): Promise<boolean> => {
        try {
            const res = await apiFetch(`/api/tags/${id}`, { method: 'DELETE' });

            // A 404 is a tag that was already gone, which is what the caller wanted.
            if (!res.ok && res.status !== 404) return false;

            patch(current => current.filter(t => t.id !== id));
            return true;
        } catch {
            return false;
        }
    };

    const adjustCounts = (before: readonly number[], after: readonly number[]) => {
        const gained = new Set(after.filter(id => !before.includes(id)));
        const lost = new Set(before.filter(id => !after.includes(id)));
        if (gained.size === 0 && lost.size === 0) return;

        patch(current => current.map(tag => {
            if (gained.has(tag.id)) return { ...tag, count: tag.count + 1 };
            if (lost.has(tag.id)) return { ...tag, count: Math.max(0, tag.count - 1) };
            return tag;
        }));
    };

    return (
        <TagsContext.Provider value={{
            tags,
            status,
            reload,
            tagFor: id => byId.get(id),
            byId,
            createTag,
            renameTag,
            deleteTag,
            adjustCounts,
        }}>
            {children}
        </TagsContext.Provider>
    );
}
