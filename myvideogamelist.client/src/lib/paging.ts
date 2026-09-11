/**
 * Page numbers, as they arrive in a query string and as they are handed back out.
 *
 * Shared between the profile route's loader, which decides whether `?page=` names a page at all,
 * and the review list, which needs the same arithmetic to know whether there is a next one.
 */

/**
 * The page a `?page=` value names, or null when it names none.
 *
 * Absent means the first page. Anything that is not a positive integer written plainly — `0`,
 * `-1`, `1.5`, `1e3`, `01`, ` 2`, `abc` — is null rather than coerced, because a URL that has to
 * be repaired to mean something is not a URL that names a page. The length cap keeps the number
 * inside what the API accepts.
 */
export function pageFrom(raw: string | null): number | null {
    if (raw === null) return 1;
    if (!/^[1-9]\d{0,8}$/.test(raw)) return null;
    return Number(raw);
}

/** The last page that `total` items span at `pageSize` each; never less than one. */
export function lastPage(total: number, pageSize: number): number {
    if (pageSize <= 0) return 1;
    return Math.max(1, Math.ceil(total / pageSize));
}

/** The `search` string for a page. The first page carries none, so every page has one URL. */
export function pageSearch(page: number): string {
    return page <= 1 ? '' : `?page=${page}`;
}
