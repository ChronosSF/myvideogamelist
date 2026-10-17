/**
 * A game's cover at thumbnail size, or the space one would take.
 *
 * The placeholder is a `span` rather than a `div` because this sits inside a button wherever a game
 * is offered to be chosen, and a button holds phrasing content only.
 */
export function GameCover({ url, className }: { url?: string | null; className: string }) {
    return url
        ? <img src={url} alt="" className={`${className} object-cover rounded shrink-0`} loading="lazy" />
        : <span className={`${className} block rounded bg-raised/60 shrink-0`} aria-hidden="true" />;
}
