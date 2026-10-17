import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagsProvider } from '@/contexts/TagsProvider';
import { useTags } from '@/hooks/useTags';
import { REQUEST_HEADER } from '@/lib/api';
import type { TagDto } from '@/types/tag';
import { tag } from '@/test/factories';

const ALICE = { id: 'u1', email: 'alice@test.local' };
const BOB = { id: 'u2', email: 'bob@test.local' };

// One module-level object handed back on every call, never a fresh literal: a new object per render
// would re-run anything depending on it. `user` is reassigned by the session tests on purpose.
const auth = {
    user: ALICE as typeof ALICE | null,
    loading: false,
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

interface Recorded {
    method: string;
    url: string;
    body: unknown;
    headers: Headers;
}

type Answer = Response | Promise<Response> | 'reject';

/**
 * The tags API. `GET /api/tags` answers with the account's tags, keyed by whose cookie it is; every
 * write is answered by `writes`, keyed by method and URL, or a 204.
 */
function stubFetch(options: {
    tags?: Record<string, TagDto[]> | 'fail';
    writes?: Record<string, () => Answer>;
} = {}) {
    const calls: Recorded[] = [];

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({
            method,
            url,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
            headers: new Headers(init?.headers),
        });

        if (method === 'GET' && url === '/api/tags') {
            if (options.tags === 'fail') return Promise.resolve(new Response('nope', { status: 500 }));
            const mine = options.tags?.[auth.user?.id ?? ''] ?? [];
            return Promise.resolve(new Response(JSON.stringify(mine), { status: 200 }));
        }

        const answer = options.writes?.[`${method} ${url}`]?.();
        if (answer === 'reject') return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve(answer ?? new Response(null, { status: 204 }));
    }));

    return calls;
}

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status });
}

/** Surfaces the context as text, and its writes as buttons whose result lands in `result`. */
function Probe() {
    const tags = useTags();
    const [result, setResult] = useState('');

    return (
        <div>
            <span data-testid="status">{tags.status}</span>
            <span data-testid="tags">{tags.tags.map(t => `${t.name}(${t.count})`).join(',')}</span>
            <span data-testid="result">{result}</span>
            <span data-testid="lookup">{tags.tagFor(2)?.name ?? '-'}</span>
            <button onClick={() => void tags.createTag('Couch co-op').then(r => setResult(JSON.stringify(r)))}>create</button>
            <button onClick={() => void tags.renameTag(2, 'Shorter').then(r => setResult(JSON.stringify(r)))}>rename</button>
            <button onClick={() => void tags.deleteTag(2).then(ok => setResult(String(ok)))}>delete</button>
            <button onClick={() => tags.adjustCounts([1], [2])}>move a game from 1 to 2</button>
            <button onClick={() => tags.reload()}>reload</button>
        </div>
    );
}

const SHORT = tag({ id: 2, name: 'short', count: 3 });
const COOP = tag({ id: 1, name: 'Co-op', count: 1 });

async function mount(options: Parameters<typeof stubFetch>[0] = {}) {
    const calls = stubFetch(options);
    const view = render(<TagsProvider><Probe /></TagsProvider>);
    await waitFor(() => expect(screen.getByTestId('status')).not.toHaveTextContent('loading'));
    return { calls, view };
}

const press = (name: string) => userEvent.click(screen.getByRole('button', { name }));
const shown = () => screen.getByTestId('tags');
const result = () => screen.getByTestId('result');

beforeEach(() => {
    vi.unstubAllGlobals();
    auth.user = ALICE;
});

describe('TagsProvider reading', () => {
    it("loads the signed-in account's tags in name order", async () => {
        await mount({ tags: { u1: [SHORT, COOP] } });

        expect(screen.getByTestId('status')).toHaveTextContent('ready');
        expect(shown()).toHaveTextContent('Co-op(1),short(3)');
        expect(screen.getByTestId('lookup')).toHaveTextContent('short');
    });

    it('asks for nothing while nobody is signed in', async () => {
        auth.user = null;
        const calls = stubFetch({ tags: { u1: [SHORT] } });

        render(<TagsProvider><Probe /></TagsProvider>);

        expect(screen.getByTestId('status')).toHaveTextContent('idle');
        expect(calls).toHaveLength(0);
    });

    it('says the tags did not arrive, rather than that there are none, and asks again on reload', async () => {
        const options: Parameters<typeof stubFetch>[0] = { tags: 'fail' };
        await mount(options);
        expect(screen.getByTestId('status')).toHaveTextContent('failed');

        options.tags = { u1: [SHORT] };
        stubFetch(options);
        await press('reload');

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
        expect(shown()).toHaveTextContent('short(3)');
    });
});

describe('TagsProvider writing', () => {
    it('creates a tag through the write guard and adds it in name order', async () => {
        const { calls } = await mount({
            tags: { u1: [SHORT] },
            writes: { 'POST /api/tags': () => json(tag({ id: 7, name: 'Couch co-op' }), 201) },
        });

        await press('create');

        await waitFor(() => expect(shown()).toHaveTextContent('Couch co-op(0),short(3)'));
        const post = calls.find(c => c.method === 'POST');
        expect(post?.body).toEqual({ name: 'Couch co-op' });
        expect(post?.headers.get(REQUEST_HEADER)).toBe('1');
        expect(JSON.parse(result().textContent ?? '')).toEqual({ ok: true, tag: tag({ id: 7, name: 'Couch co-op' }) });
    });

    it('takes a 200 for a name the account already had as that tag, not a second one', async () => {
        await mount({
            tags: { u1: [tag({ id: 7, name: 'Couch co-op', count: 4 })] },
            writes: { 'POST /api/tags': () => json(tag({ id: 7, name: 'Couch co-op', count: 4 })) },
        });

        await press('create');

        await waitFor(() => expect(result()).toHaveTextContent('"ok":true'));
        expect(shown()).toHaveTextContent(/^Couch co-op\(4\)$/);
    });

    it('hands back the sentence the server gave for a refused name', async () => {
        await mount({
            tags: { u1: [] },
            writes: {
                'POST /api/tags': () => json({
                    title: 'One or more validation errors occurred.',
                    errors: { Name: ['You have 200 tags, which is as many as an account can hold.'] },
                }, 400),
            },
        });

        await press('create');

        await waitFor(() => expect(result()).toHaveTextContent('as many as an account can hold'));
        expect(shown()).toBeEmptyDOMElement();
    });

    it('reports a request that never arrives as a failure, adding nothing', async () => {
        await mount({ tags: { u1: [] }, writes: { 'POST /api/tags': () => 'reject' } });

        await press('create');

        await waitFor(() => expect(result()).toHaveTextContent('Could not create that tag'));
        expect(shown()).toBeEmptyDOMElement();
    });

    it('renames in place and moves the tag to where its new name sorts', async () => {
        // The server answers with the name it stored, which here sorts before the others.
        const { calls } = await mount({
            tags: { u1: [COOP, SHORT] },
            writes: { 'PUT /api/tags/2': () => json(tag({ id: 2, name: 'Arcade', count: 3 })) },
        });

        await press('rename');

        await waitFor(() => expect(shown()).toHaveTextContent('Arcade(3),Co-op(1)'));
        expect(calls.find(c => c.method === 'PUT')?.body).toEqual({ name: 'Shorter' });
    });

    it('hands back the problem detail when the refusal names no field', async () => {
        await mount({
            tags: { u1: [COOP, SHORT] },
            writes: { 'PUT /api/tags/2': () => json({ title: 'Conflict', detail: 'Somebody else got there first.' }, 409) },
        });

        await press('rename');

        await waitFor(() => expect(result()).toHaveTextContent('Somebody else got there first.'));
    });

    it('drops a tag a rename finds gone, and says so', async () => {
        await mount({
            tags: { u1: [COOP, SHORT] },
            writes: { 'PUT /api/tags/2': () => new Response(null, { status: 404 }) },
        });

        await press('rename');

        await waitFor(() => expect(result()).toHaveTextContent('That tag no longer exists.'));
        expect(shown()).toHaveTextContent(/^Co-op\(1\)$/);
    });

    it('keeps the old name and hands back the refusal when the name is taken', async () => {
        await mount({
            tags: { u1: [COOP, SHORT] },
            writes: {
                'PUT /api/tags/2': () => json({ errors: { Name: ['You already have a tag called "Co-op".'] } }, 400),
            },
        });

        await press('rename');

        await waitFor(() => expect(result()).toHaveTextContent('You already have a tag called'));
        expect(shown()).toHaveTextContent('Co-op(1),short(3)');
    });

    it('deletes, taking a 404 as the tag already gone', async () => {
        await mount({ tags: { u1: [COOP, SHORT] }, writes: { 'DELETE /api/tags/2': () => new Response(null, { status: 404 }) } });

        await press('delete');

        await waitFor(() => expect(result()).toHaveTextContent('true'));
        expect(shown()).toHaveTextContent(/^Co-op\(1\)$/);
    });

    it('keeps the tag when a delete never arrives', async () => {
        await mount({ tags: { u1: [COOP, SHORT] }, writes: { 'DELETE /api/tags/2': () => 'reject' } });

        await press('delete');

        await waitFor(() => expect(result()).toHaveTextContent('false'));
        expect(shown()).toHaveTextContent('Co-op(1),short(3)');
    });

    it('keeps the tag when a delete fails', async () => {
        await mount({ tags: { u1: [COOP, SHORT] }, writes: { 'DELETE /api/tags/2': () => new Response('nope', { status: 500 }) } });

        await press('delete');

        await waitFor(() => expect(result()).toHaveTextContent('false'));
        expect(shown()).toHaveTextContent('Co-op(1),short(3)');
    });

    it('moves the counts by one game’s change of tags', async () => {
        await mount({ tags: { u1: [COOP, SHORT] } });

        await press('move a game from 1 to 2');

        expect(shown()).toHaveTextContent('Co-op(0),short(4)');
    });

    it('never counts below none', async () => {
        // A count that was already out of date — another tab's change — must not go negative.
        await mount({ tags: { u1: [tag({ id: 1, name: 'Co-op', count: 0 }), SHORT] } });

        await press('move a game from 1 to 2');

        expect(shown()).toHaveTextContent('Co-op(0),short(4)');
    });

    it('asks again when a write landed while a read was out, rather than losing the write', async () => {
        // The read's answer was composed before the tag was made, and replaces what is held: without
        // another read the new tag would vanish until the next page load.
        const held: { release?: () => void } = {};
        let tagsOnServer: TagDto[] = [SHORT];
        const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            calls.push(`${method} ${url}`);
            if (method === 'GET') {
                const answer = new Response(JSON.stringify(tagsOnServer), { status: 200 });
                // The second read is held: the stale answer from before the create.
                if (calls.filter(c => c === 'GET /api/tags').length === 2) {
                    return new Promise<Response>(resolve => { held.release = () => resolve(answer); });
                }
                return Promise.resolve(answer);
            }
            tagsOnServer = [tag({ id: 7, name: 'Couch co-op' }), SHORT];
            return Promise.resolve(json(tag({ id: 7, name: 'Couch co-op' }), 201));
        }));
        render(<TagsProvider><Probe /></TagsProvider>);
        await waitFor(() => expect(shown()).toHaveTextContent('short(3)'));

        await press('reload');
        await press('create');
        await waitFor(() => expect(shown()).toHaveTextContent('Couch co-op(0),short(3)'));

        await act(async () => { held.release?.(); });

        await waitFor(() => expect(calls.filter(c => c === 'GET /api/tags')).toHaveLength(3));
        await waitFor(() => expect(shown()).toHaveTextContent('Couch co-op(0),short(3)'));
    });
});

describe('TagsProvider across a session change', () => {
    it("shows the next account its own tags and nothing of the previous one's", async () => {
        const { view } = await mount({ tags: { u1: [SHORT], u2: [COOP] } });
        expect(shown()).toHaveTextContent('short(3)');

        auth.user = BOB;
        view.rerender(<TagsProvider><Probe /></TagsProvider>);

        await waitFor(() => expect(shown()).toHaveTextContent(/^Co-op\(1\)$/));
    });

    it('does not put a tag created by the previous account in front of the next one', async () => {
        // The create is still out when the account changes. Its answer is the previous account's tag,
        // and the provider's patch carries the account it was started under, so it is dropped.
        let answer!: (response: Response) => void;
        const { view } = await mount({
            tags: { u1: [], u2: [] },
            writes: { 'POST /api/tags': () => new Promise<Response>(resolve => { answer = resolve; }) },
        });

        await press('create');

        auth.user = BOB;
        view.rerender(<TagsProvider><Probe /></TagsProvider>);
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

        await act(async () => {
            answer(json(tag({ id: 7, name: 'Couch co-op' }), 201));
        });

        expect(shown()).toBeEmptyDOMElement();
    });
});
