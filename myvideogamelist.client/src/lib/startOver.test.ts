import { afterEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_HEADER } from '@/lib/api';
import { startOver, startOverSummary, type StartOverResult } from '@/lib/startOver';

afterEach(() => {
    vi.unstubAllGlobals();
});

function answering(response: Response | Error) {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        if (response instanceof Error) throw response;
        return response;
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
}

const nothing: StartOverResult = { games: 0, wishlist: 0, favourites: 0, events: 0, importRowsReselected: 0 };

describe('startOver', () => {
    it('sends the password as a write, with the header every write carries', async () => {
        const counts: StartOverResult = { ...nothing, games: 3, events: 5 };
        const fetch = answering(Response.json(counts));

        expect(await startOver('hunter2')).toEqual(counts);

        const [url, init] = fetch.mock.calls[0];
        expect(String(url)).toMatch(/\/api\/user\/library$/);
        expect(init?.method).toBe('DELETE');
        expect(init?.credentials).toBe('include');
        expect(new Headers(init?.headers).get(REQUEST_HEADER)).toBe('1');
        expect(JSON.parse(String(init?.body))).toEqual({ password: 'hunter2' });
    });

    it("rejects with the password's own refusal", async () => {
        answering(Response.json({ message: 'Password is incorrect.' }, { status: 401 }));

        await expect(startOver('wrong')).rejects.toThrow('Password is incorrect.');
    });

    it("rejects with a ProblemDetails' detail", async () => {
        answering(Response.json({ title: 'Conflict', detail: 'Try again in a moment.' }, { status: 409 }));

        await expect(startOver('hunter2')).rejects.toThrow('Try again in a moment.');
    });

    it('says it did not happen when the refusal says nothing, or the API never answered', async () => {
        answering(new Response('', { status: 500 }));
        await expect(startOver('hunter2')).rejects.toThrow('Your library could not be emptied. Please try again.');

        answering(new TypeError('Failed to fetch'));
        await expect(startOver('hunter2')).rejects.toThrow('Your library could not be emptied. Please try again.');
    });
});

describe('startOverSummary', () => {
    it('names what went, leaving out what there was none of', () => {
        expect(startOverSummary({ ...nothing, games: 312, wishlist: 4, favourites: 2 }))
            .toBe('Your library is empty: 312 games, 4 wishlisted games and 2 favourites removed.');
        expect(startOverSummary({ ...nothing, games: 1, favourites: 1 }))
            .toBe('Your library is empty: 1 game and 1 favourite removed.');
        expect(startOverSummary({ ...nothing, wishlist: 1 }))
            .toBe('Your library is empty: 1 wishlisted game removed.');
    });

    it('formats a count the same on the server and in the browser', () => {
        expect(startOverSummary({ ...nothing, games: 5487 })).toBe('Your library is empty: 5,487 games removed.');
    });

    it('says a library already empty was', () => {
        expect(startOverSummary(nothing)).toBe('Your library was already empty.');
    });

    it('says what it did to an import waiting for review', () => {
        expect(startOverSummary({ ...nothing, games: 12, importRowsReselected: 12 })).toBe(
            'Your library is empty: 12 games removed. In the import waiting for your review, '
            + 'the 12 games you had are selected to import again.');
        expect(startOverSummary({ ...nothing, games: 1, importRowsReselected: 1 })).toBe(
            'Your library is empty: 1 game removed. In the import waiting for your review, '
            + 'the 1 game you had is selected to import again.');
    });
});
