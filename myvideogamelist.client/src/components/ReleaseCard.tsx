import { Link } from 'react-router';
import { CoverImage } from '@/components/CoverImage';
import { FavouriteMark } from '@/components/FavouriteMark';
import { ReleaseActions } from '@/components/ReleaseActions';
import { useReleaseGame } from '@/hooks/useReleaseGame';
import { RELEASE_COVER_SIZES } from '@/lib/releaseCard';
import { entryReason, platformNames, showsPlatformsApart } from '@/lib/releaseReason';
import type { ConnectedRelease, ReleaseEntry } from '@/types/releases';
import './ReleaseCard.css';

/** What a card draws: an entry with a date, or one announced with none — the same releases either way. */
export type CardEntry = Pick<ReleaseEntry, 'groupName' | 'releases'>;

interface ReleaseCardProps {
    entry: CardEntry;
    /** Whether IGDB has no date for it at all, which its reason says (K4). */
    undated?: boolean;
}

/** Lazy: a list of what is on starts below a ruler or an index, and is drawn after a fetch. */
function Cover({ release }: { release: ConnectedRelease }) {
    return (
        <div className="release-card-cover">
            {release.coverImageUrl && <CoverImage url={release.coverImageUrl} alt="" sizes={RELEASE_COVER_SIZES} />}
        </div>
    );
}

/**
 * The list a release's game is in, by the reader's name for it, where the card should say so: once the game
 * is in one, except of the game itself, whose reason already says where it is ("You finished it"), unless it
 * got there from this card.
 */
function listedIn(release: ConnectedRelease, state: ReturnType<typeof useReleaseGame>): string | null {
    return state.listName !== null && (state.addedHere || release.reason.relation !== 'itself') ? state.listName : null;
}

/**
 * One release on its own: its cover, its name and why it is here, and the wishlist and the Backlog, the two
 * things every view of what is coming offers (`ReleaseActions`). A favourite is marked after the name, as on
 * Coming soon's rows, a 3.5rem cover being too small for the round mark, and changed on the game's page.
 */
function SingleRelease({ entry, release, undated }: Required<ReleaseCardProps> & { release: ConnectedRelease }) {
    const state = useReleaseGame(release);
    const listed = listedIn(release, state);

    return (
        <div className="release-card">
            <div className="release-card-art">
                {/* Out of the tab order and hidden from screen readers: the title beside it is the same
                    link, and a link a screen reader meets twice is one too many. */}
                <Link to={`/games/${release.gameId}`} tabIndex={-1} aria-hidden="true" className="release-card-link">
                    <Cover release={release} />
                </Link>
            </div>
            <div className="release-card-text">
                <Link to={`/games/${release.gameId}`} className="release-card-link">
                    <p className="release-card-title">
                        {release.title}
                        {state.favourite && <FavouriteMark variant="inline" />}
                    </p>
                </Link>
                {release.earlyAccess && <p className="release-card-badge">Early access</p>}
                {showsPlatformsApart(release) && (
                    <p className="release-card-platforms">{platformNames(release.platforms)}</p>
                )}
                <p className="release-card-reason">{entryReason(entry, { undated })}</p>
                {listed !== null && <p className="release-card-listed">In {listed}</p>}
                <ReleaseActions title={release.title} state={state} />
            </div>
        </div>
    );
}

/** One release in a group's list: its name, what it is on, and the same two actions under them. */
function GroupMember({ release }: { release: ConnectedRelease }) {
    const state = useReleaseGame(release);
    const listed = listedIn(release, state);

    return (
        <li>
            <Link to={`/games/${release.gameId}`}>{release.title}</Link>
            {state.favourite && <FavouriteMark variant="inline" />}
            {release.platforms.length > 0 && <span> · {platformNames(release.platforms)}</span>}
            {listed !== null && <span className="release-card-listed"> · In {listed}</span>}
            <ReleaseActions title={release.title} state={state} />
        </li>
    );
}

/**
 * A release, or a group of them (F6), as the two-week line and the calendar draw it: a row of a small cover
 * with its name and why it is there beside it (L4, L5, K5; ADR 0075). A group is named after its series or
 * its game and shown with its first cover; what is in it is one click away rather than eight covers wide.
 *
 * As wide as whatever holds it. The rest of a game's actions are on its page; here there are the two that
 * fit a view of what is coming, the wishlist and the Backlog, as on every such view.
 */
export function ReleaseCard({ entry, undated = false }: ReleaseCardProps) {
    const [first] = entry.releases;
    const count = entry.releases.length;

    if (count === 1) {
        return <SingleRelease entry={entry} release={first} undated={undated} />;
    }

    const cover = entry.releases.find(r => r.coverImageUrl !== null) ?? first;
    return (
        <div className="release-card">
            <div className="release-card-stack">
                <Cover release={cover} />
            </div>
            <div className="release-card-text">
                <p className="release-card-title">{entry.groupName ?? first.title}</p>
                <p className="release-card-count">{count} releases</p>
                <p className="release-card-reason">{entryReason(entry, { undated })}</p>
                <details className="release-card-group">
                    <summary>Show all {count}</summary>
                    <ul>
                        {entry.releases.map(release => <GroupMember key={release.gameId} release={release} />)}
                    </ul>
                </details>
            </div>
        </div>
    );
}
