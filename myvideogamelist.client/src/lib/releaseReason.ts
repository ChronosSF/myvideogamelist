import type { PlatformDto } from '@/types/game';
import type { ConnectedRelease, ReleaseEntry, ReleaseKind, ReleaseReason } from '@/types/releases';

/**
 * Why a release is on somebody's line, in words (`specs/release-timeline-and-calendar.md` §3.4): "On
 * your wishlist — out on Switch 2", "Expansion for Elden Ring, a favourite", "From the God of War
 * series — you finished God of War".
 *
 * A list is said as what the user did with the game — finished it, is playing it — never by the
 * list's name. These are sentences about a status, whose meaning a rename does not touch (ADR 0031),
 * and "you finished God of War" stays true whatever the list is called, where "in your Finished"
 * would print a default name the user may have replaced. The same goes for the backlog, which is
 * said as what it means: a game they plan to play.
 */

/** What a child of a game is to it, before the game's name: "Expansion for Elden Ring". */
const CHILD_OF: Record<ReleaseKind, string> = {
    // A main game is a child only as an edition: the Witcher 3's 10th Anniversary Edition of its
    // Complete Edition, shown as the game because F3 folds it.
    game: 'New edition of',
    dlc: 'DLC for',
    expansion: 'Expansion for',
    standalone_expansion: 'Standalone expansion for',
    episode: 'New episode of',
    season: 'New season of',
    remake: 'Remake of',
    remaster: 'Remaster of',
    expanded_game: 'New edition of',
    port: 'Port of',
};

/** The game's place in the set as a sentence about it: "you finished God of War". */
function sentence(reason: ReleaseReason, name: string): string {
    switch (reason.membership) {
        case 'favourite':
            return `${name} is a favourite`;
        case 'wishlist':
            return `${name} is on your wishlist`;
        case 'list':
            switch (reason.list) {
                case 'finished': return `you finished ${name}`;
                case 'playing': return `you're playing ${name}`;
                case 'on_hold': return `you put ${name} on hold`;
                case 'backlog': return `you plan to play ${name}`;
                case 'dropped': return `you dropped ${name}`;
                default: return `${name} is in your lists`;
            }
    }
}

/** The same, after the game's name: "Elden Ring, a favourite". */
function afterName(reason: ReleaseReason): string {
    switch (reason.membership) {
        case 'favourite':
            return 'a favourite';
        case 'wishlist':
            return 'on your wishlist';
        case 'list':
            switch (reason.list) {
                case 'finished': return 'which you finished';
                case 'playing': return "which you're playing";
                case 'on_hold': return 'which you put on hold';
                case 'backlog': return 'which you plan to play';
                case 'dropped': return 'which you dropped';
                default: return 'in your lists';
            }
    }
}

/** The same, when the release is the game itself: "You finished it". */
function aboutItself(reason: ReleaseReason): string {
    switch (reason.membership) {
        case 'favourite':
            return 'A favourite of yours';
        case 'wishlist':
            return 'On your wishlist';
        case 'list':
            switch (reason.list) {
                case 'finished': return 'You finished it';
                case 'playing': return "You're playing it";
                case 'on_hold': return 'You put it on hold';
                case 'backlog': return 'You plan to play it';
                case 'dropped': return 'You dropped it';
                default: return 'In your lists';
            }
    }
}

function capitalise(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * "From the God of War series". IGDB names some series with their article — "The Witcher" — and
 * "the The Witcher series" is what prefixing one regardless would say.
 */
function fromSeries(series: string | null): string {
    if (series === null) return 'From the same series';
    return /^the\s/i.test(series) ? `From ${series} series` : `From the ${series} series`;
}

/** Where a release arrives, as the line names platforms: "PS5, Switch 2". Empty when IGDB did not say. */
export function platformNames(platforms: readonly PlatformDto[]): string {
    return platforms.map(p => p.abbreviation || p.name).join(', ');
}

/**
 * Whether the card names the platforms on a line of their own. Not for a release of the game itself,
 * whose reason already says where it is out — "You finished it — out on Switch 2" — because a new
 * platform is the whole of the news.
 */
export function showsPlatformsApart(release: ConnectedRelease): boolean {
    return release.reason.relation !== 'itself' && release.platforms.length > 0;
}

export interface ReasonOptions {
    /**
     * Whether IGDB has no date for it at all (K4). A game of the user's own is then "announced for" its
     * platforms rather than "out on" them.
     */
    undated?: boolean;
}

/** Why one release is on the line or the calendar. */
export function releaseReason(release: ConnectedRelease, { undated = false }: ReasonOptions = {}): string {
    const { reason } = release;
    const name = reason.title;

    switch (reason.relation) {
        case 'itself': {
            // An edition the user tracks by its own name is folded into the game (F3), so it is named;
            // the game itself is "it".
            const who = name === null || reason.gameId === release.gameId
                ? aboutItself(reason)
                : capitalise(sentence(reason, name));

            const where = platformNames(release.platforms);
            if (undated) return where !== '' ? `${who} — announced for ${where}` : `${who} — announced`;

            const what = release.earlyAccess ? 'early access' : 'out';
            if (where !== '') return `${who} — ${what} on ${where}`;
            return release.earlyAccess ? `${who} — early access` : who;
        }
        case 'child':
            return name === null
                ? `${CHILD_OF[release.kind]} one of your games`
                : `${CHILD_OF[release.kind]} ${name}, ${afterName(reason)}`;
        case 'series':
            return name === null
                ? `${fromSeries(reason.series)}, like one of your games`
                : `${fromSeries(reason.series)} — ${sentence(reason, name)}`;
    }
}

/**
 * Why an entry is on the line or the calendar: its release's reason, or for a group (F6) the strongest
 * of its releases', which come strongest first. Said of the group rather than of its first member —
 * "DLC for Kingdom Hearts III" would read as though all eight were.
 */
export function entryReason(entry: Pick<ReleaseEntry, 'releases'>, options: ReasonOptions = {}): string {
    const [strongest] = entry.releases;
    if (entry.releases.length === 1) return releaseReason(strongest, options);

    const { reason } = strongest;
    const name = reason.title;

    switch (reason.relation) {
        case 'itself':
            return name === null ? 'Includes one of your games' : `Includes ${name}, ${afterName(reason)}`;
        case 'child': {
            if (name === null) return 'Connected to one of your games';

            // A run of DLC for one game is the one group that can be called what it is.
            const alike = entry.releases.every(r =>
                r.reason.relation === 'child' && r.reason.gameId === reason.gameId && r.kind === strongest.kind);
            return alike
                ? `${CHILD_OF[strongest.kind]} ${name}, ${afterName(reason)}`
                : `Connected to ${name}, ${afterName(reason)}`;
        }
        case 'series':
            return releaseReason(strongest);
    }
}
