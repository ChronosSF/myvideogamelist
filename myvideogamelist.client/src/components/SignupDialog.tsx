import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import './LoginDialog.css';

interface Props {
    onClose: () => void;
    onSwitchToLogin: () => void;
}

export function SignupDialog({ onClose, onSwitchToLogin }: Props) {
    const { register } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }
        setLoading(true);
        try {
            await register(email, password);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="dialog-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="signup-title">
            <div className="dialog-panel dialog-panel-rel" onClick={e => e.stopPropagation()}>
                <button className="dialog-close" onClick={onClose} aria-label="Close">
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <h2 id="signup-title" className="dialog-title">Create Account</h2>

                <form onSubmit={handleSubmit} noValidate>
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
                            autoFocus
                            autoComplete="email"
                        />
                    </div>

                    <div className="dialog-field">
                        <label className="dialog-label" htmlFor="signup-password">Password</label>
                        <input
                            id="signup-password"
                            type="password"
                            className="dialog-input"
                            placeholder="At least 8 characters"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            minLength={8}
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
