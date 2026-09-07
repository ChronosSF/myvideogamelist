import { useId, useState } from 'react';
import type { PlatformDto } from '@/types/game';
import type { PlaythroughDto, PlaythroughInputDto, PlaythroughTypeKey } from '@/types/playthrough';
import { PLAYTHROUGH_TIERS } from '@/types/playthrough';

interface PlaythroughFormProps {
    /** The game's own platforms, so the select offers what this game actually runs on. */
    platforms: PlatformDto[];
    /** The playthrough being edited, or null when logging a new one. */
    editing: PlaythroughDto | null;
    onSubmit: (input: PlaythroughInputDto) => void;
    onCancelEdit: () => void;
    pending: boolean;
    /** What the server said, shown beside the form rather than as a page-level banner. */
    error: string | null;
}

/** Everything the form holds, as strings, which is what the inputs deal in. */
interface Draft {
    platformId: string;
    type: string;
    hours: string;
    minutes: string;
    startedOn: string;
    finishedOn: string;
    notes: string;
}

const EMPTY: Draft = {
    platformId: '',
    type: '',
    hours: '',
    minutes: '',
    startedOn: '',
    finishedOn: '',
    notes: '',
};

/**
 * Logging one time through a game, or editing one already logged.
 *
 * A plain submit with a pending state and an inline error, deliberately — not an optimistic
 * update. The list mutations are optimistic because a status toggle has to feel instant and its
 * rollback is one field; a form with seven of them has nothing to gain from showing a row that
 * may be about to vanish, and everything to lose from the user editing it while it does.
 *
 * Everything is optional, because a run in progress genuinely has no hours and no type yet. The
 * type select says so rather than leaving its blank option unexplained.
 */
export function PlaythroughForm({
    platforms,
    editing,
    onSubmit,
    onCancelEdit,
    pending,
    error,
}: PlaythroughFormProps) {
    const fieldId = useId();
    const [draft, setDraft] = useState<Draft>(EMPTY);

    // Load the playthrough being edited into the fields, and clear them again when the edit is
    // finished or abandoned. Adjusted during render rather than in an effect: from an effect this
    // would show the previous row's values under the new heading for one commit, and it trips
    // react-hooks/set-state-in-effect.
    const [lastEditingId, setLastEditingId] = useState<number | null>(editing?.id ?? null);
    if (lastEditingId !== (editing?.id ?? null)) {
        setLastEditingId(editing?.id ?? null);
        setDraft(editing === null ? EMPTY : toDraft(editing));
    }

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
        setDraft(current => ({ ...current, [key]: value }));

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        onSubmit(toInput(draft));
    };

    return (
        <form className="game-user-panel-playthrough-form" onSubmit={handleSubmit}>
            <div className="game-user-panel-field">
                <label htmlFor={`${fieldId}-platform`}>Platform</label>
                <select
                    id={`${fieldId}-platform`}
                    value={draft.platformId}
                    onChange={event => set('platformId', event.target.value)}
                    disabled={pending}
                >
                    <option value="">Not recorded</option>
                    {platforms.map(platform => (
                        <option key={platform.id} value={platform.id}>{platform.name}</option>
                    ))}
                </select>
            </div>

            <div className="game-user-panel-field">
                <label htmlFor={`${fieldId}-type`}>How you played it</label>
                <select
                    id={`${fieldId}-type`}
                    value={draft.type}
                    onChange={event => set('type', event.target.value)}
                    disabled={pending}
                    aria-describedby={`${fieldId}-type-hint`}
                >
                    <option value="">Not sure yet</option>
                    {PLAYTHROUGH_TIERS.map(tier => (
                        <option key={tier.key} value={tier.key}>{tier.label}</option>
                    ))}
                </select>
                <p id={`${fieldId}-type-hint`} className="game-user-panel-hint">
                    Leave this blank while you are still playing. Only playthroughs with both a
                    type and a time count towards the community figures.
                </p>
            </div>

            <div className="game-user-panel-field-pair">
                <div className="game-user-panel-field">
                    <label htmlFor={`${fieldId}-hours`}>Hours</label>
                    <input
                        id={`${fieldId}-hours`}
                        type="number"
                        min={0}
                        value={draft.hours}
                        onChange={event => set('hours', event.target.value)}
                        disabled={pending}
                    />
                </div>
                <div className="game-user-panel-field">
                    <label htmlFor={`${fieldId}-minutes`}>Minutes</label>
                    <input
                        id={`${fieldId}-minutes`}
                        type="number"
                        min={0}
                        max={59}
                        value={draft.minutes}
                        onChange={event => set('minutes', event.target.value)}
                        disabled={pending}
                    />
                </div>
            </div>

            <div className="game-user-panel-field-pair">
                <div className="game-user-panel-field">
                    <label htmlFor={`${fieldId}-started`}>Started</label>
                    <input
                        id={`${fieldId}-started`}
                        type="date"
                        value={draft.startedOn}
                        onChange={event => set('startedOn', event.target.value)}
                        disabled={pending}
                    />
                </div>
                <div className="game-user-panel-field">
                    <label htmlFor={`${fieldId}-finished`}>Finished</label>
                    <input
                        id={`${fieldId}-finished`}
                        type="date"
                        value={draft.finishedOn}
                        onChange={event => set('finishedOn', event.target.value)}
                        disabled={pending}
                    />
                </div>
            </div>

            <div className="game-user-panel-field">
                <label htmlFor={`${fieldId}-notes`}>Notes</label>
                <textarea
                    id={`${fieldId}-notes`}
                    rows={3}
                    maxLength={2000}
                    value={draft.notes}
                    onChange={event => set('notes', event.target.value)}
                    disabled={pending}
                />
            </div>

            {error !== null && (
                <p className="game-user-panel-hint" role="alert">{error}</p>
            )}

            <div className="game-user-panel-confirm">
                <button type="submit" className="danger" disabled={pending}>
                    {editing === null ? 'Log playthrough' : 'Save playthrough'}
                </button>
                {editing !== null && (
                    <button type="button" onClick={onCancelEdit} disabled={pending}>
                        Cancel
                    </button>
                )}
            </div>
        </form>
    );
}

function toDraft(playthrough: PlaythroughDto): Draft {
    const minutes = playthrough.minutesPlayed;
    return {
        platformId: playthrough.platformId === null ? '' : String(playthrough.platformId),
        type: playthrough.type ?? '',
        hours: minutes === null ? '' : String(Math.floor(minutes / 60)),
        minutes: minutes === null ? '' : String(minutes % 60),
        startedOn: playthrough.startedOn ?? '',
        finishedOn: playthrough.finishedOn ?? '',
        notes: playthrough.notes ?? '',
    };
}

/**
 * The draft as the API's shape.
 *
 * Every blank field becomes null rather than an empty string or a zero: the API's range starts at
 * one minute, so a zero would be a valid-looking value the database would reject, exactly as a
 * zero score would (ADR 0021).
 */
function toInput(draft: Draft): PlaythroughInputDto {
    const totalMinutes = (numberOrZero(draft.hours) * 60) + numberOrZero(draft.minutes);

    return {
        type: draft.type === '' ? null : (draft.type as PlaythroughTypeKey),
        platformId: draft.platformId === '' ? null : Number(draft.platformId),
        minutesPlayed: totalMinutes > 0 ? totalMinutes : null,
        startedOn: draft.startedOn === '' ? null : draft.startedOn,
        finishedOn: draft.finishedOn === '' ? null : draft.finishedOn,
        notes: draft.notes.trim() === '' ? null : draft.notes.trim(),
    };
}

/** A blank or unparseable number field contributes nothing rather than a NaN. */
function numberOrZero(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
