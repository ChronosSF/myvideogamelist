import { useId, useState } from 'react';
import './ListToolbar.css';

interface ListFilterMenuProps<T extends string | number> {
    /** What the button says while nothing is filtered out — "All platforms". */
    allLabel: string;
    /** What it says once some choices are left out, given how many are still in. */
    someLabel: (count: number) => string;
    /** The panel's heading — "Filter by platform". */
    heading: string;
    /** Only choices present in the user's lists, so none filters to nothing. */
    options: { id: T; name: string }[];
    /** The choices still in. Empty means all of them, so the filter starts inert. */
    selected: T[];
    onChange: (next: T[]) => void;
}

/**
 * One of the toolbar's filters: a button that opens a panel of checkboxes, every one ticked to begin
 * with. The platform filter's, given a second use by the ownership filter (`docs/decisions/0055-*`).
 *
 * Transient and local to this view, and it says so in words: a filter silently still applied on the
 * next visit is how people conclude their games have vanished (ADR 0020).
 */
export function ListFilterMenu<T extends string | number>({
    allLabel,
    someLabel,
    heading,
    options,
    selected,
    onChange,
}: ListFilterMenuProps<T>) {
    const [open, setOpen] = useState(false);
    const panelId = useId();

    const allSelected = selected.length === 0;

    const toggle = (id: T) => {
        // An empty selection means "everything", so the first click has to seed the set with every
        // choice minus the one being unchecked.
        const current = allSelected ? options.map(option => option.id) : selected;
        const next = current.includes(id)
            ? current.filter(existing => existing !== id)
            : [...current, id];

        onChange(next.length === options.length ? [] : next);
    };

    return (
        <div className="list-toolbar-group list-toolbar-filter">
            <button
                type="button"
                className={`list-toolbar-button${allSelected ? '' : ' active'}`}
                onClick={() => setOpen(current => !current)}
                aria-expanded={open}
                aria-controls={panelId}
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                {allSelected ? allLabel : someLabel(selected.length)}
            </button>

            {open && (
                <>
                    {/* Click-away, kept as a sibling so it cannot swallow the panel's own clicks. */}
                    <div className="list-toolbar-backdrop" onClick={() => setOpen(false)} role="presentation" />
                    <div className="list-toolbar-panel" id={panelId}>
                        <div className="list-toolbar-panel-head">
                            <span>{heading}</span>
                            {!allSelected && (
                                <button type="button" onClick={() => onChange([])}>Reset</button>
                            )}
                        </div>
                        <ul>
                            {options.map(option => (
                                <li key={option.id}>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={allSelected || selected.includes(option.id)}
                                            onChange={() => toggle(option.id)}
                                        />
                                        <span>{option.name}</span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                        <p className="list-toolbar-panel-note">
                            Applies to this view only, and is not saved.
                        </p>
                    </div>
                </>
            )}
        </div>
    );
}
