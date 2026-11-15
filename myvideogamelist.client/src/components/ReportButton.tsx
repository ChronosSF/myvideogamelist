import { useContext, useState } from 'react';
import { AuthContext } from '@/contexts/AuthContext';
import { AuthDialogContext } from '@/contexts/AuthDialogContext';
import { ReportDialog } from '@/components/ReportDialog';
import type { ReportTarget } from '@/types/moderation';
import './ReportButton.css';

interface ReportButtonProps {
    target: ReportTarget;
    /** What the dialog's title says is reported: "alex's review", "@alex's profile". */
    subject: string;
    /** The button's whole accessible name, since a page has one per review: "Report alex's review". */
    label: string;
}

/** A heroicon's path: a flag on its pole. */
const FLAG_ICON = 'M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z';

/**
 * `Report`, under a published review or a public profile (ADR 0076 §1).
 *
 * In the server's HTML for every reader, so a shared-cached profile stays one document for everybody and
 * nothing moves when auth answers. Pressed signed out it opens the sign-in dialog, since a report is a
 * signed-in reader's; after hydration it is taken off the reader's own review and own profile, which only
 * their owner sees move.
 *
 * The two contexts are read without the hooks that insist on them, so that a list drawn without the app's
 * providers — a component's own test — still draws the control. A missing provider reads as signed out.
 */
export function ReportButton({ target, subject, label }: ReportButtonProps) {
    const auth = useContext(AuthContext);
    const authDialog = useContext(AuthDialogContext);
    const [open, setOpen] = useState(false);

    const user = auth?.user ?? null;
    // Handles are one namespace whatever their letter case (ADR 0027), and the page may spell one either way.
    if (user !== null && user.userName.toLowerCase() === target.userName.toLowerCase()) return null;

    const press = () => {
        // Until auth answers, a press could open the sign-in dialog over somebody already signed in.
        if (auth?.loading) return;
        if (user === null) authDialog?.open('login');
        else setOpen(true);
    };

    return (
        <>
            <button
                type="button"
                className="report-btn"
                onClick={press}
                aria-label={label}
                aria-haspopup="dialog"
            >
                <svg aria-hidden="true" width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={FLAG_ICON} />
                </svg>
                Report
            </button>
            {open && <ReportDialog target={target} subject={subject} onClose={() => setOpen(false)} />}
        </>
    );
}
