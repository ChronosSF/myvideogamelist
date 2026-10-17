import { describe, expect, it } from 'vitest';
import { MAX_BULK_GAMES, bulkDone, bulkFailure, bulkMissing, bulkRefusal, gameCount } from '@/lib/listBulk';

describe('gameCount', () => {
    it('counts in the singular for one and groups thousands the same on either side', () => {
        expect(gameCount(1)).toBe('1 game');
        expect(gameCount(3)).toBe('3 games');
        expect(gameCount(1204)).toBe('1,204 games');
    });
});

describe('bulkFailure', () => {
    it('names the list a move was going to, and a removal by what it does', () => {
        expect(bulkFailure(3, 'Finished')).toBe('Failed to move 3 games to Finished. Please try again.');
        expect(bulkFailure(1, null)).toBe('Failed to take 1 game out of your lists. Please try again.');
    });
});

describe('bulkMissing', () => {
    it('says how many of the games did not move, and why, in the right number', () => {
        expect(bulkMissing(1, 4)).toBe('1 of the 4 games was not moved: it is no longer in your lists.');
        expect(bulkMissing(2, 4)).toBe('2 of the 4 games were not moved: they are no longer in your lists.');
    });

    it('says none moved when none did, rather than "2 of the 2"', () => {
        expect(bulkMissing(2, 2)).toBe('None of the 2 games were moved: they are no longer in your lists.');
        expect(bulkMissing(1, 1)).toBe('That game was not moved: it is no longer in your lists.');
    });
});

describe('bulkDone', () => {
    const saved = (gameIds: number[], moved: number[]) =>
        ({ outcome: 'saved' as const, gameIds, moved, missing: gameIds.filter(id => !moved.includes(id)) });

    it('says where the games went', () => {
        expect(bulkDone(saved([1, 2], [1, 2]), 'On Hold', 'Playing')).toBe('Moved 2 games to On Hold.');
        expect(bulkDone(saved([1, 2], [1, 2]), null, 'Playing')).toBe('Took 2 games out of Playing.');
    });

    it('counts only the games that moved when some could not', () => {
        expect(bulkDone(saved([1, 2, 3], [1, 3]), 'Finished', 'Backlog')).toBe('Moved 2 of the 3 games to Finished.');
    });

    it('says nothing when none moved, since the banner says why', () => {
        expect(bulkDone(saved([1, 2], []), 'Finished', 'Backlog')).toBe('');
    });
});

describe('bulkRefusal', () => {
    it('refuses while one of the games has a write of its own out', () => {
        expect(bulkRefusal([1, 2], id => id === 2)).toMatch(/still saving/);
    });

    it('refuses more games than one request may carry, and lets the most it may carry through', () => {
        const ids = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

        expect(bulkRefusal(ids(MAX_BULK_GAMES + 1), () => false)).toMatch(/more than 10,000 games/);
        expect(bulkRefusal(ids(MAX_BULK_GAMES), () => false)).toBeNull();
    });

    it('matches the server bound', () => {
        // `ListBatch.MaxGames` on the server; a change to one without the other is a 400 on a big list
        // or a refusal the server would have taken.
        expect(MAX_BULK_GAMES).toBe(10_000);
    });
});
