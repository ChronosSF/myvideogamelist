import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDismissOnOutsidePress } from '@/lib/useDismissOnOutsidePress';
import { DialogClose } from './DialogClose';
import { StillNothing } from './StillNothing';
import './LoginDialog.css';

interface Props {
    /** What the sign-in dialog held when "Forgot password?" was pressed, or nothing. */
    initialEmailOrUserName: string;
    onClose: () => void;
    onSwitchToLogin: () => void;
}

/**
 * Asks for the link that sets a new password (ADR 0090), and then says where to look for it.
 *
 * What it says once asked is hedged, as the confirmation's resend is. The API answers every request the
 * same, whether or not an account goes by what was typed and whether or not one was sent a link in the
 * last few minutes, so that nobody can use this to learn either. The sentence is true in every one of
 * those cases, and names the address only as it was typed: a username's address is never shown.
 *
 * It ends with the support address, as the confirmation's resend does (`StillNothing`): an address SES has
 * stopped sending to is told that a link went, and is sent nothing however often it asks (ADR 0091).
 */
export function ForgotPasswordDialog({ initialEmailOrUserName, onClose, onSwitchToLogin }: Props) {
    const { requestPasswordReset } = useAuth();
    const [emailOrUserName, setEmailOrUserName] = useState(initialEmailOrUserName);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    // What the request was sent for, once it has been: the dialog then says where to look.
    const [sentFor, setSentFor] = useState<string | null>(null);

    // The same guard as the other two dialogs, from the same place.
    const dismiss = useDismissOnOutsidePress(onClose);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const asked = emailOrUserName.trim();
        if (asked === '') {
            setError('Enter the email address or the username you signed up with.');
            return;
        }

        setError(null);
        setLoading(true);
        try {
            await requestPasswordReset(asked);
            setSentFor(asked);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not send the link. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="dialog-overlay" {...dismiss} role="dialog" aria-modal="true" aria-labelledby="forgot-title">
            <div className="dialog-panel dialog-panel-rel">
                <DialogClose onClose={onClose} />

                {sentFor !== null ? (
                    <>
                        <h2 id="forgot-title" className="dialog-title">Check your inbox</h2>
                        <div className="dialog-text" role="status">
                            <p>
                                If an account goes by <strong>{sentFor}</strong>, we have sent a link to its email
                                address. Open it to choose a new password. It works for a short while, and once.
                            </p>
                            <p>
                                It can take a minute to arrive. If it does not, look in your spam folder. We send
                                one every few minutes at most.
                            </p>
                            <p><StillNothing /></p>
                        </div>
                    </>
                ) : (
                    <>
                        <h2 id="forgot-title" className="dialog-title">Forgot your password?</h2>
                        <form onSubmit={handleSubmit} noValidate>
                            <p className="dialog-text">
                                Enter your email address or username, and we will send a link to choose a new
                                password.
                            </p>
                            <div className="dialog-field">
                                <label className="dialog-label" htmlFor="forgot-email">Email or username</label>
                                <input
                                    id="forgot-email"
                                    type="text"
                                    className="dialog-input"
                                    placeholder="you@example.com or your username"
                                    value={emailOrUserName}
                                    onChange={e => setEmailOrUserName(e.target.value)}
                                    required
                                    autoFocus
                                    autoComplete="username"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                />
                            </div>

                            {error && <div className="dialog-error" role="alert">{error}</div>}

                            <button type="submit" className="dialog-btn-primary" disabled={loading}>
                                {loading ? 'Sending…' : 'Send the link'}
                            </button>
                        </form>
                    </>
                )}

                <div className="dialog-footer">
                    Remembered it?{' '}
                    <button type="button" onClick={onSwitchToLogin}>
                        Sign In
                    </button>
                </div>
            </div>
        </div>
    );
}
