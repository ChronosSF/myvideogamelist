import type { ImportSkippedRow } from '@/types/import';

/**
 * One CSV field, quoted whenever it needs to be.
 *
 * A game title is user-supplied text that may hold a comma, a quote or a newline — "Ratchet &
 * Clank: Up Your Arsenal" is fine, `Portal 2, "co-op"` is not — and a report that corrupts on
 * those is worse than no report, because it looks like it worked.
 */
function field(value: string | null): string {
    const text = value ?? '';
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The rows an import did not write, as a CSV.
 *
 * §C5's promise is that nothing is silently lost. A count of skipped rows does not keep it: the
 * user needs to know *which* games, so they can add them by hand or fix the file and try again.
 */
export function skippedRowsCsv(rows: readonly ImportSkippedRow[]): string {
    const lines = ['Game,Source status,Reason'];

    for (const row of rows) {
        lines.push([field(row.title), field(row.sourceStatus), field(row.reason)].join(','));
    }

    // A trailing newline, because a file whose last line has none is the kind of thing that loses
    // a row in somebody's spreadsheet importer.
    return `${lines.join('\r\n')}\r\n`;
}

/**
 * Saves the skipped rows as a file.
 *
 * Touches `document`, so call it from an event handler and never during render. Built in the
 * browser rather than fetched, because the commit's response already carried the rows — asking the
 * server again would be a second request for data we hold, against a job that may by then have
 * been swept.
 */
export function downloadSkippedRows(rows: readonly ImportSkippedRow[], fileName: string): void {
    // The byte-order mark is for Excel, which otherwise reads a UTF-8 CSV as the system codepage
    // and mangles every non-ASCII title. Everything else ignores it. Built from its code point
    // rather than written as a literal: a bare U+FEFF in source is invisible, and ESLint rejects
    // it as irregular whitespace for exactly that reason.
    const blob = new Blob(
        [String.fromCharCode(0xfeff) + skippedRowsCsv(rows)],
        { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    try {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } finally {
        // Revoked on the next task: doing it in the same one as the click can cancel the download
        // before the browser has read the blob.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}
