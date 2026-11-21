import { describe, expect, it } from 'vitest';
import type { ListId, ListMoveDto } from '@/types/list';
import { askFor, askMeta, confirmedMeta, fullDay } from '@/lib/playthroughPrompt';

const TODAY = '2026-11-15';

function moved(unfinished: { id: number; startedOn: string | null } | null = null, isMove = true): ListMoveDto {
    return { moved: isMove, unfinishedPlaythrough: unfinished };
}

describe('askFor: the table of moves (ADR 0097)', () => {
    it('asks to start one when a game goes to Playing with no unfinished run', () => {
        expect(askFor('playing', moved(), TODAY)).toEqual({ kind: 'start', day: TODAY });
    });

    it('asks nothing when it goes to Playing with a run going, which carries on', () => {
        expect(askFor('playing', moved({ id: 4, startedOn: '2026-08-02' }), TODAY)).toBeNull();
    });

    it('asks to finish the run when a game goes to Finished with one unfinished', () => {
        const run = { id: 4, startedOn: '2026-08-02' };
        expect(askFor('finished', moved(run), TODAY)).toEqual({ kind: 'finish', day: TODAY, run });
    });

    it('asks nothing when it goes to Finished with nothing unfinished, as a game added straight there', () => {
        expect(askFor('finished', moved(), TODAY)).toBeNull();
    });

    it.each<ListId>(['dropped', 'on_hold', 'backlog'])('asks nothing on a move to %s, whatever its runs', listId => {
        expect(askFor(listId, moved(), TODAY)).toBeNull();
        expect(askFor(listId, moved({ id: 4, startedOn: '2026-08-02' }), TODAY)).toBeNull();
    });

    it('asks nothing on a move to the list the game was already in', () => {
        expect(askFor('playing', moved(null, false), TODAY)).toBeNull();
        expect(askFor('finished', moved({ id: 4, startedOn: null }, false), TODAY)).toBeNull();
    });

    it('asks to finish a run that does not say when it started', () => {
        expect(askFor('finished', moved({ id: 4, startedOn: null }), TODAY)?.kind).toBe('finish');
    });

    it('asks to finish a run started today, and not one that starts after it', () => {
        expect(askFor('finished', moved({ id: 4, startedOn: TODAY }), TODAY)?.kind).toBe('finish');
        expect(askFor('finished', moved({ id: 4, startedOn: '2026-11-16' }), TODAY)).toBeNull();
    });
});

describe('the lines the toast shows', () => {
    it('names the day in full for a start', () => {
        expect(fullDay(TODAY)).toBe('Sunday 15 November 2026');
        expect(askMeta({ kind: 'start', day: TODAY })).toBe('Sunday 15 November 2026');
        expect(confirmedMeta({ kind: 'start', day: TODAY })).toBe('Sunday 15 November 2026');
    });

    it('says when a finish\'s run started and how long ago', () => {
        const ask = { kind: 'finish' as const, day: TODAY, run: { id: 1, startedOn: '2026-08-02' } };
        expect(askMeta(ask)).toBe('Started 2 Aug 2026 · 105 days ago');
        expect(confirmedMeta(ask)).toBe('2 Aug to 15 Nov 2026 · 105 days');
    });

    it('says today and yesterday in words', () => {
        expect(askMeta({ kind: 'finish', day: TODAY, run: { id: 1, startedOn: TODAY } })).toBe('Started 15 Nov 2026 · today');
        expect(askMeta({ kind: 'finish', day: TODAY, run: { id: 1, startedOn: '2026-11-14' } }))
            .toBe('Started 14 Nov 2026 · yesterday');
        expect(confirmedMeta({ kind: 'finish', day: TODAY, run: { id: 1, startedOn: TODAY } })).toBe('15 Nov 2026 · the same day');
        expect(confirmedMeta({ kind: 'finish', day: TODAY, run: { id: 1, startedOn: '2026-11-14' } }))
            .toBe('14 Nov to 15 Nov 2026 · 1 day');
    });

    it('writes both years when a run spans a new year, and counts past a thousand days', () => {
        expect(confirmedMeta({ kind: 'finish', day: TODAY, run: { id: 1, startedOn: '2023-01-02' } }))
            .toBe('2 Jan 2023 to 15 Nov 2026 · 1,413 days');
    });

    it('has no line for a finish of an undated run, and confirms it with the day', () => {
        const ask = { kind: 'finish' as const, day: TODAY, run: { id: 1, startedOn: null } };
        expect(askMeta(ask)).toBeNull();
        expect(confirmedMeta(ask)).toBe('Sunday 15 November 2026');
    });
});
