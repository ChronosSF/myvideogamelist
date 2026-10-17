import { useId, useRef, useState } from 'react';
import { type TagDto, gamesCarrying } from '@/types/tag';
import { formatCount } from '@/lib/format';
import './ListTagFilter.css';

interface ListTagFilterProps {
    /** The account's tags some game in the lists carries, in name order. Nothing is drawn for none. */
    tags: TagDto[];
    selected: number[];
    onChange: (ids: number[]) => void;
    /** How many games in the list on screen carry a tag, shown beside it. */
    countFor: (tagId: number) => number;
    /** The games the filters leave on screen, and how many the list has, for the announcement. */
    shown: number;
    total: number;
}

/**
 * The lists page's filter by tag, beside the platform filter and drawn like it: a button saying what is
 * ticked, and a panel of checkboxes that says in words what ticking does and that nothing is saved.
 *
 * Unlike the platforms, nothing is ticked to begin with and ticking narrows, because the tags combine —
 * a game is shown when it carries every tag ticked. The checkboxes are a group named by the panel's
 * heading; Escape closes the panel and puts the focus back on the button; and how many games are left
 * is said in a polite live region each time a tick changes it.
 */
export function ListTagFilter({ tags, selected, onChange, countFor, shown, total }: ListTagFilterProps) {
    const [open, setOpen] = useState(false);
    // Whether the panel opens from the button's right edge rather than its left — see `toggleOpen`.
    const [alignEnd, setAlignEnd] = useState(false);
    // Whether a tick has changed here, so that clearing the last one is said — and nothing is said before.
    const [touched, setTouched] = useState(false);
    const panelId = useId();
    const headingId = useId();
    const buttonRef = useRef<HTMLButtonElement>(null);

    if (tags.length === 0) return null;

    const close = () => {
        setOpen(false);
        buttonRef.current?.focus();
    };

    /**
     * Opens or closes the panel. It opens from the button's left edge and can be up to 20rem wide, which
     * on a phone, with the button on the right of a wrapped toolbar, runs off the screen and scrolls the
     * whole page sideways — so when it would, and there is more room to the button's left, it opens from
     * the button's right edge instead. Measured at the press, in the browser, where the button has a place.
     */
    const toggleOpen = () => {
        if (!open && buttonRef.current !== null) {
            const rect = buttonRef.current.getBoundingClientRect();
            const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
            const width = Math.min(20 * rem, window.innerWidth - 2 * rem);
            const roomRight = window.innerWidth - rem - rect.left;
            const roomLeft = rect.right - rem;
            setAlignEnd(width > roomRight && roomLeft > roomRight);
        }
        setOpen(current => !current);
    };

    const change = (ids: number[]) => {
        setTouched(true);
        onChange(ids);
    };

    const toggle = (id: number) =>
        change(selected.includes(id) ? selected.filter(existing => existing !== id) : [...selected, id]);

    // The button's whole name, as the platform filter's is: what is ticked, in words.
    const label = selected.length === 0
        ? 'Filter by tag'
        : selected.length === 1
            ? `Tag: ${tags.find(tag => tag.id === selected[0])?.name ?? ''}`
            : `${selected.length} tags`;

    return (
        <div
            className="list-tag-filter"
            onKeyDown={event => {
                if (event.key === 'Escape' && open) {
                    event.stopPropagation();
                    close();
                }
            }}
        >
            <button
                ref={buttonRef}
                type="button"
                className={`list-tag-filter-button${selected.length === 0 ? '' : ' active'}`}
                onClick={toggleOpen}
                aria-expanded={open}
                aria-controls={panelId}
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span className="list-tag-filter-label">{label}</span>
            </button>

            {open && (
                <>
                    {/* Click-away, kept as a sibling so it cannot swallow the panel's own clicks. */}
                    <div className="list-tag-filter-backdrop" onClick={() => setOpen(false)} role="presentation" />
                    <div
                        className={`list-tag-filter-panel${alignEnd ? ' align-end' : ''}`}
                        id={panelId}
                        role="group"
                        aria-labelledby={headingId}
                    >
                        <div className="list-tag-filter-head">
                            <span id={headingId}>Filter by tag</span>
                            {selected.length > 0 && (
                                <button type="button" onClick={() => change([])}>Reset</button>
                            )}
                        </div>
                        <ul>
                            {tags.map(tag => (
                                <li key={tag.id}>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={selected.includes(tag.id)}
                                            onChange={() => toggle(tag.id)}
                                            // Named outright: the label's own text would run the bare
                                            // figure into the name, "co-op3", so the count is said in
                                            // words here and only shown as the figure.
                                            aria-label={`${tag.name}, ${gamesCarrying(countFor(tag.id))} in this list`}
                                        />
                                        <span className="list-tag-filter-name">{tag.name}</span>
                                        <span className="list-tag-filter-count">{formatCount(countFor(tag.id))}</span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                        <p className="list-tag-filter-note">
                            Shows the games carrying every tag ticked. Applies to this view only, and is not saved.
                        </p>
                    </div>
                </>
            )}

            <p className="sr-only" role="status" aria-live="polite">
                {selected.length > 0
                    ? `${formatCount(shown)} of ${formatCount(total)} games shown.`
                    : touched ? `All ${formatCount(total)} games shown.` : ''}
            </p>
        </div>
    );
}
