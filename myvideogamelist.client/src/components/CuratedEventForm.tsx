import { useId, useState } from 'react';
import type { SaveResult } from '@/hooks/useCalendarAdmin';
import {
    CURATED_EVENT_KINDS,
    CURATED_EVENT_KIND_LABELS,
    CURATED_EVENT_NAME_MAX,
    CURATED_EVENT_STORES,
    CURATED_EVENT_URL_MAX,
    type CuratedEvent,
    type CuratedEventInput,
    type CuratedEventKind,
    type CuratedEventStore,
    storeLabel,
} from '@/types/calendarAdmin';

interface Draft {
    kind: CuratedEventKind;
    /** '' for no store, which is what a select can hold. */
    store: CuratedEventStore | '';
    name: string;
    startsOn: string;
    endsOn: string;
    url: string;
}

function draftFrom(event: CuratedEvent | undefined): Draft {
    if (!event) return { kind: 'sale', store: 'steam', name: '', startsOn: '', endsOn: '', url: '' };

    return {
        kind: event.kind,
        store: event.store ?? '',
        name: event.name,
        startsOn: event.startsOn,
        endsOn: event.endsOn,
        url: event.url,
    };
}

/** What can be said before a round trip. The server checks all of it again, and more. */
function problems(draft: Draft): Partial<Record<keyof Draft, string>> {
    const found: Partial<Record<keyof Draft, string>> = {};
    if (draft.name.trim() === '') found.name = 'Give it the name it was announced under.';
    if (draft.startsOn === '') found.startsOn = 'When does it start?';
    if (draft.url.trim() === '') found.url = 'Where was it announced? The link is how a date gets checked later.';
    return found;
}

interface CuratedEventFormProps {
    /** The event being edited; absent, the form adds one. */
    event?: CuratedEvent;
    onSubmit: (input: CuratedEventInput) => Promise<SaveResult>;
    /** Shown only when editing, to close the form without saving. */
    onCancel?: () => void;
}

/**
 * Adds a curated event, or edits one in place (spec §6, S1).
 *
 * After an add it keeps the kind, the store and the link and clears the rest, because events arrive
 * in batches from one announcement: Valve's schedule lists a half-year of Steam's sales on one page,
 * and Epic's guide a quarter of its own.
 *
 * The last day may be left empty for an event that lasts one day, and is then the first.
 */
export function CuratedEventForm({ event, onSubmit, onCancel }: CuratedEventFormProps) {
    const id = useId();
    const [draft, setDraft] = useState<Draft>(() => draftFrom(event));
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
    const [error, setError] = useState<string | null>(null);

    const editing = event !== undefined;

    const change = <K extends keyof Draft>(field: K, value: Draft[K]) => {
        setDraft(current => ({ ...current, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const found = problems(draft);
        setFieldErrors(found);
        if (Object.keys(found).length > 0) return;

        setSaving(true);
        const result = await onSubmit({
            kind: draft.kind,
            store: draft.store === '' ? null : draft.store,
            name: draft.name,
            startsOn: draft.startsOn,
            endsOn: draft.endsOn === '' ? draft.startsOn : draft.endsOn,
            url: draft.url,
        });
        setSaving(false);

        if (result.ok) {
            if (!editing) setDraft(current => ({ ...current, name: '', startsOn: '', endsOn: '' }));
            return;
        }

        setFieldErrors(result.fieldErrors);
        // Only the refusal that is about no field the form shows; the others sit beside theirs.
        const shown = (['kind', 'store', 'name', 'startsOn', 'endsOn', 'url'] as const)
            .some(field => result.fieldErrors[field] !== undefined);
        if (!shown) setError(result.error);
    };

    const fieldProps = (field: keyof Draft) => {
        const problem = fieldErrors[field];
        return {
            id: `${id}-${field}`,
            disabled: saving,
            'aria-invalid': problem !== undefined,
            'aria-describedby': problem !== undefined ? `${id}-${field}-error` : undefined,
        };
    };

    const fieldError = (field: keyof Draft) =>
        fieldErrors[field] !== undefined && (
            <p id={`${id}-${field}-error`} className="admin-error">{fieldErrors[field]}</p>
        );

    return (
        <form
            className="admin-form"
            onSubmit={e => void handleSubmit(e)}
            noValidate
            aria-label={editing ? `Edit ${event.name}` : 'Add an event'}
        >
            <div className="admin-form-row">
                <div className="admin-field">
                    <label htmlFor={`${id}-kind`}>Kind</label>
                    <select
                        {...fieldProps('kind')}
                        value={draft.kind}
                        onChange={e => change('kind', e.target.value as CuratedEventKind)}
                    >
                        {CURATED_EVENT_KINDS.map(kind => (
                            <option key={kind} value={kind}>{CURATED_EVENT_KIND_LABELS[kind]}</option>
                        ))}
                    </select>
                    {fieldError('kind')}
                </div>

                <div className="admin-field">
                    <label htmlFor={`${id}-store`}>Store</label>
                    <select
                        {...fieldProps('store')}
                        value={draft.store}
                        onChange={e => change('store', e.target.value as CuratedEventStore | '')}
                    >
                        <option value="">None</option>
                        {CURATED_EVENT_STORES.map(store => (
                            <option key={store} value={store}>{storeLabel(store)}</option>
                        ))}
                    </select>
                    {fieldError('store')}
                </div>
            </div>

            <div className="admin-field">
                <label htmlFor={`${id}-name`}>Name</label>
                <input
                    {...fieldProps('name')}
                    type="text"
                    value={draft.name}
                    maxLength={CURATED_EVENT_NAME_MAX}
                    placeholder="Steam Autumn Sale"
                    onChange={e => change('name', e.target.value)}
                />
                {fieldError('name')}
            </div>

            <div className="admin-form-row">
                <div className="admin-field">
                    <label htmlFor={`${id}-startsOn`}>First day</label>
                    <input
                        {...fieldProps('startsOn')}
                        type="date"
                        value={draft.startsOn}
                        onChange={e => change('startsOn', e.target.value)}
                    />
                    {fieldError('startsOn')}
                </div>

                <div className="admin-field">
                    <label htmlFor={`${id}-endsOn`}>Last day</label>
                    <input
                        {...fieldProps('endsOn')}
                        type="date"
                        value={draft.endsOn}
                        min={draft.startsOn || undefined}
                        onChange={e => change('endsOn', e.target.value)}
                    />
                    {fieldError('endsOn')}
                </div>
            </div>

            <div className="admin-field">
                <label htmlFor={`${id}-url`}>Announced at</label>
                <input
                    {...fieldProps('url')}
                    type="url"
                    value={draft.url}
                    maxLength={CURATED_EVENT_URL_MAX}
                    placeholder="https://partner.steamgames.com/doc/marketing/upcoming_events"
                    onChange={e => change('url', e.target.value)}
                />
                {fieldError('url')}
            </div>

            {error !== null && <p className="admin-error" role="alert">{error}</p>}

            <div className="admin-actions">
                <button type="submit" className="admin-btn" disabled={saving}>
                    {saving ? 'Saving…' : editing ? 'Save' : 'Add event'}
                </button>
                {editing && (
                    <button type="button" className="admin-btn admin-btn-quiet" onClick={onCancel} disabled={saving}>
                        Cancel
                    </button>
                )}
            </div>
        </form>
    );
}
