import './LoginDialog.css';

/** The cross in a sign-in, sign-up or forgotten-password dialog's corner, one for all three. */
export function DialogClose({ onClose }: { onClose: () => void }) {
    return (
        <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
    );
}
