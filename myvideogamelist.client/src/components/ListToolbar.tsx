import { useId, useState } from 'react';
import type { PlatformDto } from '@/types/game';
import type { ViewMode } from '@/types/list';
import { type SortState, SORT_OPTIONS, sortOption } from '@/lib/listSort';
import './ListToolbar.css';

interface ListToolbarProps {
    view: ViewMode;
    onViewChange: (view: ViewMode) => void;
    sort: SortState;
    onSortChange: (sort: SortState) => void;
    /** Every platform present in the user's lists, so no option filters to nothing. */
    platforms: PlatformDto[];
    selectedPlatformIds: number[];
    onPlatformsChange: (ids: number[]) => void;
}

/**
 * The controls above a list: layout, sort order, and a platform filter.
 *
 * The platform filter here is **transient and local to this view**, unlike the hidden-platforms
 * setting on the user page which is a saved, global preference for browsing. They are deliberately
 * worded and placed differently — two platform controls that looked alike but behaved differently
 * would be worse than either alone.
 */
export function ListToolbar({
    view,
    onViewChange,
    sort,
    onSortChange,
    platforms,
    selectedPlatformIds,
    onPlatformsChange,
}: ListToolbarProps) {
    const [filterOpen, setFilterOpen] = useState(false);
    const sortId = useId();
    const filterId = useId();

    const allSelected = selectedPlatformIds.length === 0;

    const toggle = (id: number) => {
        // An empty selection means "everything", so the first click has to seed the set with all
        // platforms minus the one being unchecked.
        const current = allSelected ? platforms.map(p => p.id) : selectedPlatformIds;
        const next = current.includes(id)
            ? current.filter(existing => existing !== id)
            : [...current, id];

        onPlatformsChange(next.length === platforms.length ? [] : next);
    };

    return (
        <div className="list-toolbar">
            <div className="list-toolbar-group">
                <label className="list-toolbar-label" htmlFor={sortId}>Sort</label>
                <select
                    id={sortId}
                    className="list-toolbar-select"
                    value={sort.key}
                    onChange={event => {
                        const key = event.target.value as SortState['key'];
                        onSortChange({ key, descending: sortOption(key).defaultDescending });
                    }}
                >
                    {SORT_OPTIONS.map(option => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                </select>

                <button
                    type="button"
                    className="list-toolbar-direction"
                    onClick={() => onSortChange({ ...sort, descending: !sort.descending })}
                    aria-label={sort.descending ? 'Sorted descending. Switch to ascending' : 'Sorted ascending. Switch to descending'}
                    title={sort.descending ? 'Descending' : 'Ascending'}
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d={sort.descending ? 'M19 14l-7 7m0 0l-7-7m7 7V3' : 'M5 10l7-7m0 0l7 7m-7-7v18'}
                        />
                    </svg>
                </button>
            </div>

            {platforms.length > 1 && (
                <div className="list-toolbar-group list-toolbar-filter">
                    <button
                        type="button"
                        className={`list-toolbar-button${allSelected ? '' : ' active'}`}
                        onClick={() => setFilterOpen(open => !open)}
                        aria-expanded={filterOpen}
                        aria-controls={filterId}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                        {allSelected ? 'All platforms' : `${selectedPlatformIds.length} platform${selectedPlatformIds.length === 1 ? '' : 's'}`}
                    </button>

                    {filterOpen && (
                        <>
                            {/* Click-away, kept as a sibling so it cannot swallow the panel's own clicks. */}
                            <div className="list-toolbar-backdrop" onClick={() => setFilterOpen(false)} role="presentation" />
                            <div className="list-toolbar-panel" id={filterId}>
                                <div className="list-toolbar-panel-head">
                                    <span>Filter by platform</span>
                                    {!allSelected && (
                                        <button type="button" onClick={() => onPlatformsChange([])}>Reset</button>
                                    )}
                                </div>
                                <ul>
                                    {platforms.map(platform => (
                                        <li key={platform.id}>
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={allSelected || selectedPlatformIds.includes(platform.id)}
                                                    onChange={() => toggle(platform.id)}
                                                />
                                                <span>{platform.name}</span>
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
            )}

            <div className="list-toolbar-group list-toolbar-views" role="group" aria-label="List layout">
                <button
                    type="button"
                    className={`list-toolbar-view${view === 'tiles' ? ' active' : ''}`}
                    onClick={() => onViewChange('tiles')}
                    aria-pressed={view === 'tiles'}
                    title="Tiles"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                    <span className="sr-only-sm">Tiles</span>
                </button>
                <button
                    type="button"
                    className={`list-toolbar-view${view === 'table' ? ' active' : ''}`}
                    onClick={() => onViewChange('table')}
                    aria-pressed={view === 'table'}
                    title="Table"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                    <span className="sr-only-sm">Table</span>
                </button>
            </div>
        </div>
    );
}
