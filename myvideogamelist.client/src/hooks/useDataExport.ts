import { useState } from 'react';
import { downloadDataExport } from '@/lib/dataExport';

export interface UseDataExportResult {
    downloading: boolean;
    /** Set when the last attempt failed, and cleared by the next one. */
    error: string | null;
    download: () => Promise<void>;
}

/**
 * A button's worth of state around `downloadDataExport`: whether it is running, and whether it
 * failed.
 *
 * Local to each button rather than shared, because the profile card and the deletion dialog each
 * offer the download and each should report its own attempt. Nothing here belongs to an account —
 * the document goes straight to a file — so there is nothing for a sign-out to leave behind.
 */
export function useDataExport(): UseDataExportResult {
    const [downloading, setDownloading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const download = async () => {
        setDownloading(true);
        setError(null);
        try {
            await downloadDataExport();
        } catch {
            setError('Your data could not be downloaded just now. Please try again.');
        } finally {
            setDownloading(false);
        }
    };

    return { downloading, error, download };
}
