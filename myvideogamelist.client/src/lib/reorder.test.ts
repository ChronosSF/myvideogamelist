import { describe, expect, it } from 'vitest';
import { type Slot, arrayMove, nearestSlot, rowLength } from '@/lib/reorder';

/** Rows forty high with a ten-pixel gap, as a table draws them. */
const ROWS: Slot[] = [0, 1, 2, 3].map(index => ({ left: 0, right: 400, top: index * 50, bottom: index * 50 + 40 }));

/** Two rows of three tiles, as the grid draws them at its narrowest. */
const GRID: Slot[] = [0, 1, 2, 3, 4, 5].map(index => ({
    left: (index % 3) * 110,
    right: (index % 3) * 110 + 100,
    top: Math.floor(index / 3) * 160,
    bottom: Math.floor(index / 3) * 160 + 150,
}));

describe('arrayMove', () => {
    it('takes an item out and puts it back at the index asked for', () => {
        expect(arrayMove([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
        expect(arrayMove([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
        expect(arrayMove([1, 2, 3, 4], 1, 1)).toEqual([1, 2, 3, 4]);
    });

    it('leaves the list it was given alone', () => {
        const ids = [1, 2, 3];
        arrayMove(ids, 0, 2);
        expect(ids).toEqual([1, 2, 3]);
    });
});

describe('nearestSlot', () => {
    it('is the slot the point is over', () => {
        expect(nearestSlot(ROWS, 200, 120)).toBe(2);
        expect(nearestSlot(GRID, 330, 200)).toBe(5);
    });

    it('is the nearer of the two either side of a gap', () => {
        expect(nearestSlot(ROWS, 200, 42)).toBe(0);
        expect(nearestSlot(ROWS, 200, 48)).toBe(1);
    });

    it('is the first or the last slot past either end', () => {
        expect(nearestSlot(ROWS, 200, -500)).toBe(0);
        expect(nearestSlot(ROWS, 200, 5000)).toBe(3);
        expect(nearestSlot(GRID, 9000, 9000)).toBe(5);
    });

    it('settles a tie on the first, so the answer does not flicker between two', () => {
        expect(nearestSlot(ROWS, 200, 45)).toBe(0);
    });
});

describe('rowLength', () => {
    it('is the number of slots in the first row of a grid', () => {
        expect(rowLength(GRID)).toBe(3);
    });

    it('is one for a list of rows', () => {
        expect(rowLength(ROWS)).toBe(1);
    });

    it('is one for a layout that fits on a single row, where Up and Down would leap to either end', () => {
        expect(rowLength(GRID.slice(0, 3))).toBe(1);
    });

    it('is one for nothing measured at all', () => {
        expect(rowLength([])).toBe(1);
    });
});
