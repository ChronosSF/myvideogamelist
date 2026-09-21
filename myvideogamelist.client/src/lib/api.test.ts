import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, REQUEST_HEADER } from '@/lib/api';

function lastCall() {
    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = mock.mock.calls.at(-1) as [string, RequestInit];
    return { url, init, headers: new Headers(init.headers) };
}

afterEach(() => vi.unstubAllGlobals());

describe('apiFetch', () => {
    function stubFetch() {
        const mock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', mock);
        return mock;
    }

    it('marks a write as coming from this site', async () => {
        stubFetch();

        await apiFetch('/api/lists/7', { method: 'PUT' });

        // The server refuses a write without it, which is what makes a cross-site form or a
        // fetch from another origin unable to act as the signed-in user.
        expect(lastCall().headers.get(REQUEST_HEADER)).toBe('1');
    });

    it('sends the session cookie without being asked to', async () => {
        stubFetch();

        await apiFetch('/api/lists/7', { method: 'DELETE' });

        expect(lastCall().init.credentials).toBe('include');
    });

    it('leaves a read unmarked', async () => {
        stubFetch();

        await apiFetch('/api/lists');

        expect(lastCall().headers.has(REQUEST_HEADER)).toBe(false);
    });

    it('keeps the headers the caller set', async () => {
        stubFetch();

        await apiFetch('/api/entries/7/score', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: '{"score":8}',
        });

        const { headers, init } = lastCall();
        expect(headers.get('Content-Type')).toBe('application/json');
        expect(headers.get(REQUEST_HEADER)).toBe('1');
        expect(init.body).toBe('{"score":8}');
    });

    it('lets the caller override what it defaults', async () => {
        stubFetch();

        await apiFetch('/api/games/1/reviews', { credentials: 'omit' });

        // Several reads say "no credentials" deliberately, and the helper must not put them back.
        expect(lastCall().init.credentials).toBe('omit');
    });
});
