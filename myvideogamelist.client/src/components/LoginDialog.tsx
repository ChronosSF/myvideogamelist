import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { UnconfirmedEmailError } from '@/types/auth';
import { useDismissOnOutsidePress } from '@/lib/useDismissOnOutsidePress';
import { DialogClose } from './DialogClose';
import { ResendConfirmation } from './ResendConfirmation';
import './LoginDialog.css';

interface Props {
    onClose: () => void;
    onSwitchToRegister: () => void;
    /** Opens the forgotten-password dialog, with whatever the identifier box holds (ADR 0090). */
    onForgotPassword: (emailOrUserName: string) => void;
}

export function LoginDialog({ onClose, onSwitchToRegister, onForgotPassword }: Props) {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    // The address or name the API said waits for its confirmation, as it was typed when it said so:
    // what the offer to send the link again sends it to (ADR 0089).
    const [unconfirmed, setUnconfirmed] = useState<string | null>(null);

    // Both halves of the press have to land on the overlay. Selecting the contents of a field and
    // releasing past the dialog's edge is not a click beside it, whatever `click` reports.
    const dismiss = useDismissOnOutsidePress(onClose);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setUnconfirmed(null);
        setLoading(true);
        try {
            await login(email, password, rememberMe);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed');
            if (err instanceof UnconfirmedEmailError) setUnconfirmed(email);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="dialog-overlay" {...dismiss} role="dialog" aria-modal="true" aria-labelledby="login-title">
            <div className="dialog-panel dialog-panel-rel">
                <DialogClose onClose={onClose} />

                <h2 id="login-title" className="dialog-title">Sign In</h2>

                <form onSubmit={handleSubmit} noValidate>
                    <div className="dialog-field">
                        {/* One box for either, and it says so: the API tries the address first and
                            then the handle (ADR 0027). `autoComplete="username"` is the token a
                            password manager fills a sign-in identifier from, whichever of the two
                            it stored; `type="email"` told it, and the person typing, that this was
                            an address and nothing else. */}
                        <label className="dialog-label" htmlFor="login-email">Email or username</label>
                        <input
                            id="login-email"
                            type="text"
                            className="dialog-input"
                            placeholder="you@example.com or your username"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoFocus
                            autoComplete="username"
                            autoCapitalize="none"
                            spellCheck={false}
                        />
                    </div>

                    <div className="dialog-field">
                        <label className="dialog-label" htmlFor="login-password">Password</label>
                        <input
                            id="login-password"
                            type="password"
                            className="dialog-input"
                            placeholder="••••••••"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                        />
                        {/* Not while a sign-in is out: one that succeeds closes whatever dialog is open by then,
                            and would close the forgotten-password dialog this had opened. */}
                        <button
                            type="button"
                            className="dialog-inline-link"
                            onClick={() => onForgotPassword(email.trim())}
                            disabled={loading}
                        >
                            Forgot password?
                        </button>
                    </div>

                    <label className="dialog-checkbox-row">
                        <input
                            type="checkbox"
                            checked={rememberMe}
                            onChange={e => setRememberMe(e.target.checked)}
                        />
                        Remember me
                    </label>

                    {error && <div className="dialog-error" role="alert">{error}</div>}
                    {unconfirmed !== null && <ResendConfirmation emailOrUserName={unconfirmed} />}

                    <button type="submit" className="dialog-btn-primary" disabled={loading}>
                        {loading ? 'Signing in…' : 'Sign In'}
                    </button>
                </form>

                <div className="dialog-footer">
                    Don&rsquo;t have an account?{' '}
                    <button type="button" onClick={onSwitchToRegister}>
                        Sign Up
                    </button>
                </div>
            </div>
        </div>
    );
}
