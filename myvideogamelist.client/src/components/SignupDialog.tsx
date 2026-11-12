import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
    PASSWORD_MIN_LENGTH,
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
    userNameProblem,
    type RegisterResult,
} from '@/types/auth';
import { useDismissOnOutsidePress } from '@/lib/useDismissOnOutsidePress';
import { DialogClose } from './DialogClose';
import { CheckYourInbox } from './CheckYourInbox';
import { TurnstileWidget } from './TurnstileWidget';
import './LoginDialog.css';

interface Props {
    onClose: () => void;
    onSwitchToLogin: () => void;
}

export function SignupDialog({ onClose, onSwitchToLogin }: Props) {
    const { register } = useAuth();
    const [userName, setUserName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    // Set once the account is made: whether its confirmation went. The dialog then says where to
    // look, rather than closing on somebody who is not signed in (ADR 0089).
    const [registered, setRegistered] = useState<RegisterResult | null>(null);
    // What Cloudflare's check handed over (ADR 0092). The API spends it by asking Cloudflare, whatever
    // the answer, and the form cannot tell a failure that came after the asking from one that came
    // before: a refused name is either, and a request that fails on the way may still have arrived. A
    // spent token sent again is a certain refusal, and an unspent one drawn again is a second's wait, so
    // every failed attempt draws the widget again, under a new key, for the next.
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const [turnstileRound, setTurnstileRound] = useState(0);

    // The same guard as the sign-in dialog, from the same place: this overlay is that one copied,
    // and a fix applied to one of them by hand is the drift ADR 0022 records.
    const dismiss = useDismissOnOutsidePress(onClose);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        // Checked here so an obviously wrong name is answered without a round trip. It is not the
        // enforcement: the server applies the same rules plus a reserved list and availability,
        // and its message replaces this one.
        const badUserName = userNameProblem(userName);
        if (badUserName !== null) {
            setError(badUserName);
            return;
        }

        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }

        if (turnstileToken === null) {
            setError('Please wait for the check that you are a person to finish.');
            return;
        }

        setLoading(true);
        try {
            setRegistered(await register(email, password, userName, turnstileToken));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Registration failed');
            setTurnstileToken(null);
            setTurnstileRound(round => round + 1);
        } finally {
            setLoading(false);
        }
    };

    const close = <DialogClose onClose={onClose} />;

    if (registered !== null) {
        return (
            <div className="dialog-overlay" {...dismiss} role="dialog" aria-modal="true" aria-labelledby="signup-title">
                <div className="dialog-panel dialog-panel-rel">
                    {close}
                    <CheckYourInbox
                        email={email}
                        emailSent={registered.emailSent}
                        titleId="signup-title"
                        onSwitchToLogin={onSwitchToLogin}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="dialog-overlay" {...dismiss} role="dialog" aria-modal="true" aria-labelledby="signup-title">
            <div className="dialog-panel dialog-panel-rel">
                {close}

                <h2 id="signup-title" className="dialog-title">Create Account</h2>

                <form onSubmit={handleSubmit} noValidate>
                    {/* First, because it is the one field on this form that other people will see
                        and the only one that cannot be quietly changed later without breaking
                        links to it. */}
                    <div className="dialog-field">
                        <label className="dialog-label" htmlFor="signup-username">Username</label>
                        <input
                            id="signup-username"
                            type="text"
                            className="dialog-input"
                            placeholder="letters, numbers and underscores"
                            value={userName}
                            onChange={e => setUserName(e.target.value)}
                            required
                            autoFocus
                            minLength={USERNAME_MIN_LENGTH}
                            maxLength={USERNAME_MAX_LENGTH}
                            autoComplete="username"
                            aria-describedby="signup-username-hint"
                        />
                        <p id="signup-username-hint" className="dialog-hint">
                            This is how you appear to other people. Your profile stays private
                            until you choose to publish it.
                        </p>
                    </div>

                    <div className="dialog-field">
                        <label className="dialog-label" htmlFor="signup-email">Email</label>
                        <input
                            id="signup-email"
                            type="email"
                            className="dialog-input"
                            placeholder="you@example.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                        />
                    </div>

                    <div className="dialog-field">
                        <label className="dialog-label" htmlFor="signup-password">Password</label>
                        <input
                            id="signup-password"
                            type="password"
                            className="dialog-input"
                            placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            minLength={PASSWORD_MIN_LENGTH}
                            autoComplete="new-password"
                        />
                    </div>

                    <div className="dialog-field">
                        <label className="dialog-label" htmlFor="signup-confirm">Confirm Password</label>
                        <input
                            id="signup-confirm"
                            type="password"
                            className="dialog-input"
                            placeholder="Repeat your password"
                            value={confirm}
                            onChange={e => setConfirm(e.target.value)}
                            required
                            autoComplete="new-password"
                        />
                    </div>

                    <TurnstileWidget key={turnstileRound} onToken={setTurnstileToken} />

                    {error && <div className="dialog-error" role="alert">{error}</div>}

                    <button type="submit" className="dialog-btn-primary" disabled={loading}>
                        {loading ? 'Creating account…' : 'Create Account'}
                    </button>
                </form>

                <div className="dialog-footer">
                    Already have an account?{' '}
                    <button type="button" onClick={onSwitchToLogin}>
                        Sign In
                    </button>
                </div>
            </div>
        </div>
    );
}
