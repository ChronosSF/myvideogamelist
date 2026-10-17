import { useId } from 'react';
import type { PlatformDto } from '@/types/game';
import { type OwnershipChoice, type ViewMode, OWNERSHIP_CHOICE_NAMES } from '@/types/list';
import { type SortState, MANUAL_OPTION, SORT_OPTIONS, sortOption } from '@/lib/listSort';
import { ListFilterMenu } from '@/components/ListFilterMenu';
import './ListToolbar.css';

interface ListToolbarProps {
    view: ViewMode;
    onViewChange: (view: ViewMode) => void;
    sort: SortState;
    onSortChange: (sort: SortState) => void;
    /** Whether this list can be put in an order by hand, which adds "My order" to the sorts. */
    offerManual?: boolean;
    /** Every platform present in the user's lists, so no option filters to nothing. */
    platforms: PlatformDto[];
    selectedPlatformIds: number[];
    onPlatformsChange: (ids: number[]) => void;
    /**
     * Every ownership choice present in the user's lists, "not recorded" included, in the order
     * `OWNERSHIP_CHOICES` gives them. Offered once there are two to choose between.
     */
    ownerships?: OwnershipChoice[];
    selectedOwnerships?: OwnershipChoice[];
    onOwnershipsChange?: (choices: OwnershipChoice[]) => void;
}

/**
 * The controls above a list: layout, sort order, and filters by platform and by ownership.
 *
 * The filters here are **transient and local to this view**, and say so in words: a filter silently
 * still applied on the next visit is how people conclude their games have vanished.
 */
export function ListToolbar({
    view,
    onViewChange,
    sort,
    onSortChange,
    offerManual = false,
    platforms,
    selectedPlatformIds,
    onPlatformsChange,
    ownerships = [],
    selectedOwnerships = [],
    onOwnershipsChange = () => {},
}: ListToolbarProps) {
    const sortId = useId();

    const sorts = offerManual ? [...SORT_OPTIONS, MANUAL_OPTION] : SORT_OPTIONS;

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
                    {sorts.map(option => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                </select>

                {/* A hand order has no direction: read backwards it is not one anybody arranged. */}
                {sort.key !== MANUAL_OPTION.key && (
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
                )}
            </div>

            {platforms.length > 1 && (
                <ListFilterMenu
                    allLabel="All platforms"
                    someLabel={count => `${count} platform${count === 1 ? '' : 's'}`}
                    heading="Filter by platform"
                    options={platforms.map(platform => ({ id: platform.id, name: platform.name }))}
                    selected={selectedPlatformIds}
                    onChange={onPlatformsChange}
                />
            )}

            {ownerships.length > 1 && (
                <ListFilterMenu
                    allLabel="Any ownership"
                    someLabel={count => (count === 1
                        ? OWNERSHIP_CHOICE_NAMES[selectedOwnerships[0]]
                        : `${count} kinds of ownership`)}
                    heading="Filter by ownership"
                    options={ownerships.map(choice => ({ id: choice, name: OWNERSHIP_CHOICE_NAMES[choice] }))}
                    selected={selectedOwnerships}
                    onChange={onOwnershipsChange}
                />
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
