import { Link } from 'react-router';
import { CoverImage } from '@/components/CoverImage';
import { Rosette } from '@/components/Rosette';
import { useAddToBacklog } from '@/hooks/useAddToBacklog';
import { useFavouriteToggle } from '@/hooks/useFavouriteToggle';
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
 * One release on its own: the card the lists' rails use, with the two actions that fit here — put it in
 * the Backlog, or make it a favourite.
 */
function SingleRelease({ entry, release, undated }: Required<ReleaseCardProps> & { release: ConnectedRelease }) {
    const backlog = useAddToBacklog(release);
    const favourite = useFavouriteToggle(release);

    return (
        <div className="release-card">
            <div className="release-card-art">
                {/* Out of the tab order and hidden from screen readers: the title beside it is the same
                    link, and a link a screen reader meets twice is one too many. */}
                <Link to={`/games/${release.gameId}`} tabIndex={-1} aria-hidden="true" className="release-card-link">
                    <Cover release={release} />
                </Link>
                {favourite.canToggle && (
                    // In the cover's corner, where it stays once the game is a favourite: the mark is the
                    // state as well as the way to change it.
                    <button
                        type="button"
                        className="release-card-favourite"
                        disabled={favourite.pending}
                        onClick={favourite.toggle}
                        aria-pressed={favourite.favourite}
                        aria-label={`Favourite: ${release.title}`}
                        title={favourite.favourite ? 'Remove from favourites' : 'Add to favourites'}
                    >
                        <Rosette filled={favourite.favourite} />
                    </button>
                )}
            </div>
            <div className="release-card-text">
                <Link to={`/games/${release.gameId}`} className="release-card-link">
                    <p className="release-card-title">{release.title}</p>
                </Link>
                {release.earlyAccess && <p className="release-card-badge">Early access</p>}
                {showsPlatformsApart(release) && (
                    <p className="release-card-platforms">{platformNames(release.platforms)}</p>
                )}
                <p className="release-card-reason">{entryReason(entry, { undated })}</p>
                {backlog.listedIn !== null && <p className="release-card-listed">In {backlog.listedIn}</p>}
                {/* Among the words, since a 3.5rem cover cannot carry it. */}
                {backlog.canAdd && (
                    <button
                        type="button"
                        className="release-card-add"
                        disabled={backlog.pending}
                        onClick={backlog.add}
                        // The visible words first, so that saying them to a voice control reaches it;
                        // the title after, so that a screen reader can tell one card's from the next.
                        aria-label={`Add to ${backlog.backlog}: ${release.title}`}
                        title={`Add to ${backlog.backlog}`}
                    >
                        Add to {backlog.backlog}
                    </button>
                )}
                {/* In the card rather than on the cover, which shows the favourite only on hover — a message
                    that disappears when the pointer moves away is no message. */}
                {backlog.failed && (
                    <p className="release-card-add-error" role="alert">Could not add it to {backlog.backlog}.</p>
                )}
                {favourite.failed && (
                    <p className="release-card-add-error" role="alert">Could not change your favourites.</p>
                )}
            </div>
        </div>
    );
}

/** One release in a group's list: its name, where it arrives, and the same two actions, smaller. */
function GroupMember({ release }: { release: ConnectedRelease }) {
    const backlog = useAddToBacklog(release);
    const favourite = useFavouriteToggle(release);

    return (
        <li>
            <Link to={`/games/${release.gameId}`}>{release.title}</Link>
            {release.platforms.length > 0 && <span> · {platformNames(release.platforms)}</span>}
            {backlog.canAdd && (
                <button
                    type="button"
                    className="release-card-add-inline"
                    disabled={backlog.pending}
                    onClick={backlog.add}
                    aria-label={`Add to ${backlog.backlog}: ${release.title}`}
                    title={`Add to ${backlog.backlog}`}
                >
                    +
                </button>
            )}
            {favourite.canToggle && (
                <button
                    type="button"
                    className="release-card-add-inline"
                    data-kind="favourite"
                    disabled={favourite.pending}
                    onClick={favourite.toggle}
                    aria-pressed={favourite.favourite}
                    aria-label={`Favourite: ${release.title}`}
                    title={favourite.favourite ? 'Remove from favourites' : 'Add to favourites'}
                >
                    <Rosette filled={favourite.favourite} />
                </button>
            )}
            {backlog.listedIn !== null && <span className="release-card-listed"> · In {backlog.listedIn}</span>}
            {backlog.failed && (
                <span className="release-card-add-error" role="alert"> · Could not add it.</span>
            )}
            {favourite.failed && (
                <span className="release-card-add-error" role="alert"> · Could not change your favourites.</span>
            )}
        </li>
    );
}

/**
 * A release, or a group of them (F6), as the two-week line and the calendar draw it: a row of a small cover
 * with its name and why it is there beside it (L4, L5, K5; ADR 0075). A group is named after its series or
 * its game and shown with its first cover; what is in it is one click away rather than eight covers wide.
 *
 * As wide as whatever holds it. The rest of a game's actions are on its page; here there are the two that
 * fit a view of what is coming.
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
