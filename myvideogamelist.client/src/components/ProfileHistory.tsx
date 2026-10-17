import { Link } from 'react-router';
import { useHistory } from '@/hooks/useHistory';
import { useLists } from '@/hooks/useLists';
import { formatCount } from '@/lib/format';
import { historyDays } from '@/lib/history';
import { MAX_SCORE } from '@/lib/score';
import { useHydrated } from '@/lib/useHydrated';
import type { HistoryItem, PlaythroughDateItem, StatusItem } from '@/types/history';
import type { ListId } from '@/types/list';
import { PLAYTHROUGH_TIERS } from '@/types/playthrough';
import './ProfileStats.css';
import './ProfileHistory.css';

/**
 * What the owner has recorded with a date, newest first: moves between lists, scores, and the days
 * playthroughs started and finished — one list, read from three kinds of row (ADR 0062).
 *
 * The owner's page only. The public profile publishes counts and never a dated record of what
 * somebody did with which game, so this has no public counterpart, and the names are the owner's
 * own: a renamed list reads as they renamed it.
 *
 * **It says nothing that no row records.** An imported status has no moment, nor does a score given
 * before the history kept one, so neither is listed — and rather than leave the reader to wonder
 * where those went, the page says how many there are.
 */
export function ProfileHistory({ userId }: { userId: string }) {
    const history = useHistory(userId);
    const { nameFor } = useLists();

    // An instant is put under the reader's own day, which only the browser knows. This renders only
    // once the page knows who is signed in, so never on the server, and waits here all the same.
    const hydrated = useHydrated();

    const heading = (
        <h2 id="profile-history-heading" className="profile-heading">Your history</h2>
    );

    if (history.loading || !hydrated) {
        return (
            <section className="profile-history" aria-labelledby="profile-history-heading" aria-busy="true">
                {heading}
                <p className="profile-empty">Reading back what you have recorded…</p>
            </section>
        );
    }

    if (history.error !== null && history.items.length === 0) {
        return (
            <section className="profile-history" aria-labelledby="profile-history-heading">
                {heading}
                <div className="profile-error" role="alert">
                    <p>{history.error}</p>
                    <button type="button" className="profile-retry" onClick={history.reload}>
                        Try again
                    </button>
                </div>
            </section>
        );
    }

    const days = historyDays(history.items);
    const listName = (key: ListId) => nameFor(key) || key;

    return (
        <section className="profile-history" aria-labelledby="profile-history-heading">
            {heading}

            <p className="profile-caption">
                Newest first: your moves between lists, the scores you give, and the days your
                playthroughs started and finished.
            </p>

            {days.length === 0 ? (
                <p className="profile-empty">
                    Nothing with a date yet. Move a game between your lists, score one, or log a
                    playthrough with its dates, and it shows here.
                </p>
            ) : (
                <ol className="history-days" aria-label="Your history, newest first">
                    {days.map((day, index) => (
                        // With its place, because a day can recur where a reader far enough east sees
                        // a dated item among the next morning's moves. Days are only ever appended
                        // to, so a page landing grows the last one without remounting it.
                        <li key={`${day.key}-${index}`} className="history-day">
                            <h3 className="history-day-title">{day.label}</h3>
                            <ul className="history-items">
                                {day.items.map((item, index) => (
                                    // Items carry no id, by design, and are only ever appended to or
                                    // replaced wholesale, so their place is a stable enough key.
                                    <HistoryRow key={index} item={item} listName={listName} />
                                ))}
                            </ul>
                        </li>
                    ))}
                </ol>
            )}

            {history.hasMore && (
                <div className="history-more">
                    <button
                        type="button"
                        className="history-more-btn"
                        onClick={history.loadMore}
                        disabled={history.loadingMore}
                    >
                        {history.loadingMore ? 'Loading…' : 'Show more'}
                    </button>
                </div>
            )}

            {history.moreError !== null && (
                <div className="history-more-error" role="alert">
                    <p>{history.moreError.message}</p>
                    {history.moreError.restart && (
                        <button type="button" className="profile-retry" onClick={history.reload}>
                            Start again
                        </button>
                    )}
                </div>
            )}

            <Absences importedStatuses={history.importedStatuses} undatedScores={history.undatedScores} />
        </section>
    );
}

/**
 * What the history leaves out, and why — read from the counts the server sends with every page.
 * Nothing is said when nothing is missing.
 */
function Absences({ importedStatuses, undatedScores }: { importedStatuses: number; undatedScores: number }) {
    if (importedStatuses === 0 && undatedScores === 0) return null;

    return (
        <div className="history-absences">
            {importedStatuses > 0 && (
                <p className="profile-caption">
                    {importedStatuses === 1
                        ? 'One of your games was put in its list by an import, which records where a game sits but not when it got there, so that move is not listed. Any dates on its playthroughs are.'
                        : `${formatCount(importedStatuses)} of your games were put in their lists by an import, which records where a game sits but not when it got there, so those moves are not listed. Any dates on their playthroughs are.`}
                </p>
            )}
            {undatedScores > 0 && (
                <p className="profile-caption">
                    {undatedScores === 1
                        ? 'One of your scores has no date, because it was given before your history kept one or came in with an import, so it is not listed.'
                        : `${formatCount(undatedScores)} of your scores have no date, because they were given before your history kept one or came in with an import, so they are not listed.`}
                    {' '}A score you change is listed from the day you change it.
                </p>
            )}
        </div>
    );
}

/** The destination's colour from the lifecycle's own tokens, or a quiet one for leaving every list. */
const STATUS_MARK: Record<ListId, string> = {
    backlog: 'text-status-backlog',
    playing: 'text-status-playing',
    on_hold: 'text-status-on-hold',
    finished: 'text-status-finished',
    dropped: 'text-status-dropped',
};

interface HistoryRowProps {
    item: HistoryItem;
    listName: (key: ListId) => string;
}

/** One item: the game, then what happened to it, each kind drawn with its own mark. */
function HistoryRow({ item, listName }: HistoryRowProps) {
    return (
        <li className="history-item" data-kind={item.kind}>
            <Cover item={item} />
            <div className="history-item-text">
                <p className="history-item-game">
                    {item.game === null ? (
                        <span className="history-item-unknown">A game whose details could not be loaded</span>
                    ) : (
                        <Link to={`/games/${item.gameId}`} className="history-item-link">{item.game.name}</Link>
                    )}
                </p>
                <p className="history-item-what">
                    <Mark item={item} />
                    <What item={item} listName={listName} />
                </p>
            </div>
        </li>
    );
}

/** The cover, decorative: the title beside it is the link and says the same thing. */
function Cover({ item }: { item: HistoryItem }) {
    const url = item.game?.coverImageUrl ?? null;

    return (
        <span className="history-item-cover" aria-hidden="true">
            {url !== null && <img src={url} alt="" loading="lazy" />}
        </span>
    );
}

/** The sentence, in words a screen reader reads as a whole. */
function What({ item, listName }: HistoryRowProps) {
    switch (item.kind) {
        case 'status':
            return <span>{statusSentence(item, listName)}</span>;
        case 'score':
            // On the scale it was entered on, never a percentage: that means an average of other
            // people's (ADR 0021). Stars are the control that sets it, and nothing else.
            return (
                <span>
                    Scored <span className="history-score">{`${item.score}/${MAX_SCORE}`}</span>
                </span>
            );
        case 'playthrough_started':
        case 'playthrough_finished':
            return <PlaythroughWhat item={item} />;
    }
}

function statusSentence(item: StatusItem, listName: (key: ListId) => string): string {
    const { fromStatus: from, toStatus: to } = item;

    if (from === null && to !== null) return `Added to ${listName(to)}`;
    if (from !== null && to !== null) return `Moved from ${listName(from)} to ${listName(to)}`;
    if (from !== null) return `Removed from ${listName(from)}`;
    return 'Changed list';
}

/** A run's start or finish, labelled by its type when it has one. */
function PlaythroughWhat({ item }: { item: PlaythroughDateItem }) {
    const tier = PLAYTHROUGH_TIERS.find(t => t.key === item.playthroughType);

    return (
        <span>
            {item.kind === 'playthrough_started' ? 'Started a playthrough' : 'Finished a playthrough'}
            {tier !== undefined && (
                <span className="history-type">
                    <span className={`history-type-dot ${tier.fill}`} aria-hidden="true" />
                    {tier.label}
                </span>
            )}
        </span>
    );
}

/** The kind's mark: an arrow in the destination's colour, a play and a flag for a run, a number for a score. */
function Mark({ item }: { item: HistoryItem }) {
    switch (item.kind) {
        case 'status':
            return (
                <svg
                    className={`history-mark ${item.toStatus === null ? 'text-fg-faint' : STATUS_MARK[item.toStatus] ?? 'text-fg-muted'}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
            );
        case 'score':
            return (
                <svg className="history-mark text-fg-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5-3.9 19.5m-2.1-19.5-3.9 19.5" />
                </svg>
            );
        case 'playthrough_started':
            return (
                <svg className="history-mark text-status-playing" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                </svg>
            );
        case 'playthrough_finished':
            return (
                <svg className="history-mark text-status-finished" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
                </svg>
            );
    }
}
