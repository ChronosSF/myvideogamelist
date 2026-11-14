const COUNT_FORMAT = new Intl.NumberFormat('en-US');

/**
 * A count grouped by thousands, as `5,487`, and the same string on the server as in the browser.
 *
 * Never `count.toLocaleString()`. With no locale it formats in the runtime's own, and a page is
 * formatted twice — by Node during the server render, then by the browser during hydration — in two
 * locales that need not agree. Node set to Bulgarian writes `5487` where an American browser writes
 * `5,487` and a German one `5.487`; the text differs, and hydration fails.
 *
 * English because the copy around every count is English: a localised separator inside an English
 * sentence would read as a typo even on a machine where both sides happened to match.
 */
export function formatCount(count: number): string {
    return COUNT_FORMAT.format(count);
}

/** A count and the words for it, one for one and the other for any other count: "1 row", "5,001 rows". */
export function formatCountOf(count: number, one: string, many: string): string {
    return `${formatCount(count)} ${count === 1 ? one : many}`;
}
