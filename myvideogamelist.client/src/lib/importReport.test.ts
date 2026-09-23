import { describe, expect, it } from 'vitest';
import { skippedRowsCsv } from '@/lib/importReport';
import type { ImportSkippedRow } from '@/types/import';

function row(overrides: Partial<ImportSkippedRow> = {}): ImportSkippedRow {
    return { title: 'A Game', sourceStatus: 'Played', reason: 'You chose not to import it.', ...overrides };
}

describe('skippedRowsCsv', () => {
    it('writes a header and one line per row', () => {
        const csv = skippedRowsCsv([row({ title: 'Portal 2' }), row({ title: 'Braid' })]);

        expect(csv.split('\r\n').filter(Boolean)).toEqual([
            'Game,Source status,Reason',
            'Portal 2,Played,You chose not to import it.',
            'Braid,Played,You chose not to import it.',
        ]);
    });

    it('quotes a title containing a comma', () => {
        // Game titles are user data and routinely contain one. Unquoted, the reason column shifts
        // a place and the file looks fine until somebody reads it.
        const csv = skippedRowsCsv([row({ title: 'Sam & Max: Season One, Episode 1' })]);

        expect(csv).toContain('"Sam & Max: Season One, Episode 1",Played,');
    });

    it('doubles a quote inside a title', () => {
        const csv = skippedRowsCsv([row({ title: 'Portal 2 "co-op"' })]);

        expect(csv).toContain('"Portal 2 ""co-op""",Played,');
    });

    it('quotes a value containing a newline', () => {
        const csv = skippedRowsCsv([row({ title: 'Line one\nLine two' })]);

        expect(csv).toContain('"Line one\nLine two",Played,');
    });

    it('writes an empty field for a row with no source status', () => {
        expect(skippedRowsCsv([row({ sourceStatus: null })])).toContain('A Game,,You chose');
    });

    it('ends with a newline even when there are no rows', () => {
        // A file whose last line has no terminator is what loses a row in somebody's spreadsheet
        // importer, and an empty report is still a valid answer.
        expect(skippedRowsCsv([])).toBe('Game,Source status,Reason\r\n');
    });
});
