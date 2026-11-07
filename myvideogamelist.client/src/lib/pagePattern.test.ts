import { describe, expect, it } from 'vitest';
import type { UIMatch } from 'react-router';
import { drawsTopPattern } from './pagePattern';

/** A route on the page, with its handle, and whether its loader threw, which leaves it no data. */
const route = (handle: unknown, { threw = false } = {}): UIMatch => {
    const loaderData = threw ? undefined : {};
    return { id: 'route', pathname: '/', params: {}, data: loaderData, loaderData, handle } as UIMatch;
};

describe('drawsTopPattern', () => {
    it('draws it on a page none of whose routes says otherwise', () => {
        expect(drawsTopPattern([route(undefined), route({ something: 'else' })])).toBe(true);
    });

    it('leaves it out under a route that says it draws only the foot', () => {
        // The game page: its hero is opaque where the top is drawn (ADR 0084).
        expect(drawsTopPattern([route(undefined), route({ pagePattern: 'foot' }), route(undefined)])).toBe(false);
    });

    it("draws it again when that route's loader threw, since its boundary has no hero over it", () => {
        expect(drawsTopPattern([route(undefined), route({ pagePattern: 'foot' }, { threw: true })])).toBe(true);
    });
});
