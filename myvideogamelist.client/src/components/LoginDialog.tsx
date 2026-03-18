import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import './LoginDialog.css';

interface Props {
    onClose: () => void;
    onSwitchToRegister: () => void;
}

export function LoginDialog({ onClose, onSwitchToRegister }: Props) {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await login(email, password, rememberMe);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="dialog-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="login-title">
            <div className="dialog-panel dialog-panel-rel" onClick={e => e.stopPropagation()}>
                <button className="dialog-close" onClick={onClose} aria-label="Close">
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <h2 id="login-title" className="dialog-title">Sign In</h2>

                <form onSubmit={handleSubmit} noValidate>
                    <div className="dialog-field">
                        <label className="dialog-label" htmlFor="login-email">Email</label>
                        <input
                            id="login-email"
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
