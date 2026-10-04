import { useId, useState } from 'react';
import type { SaveResult } from '@/hooks/useCalendarAdmin';
import { SHOWCASE_NAME_MAX, type ShowcaseName } from '@/types/calendarAdmin';

interface ShowcaseNamesCardProps {
    names: ShowcaseName[];
    addName: (prefix: string) => Promise<SaveResult>;
    removeName: (id: number) => Promise<SaveResult>;
}

/**
 * The names that put an IGDB event on the calendar (spec §5, E1).
 *
 * IGDB records every showcase, the small ones around the big ones included, so an event is shown only
 * when its name starts with one of these. There is no edit: a name is short enough to remove and type
 * again, and removing one takes a click because putting it back takes a few seconds.
 */
export function ShowcaseNamesCard({ names, addName, removeName }: ShowcaseNamesCardProps) {
    const inputId = useId();
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [removingId, setRemovingId] = useState<number | null>(null);
    const [removeError, setRemoveError] = useState<string | null>(null);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (draft.trim() === '') {
            setFieldError('Type the start of a showcase’s name.');
            return;
        }

        setSaving(true);
        setFieldError(null);
        const result = await addName(draft);
        setSaving(false);

        if (result.ok) setDraft('');
        else setFieldError(result.fieldErrors.prefix ?? result.error);
    };

    const handleRemove = async (id: number) => {
        setRemovingId(id);
        setRemoveError(null);
        const result = await removeName(id);
        setRemovingId(null);
        if (!result.ok) setRemoveError(result.error);
    };

    return (
        <section className="admin-card" aria-labelledby="admin-showcases-heading">
            <h2 id="admin-showcases-heading" className="admin-card-title">Showcase names</h2>
            <p className="admin-hint">
                An IGDB event goes on the calendar when its name starts with one of these, ignoring case.
                &ldquo;Summer Game Fest&rdquo; takes &ldquo;Summer Game Fest 2027&rdquo; but not &ldquo;Day
                of the Devs: Summer Game Fest Digital Showcase&rdquo;, which is a show beside it.
            </p>

            <form className="admin-form" onSubmit={e => void handleAdd(e)} noValidate aria-label="Add a showcase name">
                <div className="admin-field">
                    <label htmlFor={inputId}>Name starts with</label>
                    <div className="flex gap-2">
                        <input
                            id={inputId}
                            type="text"
                            value={draft}
                            maxLength={SHOWCASE_NAME_MAX}
                            placeholder="Nintendo Direct"
                            onChange={e => {
                                setDraft(e.target.value);
                                setFieldError(null);
                            }}
                            disabled={saving}
                            aria-invalid={fieldError !== null}
                            aria-describedby={fieldError !== null ? `${inputId}-error` : undefined}
                        />
                        <button type="submit" className="admin-btn" disabled={saving}>
                            {saving ? 'Adding…' : 'Add'}
                        </button>
                    </div>
                    {fieldError !== null && <p id={`${inputId}-error`} className="admin-error">{fieldError}</p>}
                </div>
            </form>

            {removeError !== null && <p className="admin-error" role="alert">{removeError}</p>}

            {names.length > 0 ? (
                <ul className="admin-list" aria-label="Showcase names">
                    {names.map(name => (
                        <li key={name.id} className="admin-row">
                            <span className="admin-row-name">{name.prefix}</span>
                            <button
                                type="button"
                                className="admin-btn admin-btn-danger"
                                onClick={() => void handleRemove(name.id)}
                                disabled={removingId === name.id}
                                aria-label={`Remove ${name.prefix}`}
                            >
                                {removingId === name.id ? 'Removing…' : 'Remove'}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="admin-hint mt-5">
                    No names yet, so no IGDB event is on the calendar. The big ones are Nintendo Direct, State
                    of Play, Summer Game Fest, The Game Awards, Xbox Games Showcase and Gamescom Opening
                    Night Live.
                </p>
            )}
        </section>
    );
}
