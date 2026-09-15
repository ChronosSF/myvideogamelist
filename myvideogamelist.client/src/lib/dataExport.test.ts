import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadDataExport, exportFileName } from '@/lib/dataExport';

describe('exportFileName', () => {
    it('reads the quoted name the API sends', () => {
        expect(exportFileName('attachment; filename="myvideogamelist-export.json"'))
            .toBe('myvideogamelist-export.json');
    });

    it('reads a bare token', () => {
        expect(exportFileName('attachment; filename=export.json')).toBe('export.json');
    });

    it('falls back when the response names no file', () => {
        expect(exportFileName(null)).toBe('myvideogamelist-export.json');
        expect(exportFileName('attachment')).toBe('myvideogamelist-export.json');
    });
});

describe('downloadDataExport', () => {
    /** The name each clicked link would have saved its file as, in order. */
    let saved: string[];

    const { createObjectURL, revokeObjectURL } = URL;

    beforeEach(() => {
        saved = [];
        // jsdom performs no downloads, so both halves are stood in for: the object URL is a fixed
        // string, and a click records the file name it would have saved under.
        URL.createObjectURL = vi.fn(() => 'blob:export');
        URL.revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            saved.push(this.download);
        });
    });

    afterEach(() => {
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('saves the document under the name the server gave it', async () => {
        const fetchMock = vi.fn(async () => new Response('{"entries":[]}', {
            status: 200,
            headers: { 'Content-Disposition': 'attachment; filename="myvideogamelist-export.json"' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        await downloadDataExport();

        expect(fetchMock).toHaveBeenCalledWith('/api/user/export', { credentials: 'include' });
        expect(saved).toEqual(['myvideogamelist-export.json']);
        // The temporary link is taken out again rather than left in the document.
        expect(document.querySelector('a[download]')).not.toBeInTheDocument();
    });

    it('saves nothing when the export is refused', async () => {
        // A 500's body is an error page, and saving it as somebody's data would be worse than
        // saying it failed.
        vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

        await expect(downloadDataExport()).rejects.toThrow('Export failed (500)');
        expect(saved).toEqual([]);
    });

    it('rejects when the API cannot be reached', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

        await expect(downloadDataExport()).rejects.toThrow('Failed to fetch');
        expect(saved).toEqual([]);
    });
});
