import { useId } from 'react';
import type { GenreDto, PlatformDto } from '@/types/game';
import { type GameBrowse, type GameSort, GAME_SORTS, MIN_SCORES, isFiltered } from '@/lib/gameBrowse';

interface GameBrowseFiltersProps {
    browse: GameBrowse;
    /**
     * Null when the list could not be loaded: that filter is left out rather than offered empty —
     * unless the URL already filters by it, which is shown so that it can be seen and cleared.
     */
    platforms: PlatformDto[] | null;
    genres: GenreDto[] | null;
    years: number[];
    onChange: (changes: Partial<GameBrowse>) => void;
    onClear: () => void;
}

const selectClass =
    'w-full sm:w-auto px-3 py-2 bg-slate-800 light:bg-white border border-slate-600 light:border-slate-300 '
    + 'rounded-lg text-white light:text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 '
    + 'focus:border-transparent disabled:opacity-60';

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-slate-400 light:text-slate-600 mb-1';

/** An empty option value means "any", which is how a select says null. */
function toNumber(value: string): number | null {
    return value === '' ? null : Number(value);
}

/**
 * The value the URL filters by when the select does not offer it, or null.
 *
 * A stale or hand-edited link can name a platform that is no longer active, a genre IGDB has since
 * dropped, or a year or score the select does not list, and the listing is still narrowed by it: the
 * API is sent what the URL says. A select with no option for its value shows its first one instead —
 * "All platforms" over a result set that is not all platforms — so each select adds the value as an
 * option of its own, and the controls go on describing what is on the page.
 */
function unoffered(value: number | null, offered: readonly number[]): number | null {
    return value !== null && !offered.includes(value) ? value : null;
}

/** Newest or highest first, as both of the numeric selects are ordered. */
function descending(values: readonly number[]): number[] {
    return [...values].sort((a, b) => b - a);
}

/**
 * The browse page's order and filters, as plain selects.
 *
 * Native `<select>`s rather than custom menus: each is one choice from a short list, and a native
 * control is keyboard- and screen-reader-complete on every platform for nothing. Every change goes
 * straight into the URL through `onChange`, which is what makes the result server-rendered and
 * shareable.
 *
 * The order is disabled while searching, and says so: IGDB orders a search by how well each game
 * matches and refuses one that asks for anything else. The filters still apply to a search.
 */
export function GameBrowseFilters({ browse, platforms, genres, years, onChange, onClear }: GameBrowseFiltersProps) {
    const id = useId();
    const searching = browse.search !== '';
    const sort = GAME_SORTS.find(s => s.key === browse.sort) ?? GAME_SORTS[0];

    const unofferedPlatform = unoffered(browse.platform, (platforms ?? []).map(platform => platform.id));
    const unofferedGenre = unoffered(browse.genre, (genres ?? []).map(genre => genre.id));
    const unofferedYear = unoffered(browse.year, years);
    const unofferedScore = unoffered(browse.minScore, MIN_SCORES);
    const yearOptions: readonly number[] = unofferedYear === null ? years : descending([...years, unofferedYear]);
    const scoreOptions: readonly number[] = unofferedScore === null
        ? MIN_SCORES
        : descending([...MIN_SCORES, unofferedScore]);

    return (
        <div className="mt-4">
            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end" role="group" aria-label="Sort and filter games">
                <div>
                    <label htmlFor={`${id}-sort`} className={labelClass}>Order</label>
                    <select
                        id={`${id}-sort`}
                        className={selectClass}
                        value={searching ? 'relevance' : browse.sort}
                        onChange={event => onChange({ sort: event.target.value as GameSort })}
                        disabled={searching}
                        aria-describedby={`${id}-hint`}
                    >
                        {searching && <option value="relevance">Best match</option>}
                        {GAME_SORTS.map(option => (
                            <option key={option.key} value={option.key}>{option.label}</option>
                        ))}
                    </select>
                </div>

                {((platforms !== null && platforms.length > 0) || unofferedPlatform !== null) && (
                    <div>
                        <label htmlFor={`${id}-platform`} className={labelClass}>Platform</label>
                        <select
                            id={`${id}-platform`}
                            className={selectClass}
                            value={browse.platform ?? ''}
                            onChange={event => onChange({ platform: toNumber(event.target.value) })}
                        >
                            <option value="">All platforms</option>
                            {(platforms ?? []).map(platform => (
                                <option key={platform.id} value={platform.id}>{platform.name}</option>
                            ))}
                            {unofferedPlatform !== null && (
                                <option value={unofferedPlatform}>Unlisted platform</option>
                            )}
                        </select>
                    </div>
                )}

                {((genres !== null && genres.length > 0) || unofferedGenre !== null) && (
                    <div>
                        <label htmlFor={`${id}-genre`} className={labelClass}>Genre</label>
                        <select
                            id={`${id}-genre`}
                            className={selectClass}
                            value={browse.genre ?? ''}
                            onChange={event => onChange({ genre: toNumber(event.target.value) })}
                        >
                            <option value="">All genres</option>
                            {(genres ?? []).map(genre => (
                                <option key={genre.id} value={genre.id}>{genre.name}</option>
                            ))}
                            {unofferedGenre !== null && (
                                <option value={unofferedGenre}>Unlisted genre</option>
                            )}
                        </select>
                    </div>
                )}

                <div>
                    <label htmlFor={`${id}-year`} className={labelClass}>Released</label>
                    <select
                        id={`${id}-year`}
                        className={selectClass}
                        value={browse.year ?? ''}
                        onChange={event => onChange({ year: toNumber(event.target.value) })}
                    >
                        <option value="">Any year</option>
                        {yearOptions.map(year => (
                            <option key={year} value={year}>{year}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor={`${id}-score`} className={labelClass}>Critic score</label>
                    <select
                        id={`${id}-score`}
                        className={selectClass}
                        value={browse.minScore ?? ''}
                        onChange={event => onChange({ minScore: toNumber(event.target.value) })}
                    >
                        <option value="">Any score</option>
                        {scoreOptions.map(score => (
                            <option key={score} value={score}>{`${score} and above`}</option>
                        ))}
                    </select>
                </div>

                {isFiltered(browse) && (
                    <div className="col-span-2 sm:col-span-1">
                        <button
                            type="button"
                            className="px-3 py-2 text-sm font-semibold text-blue-400 light:text-blue-700 hover:underline"
                            onClick={onClear}
                        >
                            Clear filters
                        </button>
                    </div>
                )}
            </div>

            <p id={`${id}-hint`} className="mt-2 text-xs text-slate-400 light:text-slate-600">
                {searching
                    ? 'Search results come in order of how well they match. The filters still apply.'
                    : sort.hint}
            </p>
        </div>
    );
}
