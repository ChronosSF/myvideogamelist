import { useId, useState } from 'react';
import { useLists } from '@/hooks/useLists';
import { type ListId, type ListNames, LIST_IDS, LIST_NAMES, LIST_NAME_MAX } from '@/types/list';

type Drafts = Record<ListId, string>;

function draftsFrom(names: ListNames): Drafts {
    const drafts = {} as Drafts;
    for (const id of LIST_IDS) drafts[id] = names[id] ?? '';
    return drafts;
}

/**
 * A draft as the server will store it: trimmed, runs of whitespace as one space, and nothing — the
 * default — for a blank or for the default name itself. `ListNamePolicy.Normalise` on the server is
 * the authority; this only decides whether there is anything to save.
 */
function normalised(id: ListId, draft: string): string | null {
    const name = draft.trim().replace(/\s+/g, ' ');
    return name === '' || name === LIST_NAMES[id] ? null : name;
}

function sameNames(a: ListNames, b: ListNames): boolean {
    return LIST_IDS.every(id => (a[id] ?? null) === (b[id] ?? null));
}

/**
 * Renames the five lists, on the owner's settings page.
 *
 * A form with one Save for all five, because the names are judged together — two lists may not share
 * one — and a refusal has to arrive beside the field it is about while the others keep what was
 * typed. The labels are the default names, so a renamed list still says which list it is.
 *
 * It edits nothing until the names are known. The names arrive with the list preferences, and a form
 * filled from a request that failed would show every list at its default and save that over whatever
 * the user had chosen — the trap the platform preferences on this page document too.
 */
export function ListNamesCard() {
    const { names, namesStatus, saveListNames } = useLists();
    const fieldId = useId();

    const [drafts, setDrafts] = useState<Drafts>(() => draftsFrom(names));
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<ListId, string>>>({});
    const [error, setError] = useState<string | null>(null);

    // Follow the stored names when they change — arriving, or saved — compared by value rather than
    // by reference. The provider refetches its preferences whenever the account object changes, which
    // toggling the theme on this very page does; a reference check would wipe a half-typed rename.
    const [lastNames, setLastNames] = useState(names);
    if (!sameNames(lastNames, names)) {
        setLastNames(names);
        setDrafts(draftsFrom(names));
    }

    const unchanged = LIST_IDS.every(id => normalised(id, drafts[id]) === (names[id] ?? null));

    const handleChange = (id: ListId, value: string) => {
        setSaved(false);
        setDrafts(current => ({ ...current, [id]: value }));
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setSaved(false);
        setError(null);
        setFieldErrors({});

        const wanted: ListNames = {};
        for (const id of LIST_IDS) {
            const name = normalised(id, drafts[id]);
            if (name !== null) wanted[id] = name;
        }

        const result = await saveListNames(wanted);
        setSaving(false);

        if (result.ok) {
            setSaved(true);
        } else {
            setFieldErrors(result.fieldErrors);
            setError(result.error);
        }
    };

    return (
        <div className="user-card">
            <div className="user-card-label">List names</div>
            <p className="user-card-hint">
                Call your lists whatever you like. A new name changes the label and nothing else: your
                statistics still count each list as what it is, and your public profile uses the usual
                names.
            </p>

            {namesStatus === 'loading' && (
                <p className="user-card-hint">Loading your list names…</p>
            )}

            {namesStatus === 'failed' && (
                <p className="user-pref-error" role="alert">
                    Your list names could not be loaded, so they cannot be changed just now.
                </p>
            )}

            {namesStatus === 'ready' && (
                <form className="list-names-form" onSubmit={event => void handleSubmit(event)} noValidate>
                    {LIST_IDS.map(id => {
                        const inputId = `${fieldId}-${id}`;
                        const problem = fieldErrors[id];
                        return (
                            <div key={id} className="list-names-field">
                                <label htmlFor={inputId}>{LIST_NAMES[id]}</label>
                                <input
                                    id={inputId}
                                    type="text"
                                    value={drafts[id]}
                                    placeholder={LIST_NAMES[id]}
                                    maxLength={LIST_NAME_MAX}
                                    onChange={event => handleChange(id, event.target.value)}
                                    disabled={saving}
                                    aria-invalid={problem !== undefined}
                                    aria-describedby={problem !== undefined ? `${inputId}-error` : undefined}
                                />
                                {problem !== undefined && (
                                    <p id={`${inputId}-error`} className="user-pref-error">{problem}</p>
                                )}
                            </div>
                        );
                    })}

                    {/* Only the failure that is about no one field; the others sit beside theirs. A
                        live region, since the form above it does not move when a save fails. */}
                    {error !== null && (
                        <p className="user-pref-error" role="alert">{error}</p>
                    )}

                    <button
                        type="submit"
                        className="user-btn user-btn-block"
                        disabled={saving || unchanged}
                    >
                        {saving ? 'Saving…' : saved && unchanged ? '✓ Saved' : 'Save names'}
                    </button>
                </form>
            )}
        </div>
    );
}
