import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import {
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
    userNameProblem,
    type UserProfile,
} from '@/types/auth';

/**
 * The two settings that decide how this account appears to other people: what it is called, and
 * whether anybody can look it up.
 *
 * One component because the two are one decision in practice — a username means nothing to anybody
 * else until the profile is public, and publishing a profile is what makes the name matter. Split
 * across two cards they read as unrelated preferences, and the link between them is the thing a
 * user needs to understand before they turn either one on.
 */
export function AccountIdentityCard({ user }: { user: UserProfile }) {
    const { updateUserName, updateProfileVisibility } = useAuth();

    const [draft, setDraft] = useState(user.userName);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const [visibilityError, setVisibilityError] = useState<string | null>(null);
    const [visibilitySaving, setVisibilitySaving] = useState(false);

    const isPublic = user.profileVisibility === 'public';

    const handleRename = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        setSaved(false);

        const trimmed = draft.trim();

        // Answered here so an obviously wrong name costs no round trip. Not the enforcement: the
        // server checks the same rules, plus a reserved list and availability, and its message
        // replaces this one.
        const problem = userNameProblem(trimmed);
        if (problem !== null) {
            setError(problem);
            return;
        }

        setSaving(true);
        try {
            await updateUserName(trimmed);
            setEditing(false);
            setSaved(true);
        } catch (err) {
            // Every refusal from this endpoint — taken, reserved, too soon after the last change —
            // is a sentence written for the person reading it, so it is shown as it arrives.
            setError(err instanceof Error ? err.message : 'Failed to change your username.');
        } finally {
            setSaving(false);
        }
    };

    const handleVisibility = async (makePublic: boolean) => {
        setVisibilityError(null);
        setVisibilitySaving(true);
        try {
            await updateProfileVisibility(makePublic ? 'public' : 'private');
        } catch (err) {
            setVisibilityError(err instanceof Error
                ? err.message
                : 'Failed to change your profile visibility.');
        } finally {
            setVisibilitySaving(false);
        }
    };

    return (
        <div className="user-card">
            <div className="user-card-label">Username</div>

            {editing ? (
                <form onSubmit={handleRename} className="username-form">
                    <label className="sr-only" htmlFor="account-username">Username</label>
                    <div className="username-row">
                        <span className="username-at" aria-hidden="true">@</span>
                        <input
                            id="account-username"
                            className="username-input"
                            type="text"
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            minLength={USERNAME_MIN_LENGTH}
                            maxLength={USERNAME_MAX_LENGTH}
                            autoComplete="username"
                            disabled={saving}
                            autoFocus
                        />
                    </div>

                    <p className="user-card-hint">
                        Letters, numbers and underscores, {USERNAME_MIN_LENGTH}–
                        {USERNAME_MAX_LENGTH} characters. Changing it breaks existing links to your
                        profile, and you can only change it once a month.
                    </p>

                    {error && <p className="user-pref-error" role="alert">{error}</p>}

                    <div className="username-actions">
                        <button type="submit" className="user-btn" disabled={saving}>
                            {saving ? 'Saving…' : 'Save username'}
                        </button>
                        <button
                            type="button"
                            className="username-cancel"
                            disabled={saving}
                            onClick={() => {
                                setEditing(false);
                                setError(null);
                                setDraft(user.userName);
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            ) : (
                <>
                    {/* The value and its control share a row; the hint goes underneath at full
                        width, where no button beside it can squeeze it. */}
                    <div className="user-card-row">
                        <div className="user-card-value">@{user.userName}</div>
                        <button
                            type="button"
                            className="user-btn"
                            onClick={() => { setEditing(true); setSaved(false); }}
                        >
                            Change
                        </button>
                    </div>
                    <p className="user-card-hint">
                        {saved ? 'Saved.' : 'How you appear to other people.'}
                    </p>
                </>
            )}

            <hr className="user-card-rule" />

            <div className="user-card-label">Public profile</div>
            <div className="user-card-row">
                <div className="user-card-value">
                    {isPublic ? 'Anyone can see it' : 'Only you can see it'}
                </div>

                <label className="toggle" aria-label="Make my profile public">
                    <input
                        type="checkbox"
                        checked={isPublic}
                        disabled={visibilitySaving}
                        onChange={e => handleVisibility(e.target.checked)}
                    />
                    <span className="toggle-track" />
                    <span className="toggle-thumb" />
                </label>
            </div>
            <p className="user-card-hint">
                {isPublic
                    // Both halves of what "public" covers, because one of them is prose the user
                    // wrote and may not expect to be republished by a settings toggle.
                    ? 'Your lists, scores and activity are visible at the address below, '
                        + 'along with any review you marked public.'
                    : 'Nobody else can see your lists, scores or reviews. Publishing shows '
                        + 'your tracking and the reviews you marked public — never your '
                        + 'email address or your private reviews.'}
            </p>

            {/*
              * Its own paragraph rather than a swap of the hint's text: the hint is the standing
              * explanation of what the toggle covers, and making it the live region would announce
              * that prose every time it re-rendered. The failure is the only thing here worth
              * interrupting a screen reader for.
              */}
            {visibilityError
                && <p className="user-pref-error" role="alert">{visibilityError}</p>}

            {isPublic && (
                <p className="username-link">
                    <Link to={`/u/${user.userName}`}>/u/{user.userName}</Link>
                </p>
            )}
        </div>
    );
}
