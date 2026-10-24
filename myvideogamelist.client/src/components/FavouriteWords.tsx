/**
 * What a cover's `FavouriteMark` says, for a screen reader, put where the game's name is read: after the
 * title in its heading or its link. Visually hidden, because the rosette on the cover already says it.
 */
export function FavouriteWords() {
    return <span className="sr-only">, one of your favourites</span>;
}
