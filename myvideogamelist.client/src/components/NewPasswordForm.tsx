import { useState } from 'react';
import './LoginDialog.css';

interface Props {
    /** Sets the password, and answers with a sentence to show beside the form, or null when done with it. */
    onSubmit: (password: string) => Promise<string | null>;
}

/** The new password twice, checked alike here and judged by the API, whose rules are Identity's. */
export function NewPasswordForm({ onSubmit }: Props) {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }

        setError(null);
        setSaving(true);
        try {
            setError(await onSubmit(password));
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} noValidate>
            <div className="dialog-field">
                <label className="dialog-label" htmlFor="reset-password">New password</label>
                <input
                    id="reset-password"
                    type="password"
                    className="dialog-input"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoFocus
                    autoComplete="new-password"
                />
            </div>

            <div className="dialog-field">
                <label className="dialog-label" htmlFor="reset-confirm">Confirm new password</label>
                <input
                    id="reset-confirm"
                    type="password"
                    className="dialog-input"
                    placeholder="Repeat your new password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                />
            </div>

            {error && <div className="dialog-error" role="alert">{error}</div>}

            <button type="submit" className="dialog-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Set the new password'}
            </button>
        </form>
    );
}
