/** What the file is called when the response does not say. The API names it the same. */
const FALLBACK_FILE_NAME = 'myvideogamelist-export.json';

/**
 * The name the server gave the file in `Content-Disposition`, so the two cannot disagree about it.
 *
 * Handles the quoted form the API sends and a bare token; anything else falls back rather than
 * guessing, because a wrong name is harmless and a mangled one is not.
 */
export function exportFileName(contentDisposition: string | null): string {
    const match = contentDisposition?.match(/filename="([^"]+)"|filename=([^;\s]+)/i);
    return match?.[1] ?? match?.[2] ?? FALLBACK_FILE_NAME;
}

/**
 * Downloads everything the signed-in user has entered, as the one JSON document
 * `GET /api/user/export` produces (ADR 0024).
 *
 * Fetched rather than followed as a plain link, so that a failure can be reported where the button
 * is. A link to an endpoint that answers 500 saves an error page as the export, or navigates away
 * to one — and neither says what went wrong next to the thing the user pressed.
 *
 * Touches `document`, so call it from an event handler and never during render.
 *
 * @throws When the request is refused or never arrives. Both reject, so the caller has one path.
 */
export async function downloadDataExport(): Promise<void> {
    const response = await fetch('/api/user/export', { credentials: 'include' });
    if (!response.ok) throw new Error(`Export failed (${response.status})`);

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    try {
        const link = document.createElement('a');
        link.href = url;
        link.download = exportFileName(response.headers.get('Content-Disposition'));
        // In the document for the click, which not every browser honours on a detached element.
        document.body.appendChild(link);
        link.click();
        link.remove();
    } finally {
        // Revoked on the next task rather than now: revoking in the same task as the click can
        // cancel the download before the browser has read the blob.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}
