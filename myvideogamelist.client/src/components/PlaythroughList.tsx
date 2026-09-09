import type { PlatformDto } from '@/types/game';
import type { PlaythroughDto } from '@/types/playthrough';
import { playthroughTypeLabel } from '@/types/playthrough';
import { formatExactMinutes } from '@/lib/duration';

interface PlaythroughListProps {
    playthroughs: PlaythroughDto[];
    /** The game's platforms, for resolving the bare IGDB id each playthrough carries. */
    platforms: PlatformDto[];
    onEdit: (playthrough: PlaythroughDto) => void;
    onDelete: (playthrough: PlaythroughDto) => void;
    /** The playthrough currently being deleted, so only its own controls go quiet. */
    busyId: number | null;
    disabled: boolean;
}

/**
 * The user's own playthroughs of one game, most recently started last.
 *
 * Every field is optional on the server, so every line here is conditional — a playthrough logged
 * the day someone starts a game has a platform and a date and nothing else, and padding that out
 * with "unknown" four times would bury the one thing it does say.
 */
export function PlaythroughList({
    playthroughs,
    platforms,
    onEdit,
    onDelete,
    busyId,
    disabled,
}: PlaythroughListProps) {
    if (playthroughs.length === 0) {
        return (
            <p className="game-user-panel-hint">
                Nothing logged yet. A playthrough records how long a game took you and on what —
                and a replay is a second one rather than an overwrite.
            </p>
        );
    }

    return (
        <ul className="game-user-panel-playthroughs">
            {playthroughs.map((playthrough, index) => (
                <li key={playthrough.id} className="game-user-panel-playthrough">
                    <p className="game-user-panel-playthrough-head">
                        <span className="game-user-panel-playthrough-type">
                            {playthroughTypeLabel(playthrough.type) ?? 'In progress'}
                        </span>
                        <span className="game-user-panel-playthrough-meta">
                            {platformName(playthrough.platformId, platforms)}
                        </span>
                    </p>

                    {formatExactMinutes(playthrough.minutesPlayed) !== null && (
                        <p className="game-user-panel-playthrough-hours">
                            {formatExactMinutes(playthrough.minutesPlayed)}
                        </p>
                    )}

                    {dateRange(playthrough) !== null && (
                        <p className="game-user-panel-hint">{dateRange(playthrough)}</p>
                    )}

                    {playthrough.notes !== null && (
                        <p className="game-user-panel-playthrough-notes">{playthrough.notes}</p>
                    )}

                    {/* Named by position rather than by content: two runs of the same game on the
                        same platform are a perfectly ordinary thing to log, and identical
                        accessible names on two buttons help nobody. */}
                    <div className="game-user-panel-playthrough-actions">
                        <button
                            type="button"
                            onClick={() => onEdit(playthrough)}
                            disabled={disabled || busyId === playthrough.id}
                        >
                            {`Edit playthrough ${index + 1}`}
                        </button>
                        <button
                            type="button"
                            onClick={() => onDelete(playthrough)}
                            disabled={disabled || busyId === playthrough.id}
                        >
                            {busyId === playthrough.id
                                ? `Deleting playthrough ${index + 1}`
                                : `Delete playthrough ${index + 1}`}
                        </button>
                    </div>
                </li>
            ))}
        </ul>
    );
}

/**
 * The platform's name, resolved from the game the panel is already showing.
 *
 * The id is stored bare and never validated against IGDB, so it can name a platform this game
 * does not list — a re-release the user logged before the metadata caught up, say. That reads as
 * "Unknown platform" rather than disappearing, because the user did record something.
 */
function platformName(platformId: number | null, platforms: PlatformDto[]): string {
    if (platformId === null) return 'No platform recorded';
    return platforms.find(platform => platform.id === platformId)?.name ?? 'Unknown platform';
}

/**
 * `Started 1 May 2026`, `Finished 12 June 2026`, or `Started 1 May 2026, finished 12 June 2026`.
 * Null when neither date is set.
 *
 * The finish label is capitalised only when it leads. Both dates are optional and the database
 * constrains their order rather than their presence, so a finish date with no start date is a
 * real row — and it renders as a line of its own, where a lowercase opening word reads as a typo.
 * Capitalising it unconditionally would fix that and break the common case, which joins the two
 * into one sentence.
 */
function dateRange(playthrough: PlaythroughDto): string | null {
    const started = playthrough.startedOn === null
        ? null
        : `Started ${formatDay(playthrough.startedOn)}`;

    if (playthrough.finishedOn === null) return started;

    const finished = formatDay(playthrough.finishedOn);
    return started === null
        ? `Finished ${finished}`
        : `${started}, finished ${finished}`;
}

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * `2026-05-01` as `1 May 2026`.
 *
 * Split rather than parsed. `new Date('2026-05-01')` is UTC midnight and renders as the previous
 * day for anybody west of Greenwich, which is exactly the bug `@/lib/stats` documents for months.
 * And not `toLocaleString`, whose month is numeric in some locales.
 */
function formatDay(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    if (!Number.isInteger(month) || month < 1 || month > 12) return iso;
    return `${day} ${MONTHS[month - 1]} ${year}`;
}
