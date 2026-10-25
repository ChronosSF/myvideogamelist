import { useId, useState } from 'react';
import { Link } from 'react-router';
import { ErrorState } from '@/components/ErrorState';
import type { SaveResult } from '@/hooks/useCalendarAdmin';
import { gameIdIn } from '@/lib/comingSoon';
import type { ComingSoonPick, ComingSoonPickKind } from '@/types/calendarAdmin';

interface ComingSoonPicksCardProps {
    /** Null when they could not be read: the card says so, with a retry, and offers no form. */
    picks: ComingSoonPick[] | null;
    setPick: (gameId: number, kind: ComingSoonPickKind) => Promise<SaveResult>;
    removePick: (gameId: number) => Promise<SaveResult>;
    /** Reads the admin page's data again, keeping what is on screen meanwhile. */
    reload: () => void;
    reloading: boolean;
}

/**
 * The corrections to the home page's Coming soon panel (ADR 0071).
 *
 * The panel picks itself: the new games of the next three months that the most people follow on IGDB. A
 * pin puts a game on it that too few follow, ahead of the rest; a hide keeps one off. Neither changes the
 * panel's dates. A game is named by its IGDB id, which is in its page's address, and the server names it
 * by what IGDB calls it — so a mistyped id is refused rather than pinned as nothing.
 */
export function ComingSoonPicksCard({ picks, setPick, removePick, reload, reloading }: ComingSoonPicksCardProps) {
    const inputId = useId();
    const [draft, setDraft] = useState('');
    const [kind, setKind] = useState<ComingSoonPickKind>('pin');
    const [saving, setSaving] = useState(false);
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [removingId, setRemovingId] = useState<number | null>(null);
    const [removeError, setRemoveError] = useState<string | null>(null);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const gameId = gameIdIn(draft);
        if (gameId === null) {
            setFieldError('Type a game’s IGDB id, or paste the address of its page.');
            return;
        }

        setSaving(true);
        setFieldError(null);
        const result = await setPick(gameId, kind);
        setSaving(false);

        if (result.ok) setDraft('');
        else setFieldError(result.fieldErrors.gameId ?? result.error);
    };

    const handleRemove = async (gameId: number) => {
        setRemovingId(gameId);
        setRemoveError(null);
        const result = await removePick(gameId);
        setRemovingId(null);
        if (!result.ok) setRemoveError(result.error);
    };

    return (
        <section className="admin-card" aria-labelledby="admin-coming-soon-heading">
            <h2 id="admin-coming-soon-heading" className="admin-card-title">Coming soon on the home page</h2>
            <p className="admin-hint">
                The panel shows the ten new games of the next three months that the most people follow on IGDB.
                Pin a game to put it ahead of them, however few follow it, or hide one to keep it off. Neither
                changes the dates: a pinned game known only to its year still waits for a closer one. A change
                shows within a few minutes.
            </p>

            {picks === null ? (
                // No form while the list is unknown: a pick saved over a list nobody can see could not show
                // what it replaced.
                <ErrorState
                    title="The pinned and hidden games could not be loaded."
                    onRetry={reload}
                    retrying={reloading}
                    size="section"
                />
            ) : (
                <>
                    <form className="admin-form" onSubmit={e => void handleSave(e)} noValidate aria-label="Pin or hide a game">
                        <div className="admin-field">
                            <label htmlFor={inputId}>Game’s IGDB id, or its page’s address</label>
                            <div className="flex flex-wrap gap-2">
                                <input
                                    id={inputId}
                                    type="text"
                                    inputMode="numeric"
                                    value={draft}
                                    placeholder="52189"
                                    onChange={e => {
                                        setDraft(e.target.value);
                                        setFieldError(null);
                                    }}
                                    disabled={saving}
                                    aria-invalid={fieldError !== null}
                                    aria-describedby={fieldError !== null ? `${inputId}-error` : undefined}
                                />
                                <select
                                    value={kind}
                                    onChange={e => setKind(e.target.value as ComingSoonPickKind)}
                                    disabled={saving}
                                    aria-label="Pin or hide"
                                >
                                    <option value="pin">Pin to the panel</option>
                                    <option value="hide">Hide from the panel</option>
                                </select>
                                <button type="submit" className="admin-btn" disabled={saving}>
                                    {saving ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                            {fieldError !== null && <p id={`${inputId}-error`} className="admin-error">{fieldError}</p>}
                        </div>
                    </form>

                    {removeError !== null && <p className="admin-error" role="alert">{removeError}</p>}

                    {picks.length > 0 ? (
                        <ul className="admin-list" aria-label="Pinned and hidden games">
                            {picks.map(pick => (
                                <li key={pick.gameId} className="admin-row">
                                    <span className="admin-row-name">
                                        <Link to={`/games/${pick.gameId}`}>{pick.title}</Link>
                                        <span className="admin-hint"> · {pick.kind === 'pin' ? 'Pinned' : 'Hidden'}</span>
                                    </span>
                                    <button
                                        type="button"
                                        className="admin-btn admin-btn-danger"
                                        onClick={() => void handleRemove(pick.gameId)}
                                        disabled={removingId === pick.gameId}
                                        aria-label={`Remove ${pick.title}`}
                                    >
                                        {removingId === pick.gameId ? 'Removing…' : 'Remove'}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="admin-hint mt-5">
                            Nothing pinned or hidden: the panel is IGDB’s follows alone.
                        </p>
                    )}
                </>
            )}
        </section>
    );
}
