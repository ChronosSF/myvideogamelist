import { describe, expect, it } from 'vitest';
import {
    type Placed,
    type PositionWrite,
    MAX_POSITION,
    MAX_POSITION_WRITES,
    MIN_POSITION,
    POSITION_STEP,
    moveRefusal,
    planMove,
} from '@/lib/handOrder';

/**
 * The list as it reads once the writes are applied: placed games in ascending order, then the
 * unplaced. The order games are given in breaks every tie, standing in for the comparator's arrival
 * order, which is what the input is already sorted by.
 */
function applied(ordered: readonly Placed[], writes: readonly PositionWrite[]): number[] {
    const next = new Map(writes.map(write => [write.id, write.position]));
    return ordered
        .map((item, index) => ({ id: item.id, index, position: next.has(item.id) ? next.get(item.id)! : item.position }))
        .sort((a, b) => {
            if (a.position !== b.position) {
                if (a.position === null) return 1;
                if (b.position === null) return -1;
                return a.position - b.position;
            }
            return a.index - b.index;
        })
        .map(item => item.id);
}

/** What the order should be: the game taken out and put back right after the anchor. */
function intended(ordered: readonly Placed[], movedId: number, afterId: number | null): number[] {
    const ids = ordered.map(item => item.id).filter(id => id !== movedId);
    ids.splice(afterId === null ? 0 : ids.indexOf(afterId) + 1, 0, movedId);
    return ids;
}

function placedAt(...positions: (number | null)[]): Placed[] {
    return positions.map((position, index) => ({ id: index + 1, position }));
}

describe('planMove', () => {
    it('places only the moved game when nothing in the list has been placed yet', () => {
        // The first thing anybody does with a fresh backlog: pull the next game to the top. Every
        // other game stays unplaced, so one row is written.
        const ordered = placedAt(null, null, null, null);

        const writes = planMove(ordered, 3, null);

        expect(writes).toEqual([{ id: 3, position: 0 }]);
        expect(applied(ordered, writes)).toEqual([3, 1, 2, 4]);
    });

    it('puts a game first by stepping below the first position', () => {
        const ordered = placedAt(0, 1024, 2048);

        expect(planMove(ordered, 3, null)).toEqual([{ id: 3, position: -POSITION_STEP }]);
    });

    it('puts a game right after the last placed one by stepping past it', () => {
        const ordered = placedAt(0, 1024, null, null);

        const writes = planMove(ordered, 1, 2);

        expect(writes).toEqual([{ id: 1, position: 1024 + POSITION_STEP }]);
        expect(applied(ordered, writes)).toEqual([2, 1, 3, 4]);
    });

    it('takes the midpoint between two neighbours with room between them', () => {
        const ordered = placedAt(0, 1024, 2048);

        expect(planMove(ordered, 3, 1)).toEqual([{ id: 3, position: 512 }]);
    });

    it('places the unplaced games a move passes on its way into them, and no others', () => {
        // Dropped after the second of four unplaced games: those two have to be placed for it to sit
        // after them, and the two behind it stay unplaced.
        const ordered = placedAt(0, 1024, null, null, null, null);

        const writes = planMove(ordered, 1, 4);

        expect(writes).toEqual([
            { id: 3, position: 1024 + POSITION_STEP },
            { id: 4, position: 1024 + 2 * POSITION_STEP },
            { id: 1, position: 1024 + 3 * POSITION_STEP },
        ]);
        expect(applied(ordered, writes)).toEqual([2, 3, 4, 1, 5, 6]);
    });

    it('spreads the neighbours of a crowded spot rather than the whole list', () => {
        // A hundred games a step apart, except two that a run of moves left one apart. The move
        // between them has to renumber something, and it should be a handful of games.
        const ordered: Placed[] = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, position: index * POSITION_STEP }));
        ordered[50] = { id: 51, position: ordered[49].position! + 1 };

        const writes = planMove(ordered, 100, 50);

        expect(writes.length).toBeLessThanOrEqual(4);
        expect(applied(ordered, writes)).toEqual(intended(ordered, 100, 50));
    });

    it('writes nothing for a move that ends where it began', () => {
        const ordered = placedAt(0, 1024, null);

        expect(planMove(ordered, 2, 1)).toEqual([]);
        expect(planMove(ordered, 1, null)).toEqual([]);
        expect(planMove(ordered, 3, 2)).toEqual([]);
    });

    it('writes nothing for an id that is not in the list, and for a game put after itself', () => {
        const ordered = placedAt(0, 1024);

        expect(planMove(ordered, 9, null)).toEqual([]);
        expect(planMove(ordered, 1, 9)).toEqual([]);
        expect(planMove(ordered, 1, 1)).toEqual([]);
    });

    it('never steps outside the range the server accepts', () => {
        // A list already against both ends: the step below the first and the step past the last
        // would both be refused with a 400, so the games go back across the range instead.
        const low = placedAt(MIN_POSITION, MIN_POSITION + 10, 0);
        const lowWrites = planMove(low, 3, null);
        expect(applied(low, lowWrites)).toEqual([3, 1, 2]);

        const high = placedAt(0, MAX_POSITION - 10, MAX_POSITION, null);
        const highWrites = planMove(high, 1, 4);
        expect(applied(high, highWrites)).toEqual([2, 3, 4, 1]);

        for (const write of [...lowWrites, ...highWrites]) {
            expect(write.position).toBeGreaterThanOrEqual(MIN_POSITION);
            expect(write.position).toBeLessThanOrEqual(MAX_POSITION);
            expect(Number.isInteger(write.position)).toBe(true);
        }
    });

    it('separates two games that two tabs placed at the same number', () => {
        // A tie survives in the order only through the comparator's tie-break. A game dropped between
        // the two has no number between equal neighbours, so they are spread apart.
        const ordered = placedAt(1024, 1024, 2048);

        const writes = planMove(ordered, 3, 1);

        expect(applied(ordered, writes)).toEqual([1, 3, 2]);
    });

    it('lands every move where it was meant to, across many lists and moves', () => {
        // A seeded walk through shapes the cases above do not reach: crowded runs, ties, gaps of one,
        // unplaced tails, lists placed at both ends of the range. Each move is applied to the list the
        // previous one produced, so the spreads have to keep working on their own output.
        let seed = 116;
        const random = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };

        for (let list = 0; list < 60; list++) {
            const size = 1 + Math.floor(random() * 25);
            const placedCount = Math.floor(random() * (size + 1));

            let position = Math.floor((random() - 0.5) * 4096);
            let ordered: Placed[] = Array.from({ length: size }, (_, index) => {
                if (index >= placedCount) return { id: index + 1, position: null };
                position += [0, 1, 2, 3, 64, POSITION_STEP][Math.floor(random() * 6)];
                return { id: index + 1, position };
            });

            for (let move = 0; move < 40; move++) {
                const movedId = ordered[Math.floor(random() * size)].id;
                const anchor = Math.floor(random() * (size + 1)) - 1;
                const afterId = anchor < 0 ? null : ordered[anchor].id;
                if (afterId === movedId) continue;

                const writes = planMove(ordered, movedId, afterId);
                const expected = intended(ordered, movedId, afterId);

                expect(applied(ordered, writes)).toEqual(expected);
                for (const write of writes) {
                    expect(write.position).toBeGreaterThanOrEqual(MIN_POSITION);
                    expect(write.position).toBeLessThanOrEqual(MAX_POSITION);
                    expect(Number.isInteger(write.position)).toBe(true);
                }

                // The next move starts from this one's result, held in its own order as the
                // provider would hold it after sorting.
                const next = new Map(writes.map(write => [write.id, write.position]));
                ordered = expected.map(id => {
                    const item = ordered.find(candidate => candidate.id === id)!;
                    return { id, position: next.has(id) ? next.get(id)! : item.position };
                });
            }
        }
    });
});

describe('moveRefusal', () => {
    const nothingSaving = () => false;

    it('lets a move through when nothing it writes is saving and it fits in one write', () => {
        expect(moveRefusal([{ id: 1, position: 0 }, { id: 2, position: 1024 }], nothingSaving)).toBeNull();
    });

    it('refuses a move that would write a game whose own save is still out', () => {
        // Two writes in flight for one row, and the first to fail rolls back over the second.
        expect(moveRefusal([{ id: 1, position: 0 }, { id: 2, position: 1024 }], id => id === 2))
            .toMatch(/still saving/i);
    });

    it('refuses a move that would carry more positions than one write may', () => {
        const writes = Array.from({ length: MAX_POSITION_WRITES + 1 }, (_, index) => ({ id: index + 1, position: index }));

        expect(moveRefusal(writes, nothingSaving)).toMatch(/more games at once/i);
        expect(moveRefusal(writes.slice(1), nothingSaving)).toBeNull();
    });
});
