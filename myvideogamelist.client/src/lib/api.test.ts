import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNSAFE_ErrorResponseImpl } from 'react-router';
import { RATE_LIMITED, REQUEST_HEADER, apiFetch, bodyOf, isRateLimited, problemMessage, refusedWith } from '@/lib/api';

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

describe("the edge's 429", () => {
    // The rate rule in front of the distribution answers with a page of its own (ADR 0098).
    const page = () => new Response('<!doctype html><h1>Too many requests</h1>', {
        status: 429,
        headers: { 'content-type': 'text/html' },
    });

    it("reads as a ProblemDetails carrying the site's own sentence", async () => {
        expect(await bodyOf(page())).toEqual({ title: 'Too many requests', detail: RATE_LIMITED });
    });

    it("is what a write's refusal says, in place of its generic fallback", async () => {
        expect(await problemMessage(page(), 'Failed to save your look')).toBe(RATE_LIMITED);
    });

    it("leaves the API's own 429 its own sentence", async () => {
        // The login limiter's, which is a ProblemDetails (ADR 0033).
        const limiter = new Response(JSON.stringify({ title: 'Too Many Requests', detail: 'Too many attempts.' }), { status: 429 });

        expect(await problemMessage(limiter, 'Login failed')).toBe('Too many attempts.');
    });

    it('is nothing to any other status whose body is not JSON', async () => {
        expect(await bodyOf(new Response('<html>Bad gateway</html>', { status: 502 }))).toBeNull();
    });

    it("is told apart from a page's other failures", () => {
        expect(isRateLimited(new UNSAFE_ErrorResponseImpl(429, '', '<!doctype html>'))).toBe(true);
        expect(isRateLimited(new UNSAFE_ErrorResponseImpl(503, 'Service Unavailable', 'busy'))).toBe(false);
        expect(isRateLimited(new Error('429'))).toBe(false);
    });

    it("is what a write with a fixed sentence says, in place of that sentence", () => {
        expect(refusedWith(page(), 'Failed to update list. Please try again.')).toBe(RATE_LIMITED);
        expect(refusedWith(new Response(null, { status: 500 }), 'Failed to update list. Please try again.'))
            .toBe('Failed to update list. Please try again.');
        expect(refusedWith(null, 'Failed to update list. Please try again.')).toBe('Failed to update list. Please try again.');
    });
});
