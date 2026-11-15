import { afterEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_HEADER } from '@/lib/api';
import { startOver, startOverSummary, StartOverUncertainError, type StartOverResult } from '@/lib/startOver';

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

const nothing: StartOverResult = { games: 0, wishlist: 0, favourites: 0, importRowsReselected: 0 };

describe('startOver', () => {
    it('sends the password as a write, with the header every write carries', async () => {
        const counts: StartOverResult = { ...nothing, games: 3, wishlist: 2 };
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

    it("rejects with a validation problem's own sentence for the field", async () => {
        answering(Response.json(
            { title: 'One or more validation errors occurred.', errors: { Password: ['The Password field is required.'] } },
            { status: 400 }));

        await expect(startOver('')).rejects.toThrow('The Password field is required.');
    });

    it('says it did not happen when the refusal says nothing', async () => {
        answering(new Response('', { status: 500 }));

        const refused = startOver('hunter2');
        await expect(refused).rejects.toThrow('Your library could not be emptied. Please try again.');
        await expect(refused).rejects.not.toBeInstanceOf(StartOverUncertainError);
    });

    it('says it cannot tell when no answer arrived, or a success arrived unreadable', async () => {
        // Either way the request may have committed, so the caller reads the library again.
        answering(new TypeError('Failed to fetch'));
        await expect(startOver('hunter2')).rejects.toBeInstanceOf(StartOverUncertainError);

        answering(new Response('<html>gateway</html>', { status: 200 }));
        await expect(startOver('hunter2')).rejects.toThrow(/could not tell whether your library was emptied/i);
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

    it('says what it did to any import waiting for review, with no count of rows it cannot stand behind', () => {
        // Rows, not games: two pending imports naming the same ten games are twenty rows.
        expect(startOverSummary({ ...nothing, games: 10, importRowsReselected: 20 })).toBe(
            'Your library is empty: 10 games removed. In any import waiting for your review, '
            + 'the games you had are selected to import again.');
    });
});
