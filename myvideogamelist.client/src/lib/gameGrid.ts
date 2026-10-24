/**
 * The grid of game cards that the games, lists and wishlist pages share, and the card's own boxes.
 *
 * In one place because three things have to agree with it. The `sizes` a card's cover is chosen by is
 * worked out from this grid's columns and gaps, and from the page container around it — `max-w-7xl` with
 * `px-4 sm:px-6 lg:px-8`, which all three pages use. And the card skeleton is drawn in the card's own
 * boxes, so that the covers and cards arriving move nothing. A change to the grid or the card changes all
 * of them together, or the browser picks covers for a width nothing is drawn at.
 */

export const GAME_GRID = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4';

/**
 * How wide a card's cover is drawn at each of the grid's breakpoints: the container's width less its
 * padding and the gaps, over the columns, less the card's one-pixel border on either side. In rems where
 * Tailwind's own values are rems, so that it moves with the breakpoints if the reader's font size does.
 *
 * Above `xl` the container stops growing at 80rem, so the cover does too: 76rem of content less five
 * gaps, over six.
 */
export const GAME_GRID_COVER_SIZES = [
    '(min-width: 80rem) calc(71rem / 6 - 2px)',
    '(min-width: 64rem) calc((100vw - 8rem) / 5 - 2px)',
    '(min-width: 48rem) calc((100vw - 6rem) / 4 - 2px)',
    '(min-width: 40rem) calc((100vw - 5rem) / 3 - 2px)',
    'calc((100vw - 3rem) / 2 - 2px)',
].join(', ');

/**
 * How many cards the grid's first row holds at its widest. Those load with the page: on a page that opens
 * on a grid, a first-row cover is its largest first paint. The rest are lazy.
 */
export const GAME_GRID_FIRST_ROW = 6;

/** The card's frame, its cover's box and its body: what a card's size comes from. */
export const CARD_FRAME = 'bg-surface rounded-xl overflow-hidden flex flex-col shadow-lg border border-line';
export const CARD_COVER = 'relative aspect-[3/4] bg-page overflow-hidden';
export const CARD_BODY = 'p-4 flex flex-col gap-2 flex-1';
