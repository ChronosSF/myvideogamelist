/**
 * What the browse page is showing, read from and written to its URL.
 *
 * The URL owns it, not component state: a filtered listing has to be addressable to be
 * server-rendered, shared or bookmarked, and the loader is the only thing that fetches the first
 * page. These functions are the one place that turns a query string into a browse and back, so the
 * loader, the "load more" requests and the filter controls cannot disagree about what a URL means.
 */

/** The server's `GameSortKeys`. */
export type GameSort = 'rating' | 'popular' | 'newest' | 'name';

export const DEFAULT_SORT: GameSort = 'rating';

/**
 * The orders, labelled for the select. Each hint says what the order leaves out, because each has a
 * floor on what it lists and a reader who cannot see it assumes the catalogue is smaller than it is.
 */
export const GAME_SORTS: { key: GameSort; label: string; hint: string }[] = [
    { key: 'rating', label: 'Top rated', hint: 'Critic score, among games with at least eight critic reviews.' },
    { key: 'popular', label: 'Popular', hint: 'Most ratings on IGDB, from critics and players together.' },
    { key: 'newest', label: 'Newest', hint: 'Released games that have drawn some ratings and a critic review.' },
    { key: 'name', label: 'A to Z', hint: 'Games that have drawn some ratings and a critic review, by title.' },
];

/** The critic-score floors offered, out of 100 — the scale every aggregate is shown on (ADR 0021). */
export const MIN_SCORES = [90, 80, 70, 60] as const;

/** The years the server accepts. A URL outside them is dropped here rather than sent to be refused. */
const MIN_YEAR = 1950;
const MAX_YEAR = 2100;

/**
 * The largest id the API can take: its filters are 32-bit `int`s, and a number above that one does
 * not merely fall outside their range — it fails to bind at all, so the request is a 400 and the
 * loader turns that into a 502 page. Dropped here, like every other value the API would refuse.
 */
const MAX_ID = 2_147_483_647;

/** Where the year select stops: the early seventies are where there is anything to browse. */
export const EARLIEST_OFFERED_YEAR = 1970;

export interface GameBrowse {
    /** Trimmed; empty when not searching. */
    search: string;
    sort: GameSort;
    platform: number | null;
    genre: number | null;
    year: number | null;
    minScore: number | null;
}

export const EMPTY_BROWSE: GameBrowse = {
    search: '',
    sort: DEFAULT_SORT,
    platform: null,
    genre: null,
    year: null,
    minScore: null,
};

function positiveInt(value: string | null, max = MAX_ID): number | null {
    if (value === null || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return parsed >= 1 && parsed <= max ? parsed : null;
}

/**
 * A browse from a query string. Anything malformed is dropped rather than refused: a hand-edited or
 * stale link should still show games, and the API — which refuses the same values with a 400 — is
 * never sent one.
 */
export function browseFrom(params: URLSearchParams): GameBrowse {
    const sort = params.get('sort');
    const year = positiveInt(params.get('year'), MAX_YEAR);

    return {
        search: params.get('search')?.trim() ?? '',
        sort: GAME_SORTS.some(s => s.key === sort) ? sort as GameSort : DEFAULT_SORT,
        platform: positiveInt(params.get('platform')),
        genre: positiveInt(params.get('genre')),
        year: year !== null && year >= MIN_YEAR ? year : null,
        minScore: positiveInt(params.get('minScore'), 100),
    };
}

/**
 * The query string for a browse, leaving out every default. `?sort=rating` and no query at all are
 * one listing, and giving them one URL is what keeps every link to the unfiltered page on its single
 * indexable address — the page's `meta` indexes only the URL with no query string.
 */
export function browseParams(browse: GameBrowse): URLSearchParams {
    const params = new URLSearchParams();
    if (browse.search) params.set('search', browse.search);
    if (browse.sort !== DEFAULT_SORT) params.set('sort', browse.sort);
    if (browse.platform !== null) params.set('platform', String(browse.platform));
    if (browse.genre !== null) params.set('genre', String(browse.genre));
    if (browse.year !== null) params.set('year', String(browse.year));
    if (browse.minScore !== null) params.set('minScore', String(browse.minScore));
    return params;
}

/** One page of games from the API, for this browse. */
export function gamesApiPath(offset: number, browse: GameBrowse): string {
    const params = browseParams(browse);
    params.set('offset', String(offset));
    return `/api/games?${params}`;
}

/** Whether anything narrows the listing, the order aside. */
export function isFiltered(browse: GameBrowse): boolean {
    return browse.platform !== null || browse.genre !== null || browse.year !== null || browse.minScore !== null;
}

/**
 * The years the filter offers, newest first, ending at this one. Next year's games have too few
 * ratings for any order's floor, so offering it would only ever lead to an empty page — upcoming
 * games are the calendar's job.
 */
export function yearsFrom(currentYear: number): number[] {
    const years: number[] = [];
    for (let year = currentYear; year >= EARLIEST_OFFERED_YEAR; year--) years.push(year);
    return years;
}
