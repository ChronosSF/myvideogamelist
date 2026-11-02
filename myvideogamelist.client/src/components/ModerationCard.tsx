import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from '@/components/Avatar';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import type { ModerationResult, UseModerationAdminResult } from '@/hooks/useModerationAdmin';
import { formatCount } from '@/lib/format';
import { formatDate } from '@/lib/stats';
import {
    reasonLabel,
    type HiddenReview,
    type ProfileFields,
    type Report,
    type ReportedProfile,
    type ReportedReview,
} from '@/types/moderation';

interface ModerationCardProps {
    moderation: UseModerationAdminResult;
}

/** The game an item is about, by what the cache calls it, or by its id when the cache has nothing. */
function gameName(gameId: number, title: string | null): string {
    return title ?? `Game ${gameId}`;
}

/** "3 reports", or "1 report". */
function reportCount(reports: Report[]): string {
    return `${formatCount(reports.length)} ${reports.length === 1 ? 'report' : 'reports'}`;
}

/**
 * What readers reported, and what an admin did about it (ADR 0076).
 *
 * The one part of the admin page that touches a member's own words, and it touches them in two ways only:
 * a review hidden from everybody but its author, and a display name, picture or bio cleared, as its owner's
 * own blank would. It shows a member's words only because a reader reported them, or because they were
 * hidden here, and it never shows who reported. Every act answers every report of the thing, and dismissing
 * answers them and changes nothing else.
 */
export function ModerationCard({ moderation }: ModerationCardProps) {
    const { data, error, loading, reload } = moderation;

    let body: React.ReactNode;
    if (data === null && error !== null) {
        body = <ErrorState title="The reports could not be loaded." onRetry={reload} retrying={loading} size="section" />;
    } else if (data === null) {
        body = (
            <div className="skeleton-sheen mt-5 space-y-3" aria-hidden="true">
                <Skeleton className="block h-24 w-full rounded-sm" />
                <Skeleton className="block h-24 w-full rounded-sm" />
            </div>
        );
    } else {
        const nothing = data.reviews.length === 0 && data.profiles.length === 0;
        body = (
            <>
                {nothing ? (
                    <p className="admin-hint mt-5">
                        Nothing reported. What readers report shows here, the one reported longest ago first.
                    </p>
                ) : (
                    <ul className="admin-list" aria-label="Reported">
                        {data.reviews.map(item => (
                            <ReportedReviewItem key={`review-${item.reviewId}`} item={item} moderation={moderation} />
                        ))}
                        {data.profiles.map(item => (
                            <ReportedProfileItem key={`profile-${item.accountId}`} item={item} moderation={moderation} />
                        ))}
                    </ul>
                )}

                {(data.reviewsTotal > data.reviews.length || data.profilesTotal > data.profiles.length) && (
                    <p className="admin-hint mt-3">
                        {`Showing ${formatCount(data.reviews.length + data.profiles.length)} of `
                            + `${formatCount(data.reviewsTotal + data.profilesTotal)}. Answer these to see the rest.`}
                    </p>
                )}

                <h3 className="moderation-subhead">Hidden reviews</h3>
                {data.hidden.length === 0 ? (
                    <p className="admin-hint">
                        None hidden. A review hidden from a report shows here, where it can be shown again.
                    </p>
                ) : (
                    <ul className="admin-list" aria-label="Hidden reviews">
                        {data.hidden.map(item => (
                            <HiddenReviewItem key={item.reviewId} item={item} moderation={moderation} />
                        ))}
                    </ul>
                )}
                {data.hiddenTotal > data.hidden.length && (
                    <p className="admin-hint mt-3">
                        {`The ${formatCount(data.hidden.length)} hidden last, of ${formatCount(data.hiddenTotal)}.`}
                    </p>
                )}
            </>
        );
    }

    return (
        <section className="admin-card" aria-labelledby="admin-moderation-heading">
            <h2 id="admin-moderation-heading" className="admin-card-title">Reports</h2>
            <p className="admin-hint">
                What readers reported, the one reported longest ago first. Hiding a review takes it off every page
                but its author&rsquo;s; clearing a name, picture or bio empties it as its owner&rsquo;s own blank
                would. Either answers every report of it, and so does dismissing, which changes nothing else. Nobody
                is told who reported, here or anywhere. A change leaves the site&rsquo;s cache within seconds.
            </p>
            {body}
        </section>
    );
}

/** Runs one act at a time for an item, and keeps the sentence its refusal came with. */
function useAct() {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async (which: string, act: () => Promise<ModerationResult>) => {
        if (busy !== null) return;
        setBusy(which);
        setError(null);
        const result = await act();
        setBusy(null);
        if (!result.ok) setError(result.error);
    };

    return { busy, error, run };
}

/** Each report's reason, its note when there is one, and the day it came. */
function ReportList({ reports }: { reports: Report[] }) {
    return (
        <ul className="moderation-reports">
            {reports.map((report, i) => (
                <li key={i}>
                    <span className="moderation-reason">{reasonLabel(report.reason)}</span>
                    <span className="admin-row-meta">{` · ${formatDate(report.reportedAt)}`}</span>
                    {report.note && <p className="moderation-note" dir="auto">{report.note}</p>}
                </li>
            ))}
        </ul>
    );
}

function ReportedReviewItem({ item, moderation }: { item: ReportedReview; moderation: UseModerationAdminResult }) {
    const { busy, error, run } = useAct();
    const game = gameName(item.gameId, item.gameTitle);

    return (
        <li className="moderation-item">
            <div className="admin-row">
                <div>
                    <p className="admin-row-name">
                        <span className="admin-kind">Review</span>
                        <Link to={`/games/${item.gameId}`}>{game}</Link>
                    </p>
                    <p className="admin-row-meta">
                        {'by '}
                        <Link to={`/u/${item.userName}`}>{`@${item.userName}`}</Link>
                        {item.displayName && <> (<bdi>{item.displayName}</bdi>)</>}
                        {` · ${reportCount(item.reports)}`}
                        {item.hasSpoilers && ' · marked as containing spoilers'}
                    </p>
                </div>
                <div className="admin-actions">
                    <button
                        type="button"
                        className="admin-btn admin-btn-danger"
                        onClick={() => void run('hide', () => moderation.hideReview(item.reviewId))}
                        disabled={busy !== null}
                        aria-label={`Hide @${item.userName}'s review of ${game}`}
                    >
                        {busy === 'hide' ? 'Hiding…' : 'Hide review'}
                    </button>
                    <button
                        type="button"
                        className="admin-btn admin-btn-quiet"
                        onClick={() => void run('dismiss', () => moderation.dismissReview(item.reviewId))}
                        disabled={busy !== null}
                        aria-label={`Dismiss the reports of @${item.userName}'s review of ${game}`}
                    >
                        {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
                    </button>
                </div>
            </div>

            {!item.published && (
                <p className="admin-hint">
                    Not published any more: its author has made it private, or their profile.
                </p>
            )}

            {/* As written, spoilers and all: an admin has to read it to judge it. A text node, so plain text. */}
            <p className="moderation-text" dir="auto">{item.body}</p>
            <ReportList reports={item.reports} />
            {error !== null && <p className="admin-error" role="alert">{error}</p>}
        </li>
    );
}

function ReportedProfileItem({ item, moderation }: { item: ReportedProfile; moderation: UseModerationAdminResult }) {
    const { busy, error, run } = useAct();
    const id = useId();
    const [fields, setFields] = useState<ProfileFields>({ displayName: false, avatarUrl: false, bio: false });
    const chosen = fields.displayName || fields.avatarUrl || fields.bio;

    // Only what is there can be cleared; a field already empty is offered disabled, so the three always
    // stand in the same place.
    const options: { key: keyof ProfileFields; label: string; present: boolean }[] = [
        { key: 'displayName', label: 'Display name', present: item.displayName !== null },
        { key: 'avatarUrl', label: 'Picture', present: item.avatarUrl !== null },
        { key: 'bio', label: 'Bio', present: item.bio !== null },
    ];

    return (
        <li className="moderation-item">
            <div className="admin-row">
                <div className="moderation-who">
                    <Avatar userName={item.userName} avatarUrl={item.avatarUrl} className="moderation-avatar" />
                    <div>
                        <p className="admin-row-name">
                            <span className="admin-kind">Profile</span>
                            <Link to={`/u/${item.userName}`}>{`@${item.userName}`}</Link>
                        </p>
                        <p className="admin-row-meta">
                            {item.displayName ? <>Display name: <bdi>{item.displayName}</bdi></> : 'No display name'}
                            {` · ${reportCount(item.reports)}`}
                        </p>
                    </div>
                </div>
                <div className="admin-actions">
                    <button
                        type="button"
                        className="admin-btn admin-btn-quiet"
                        onClick={() => void run('dismiss', () => moderation.dismissProfile(item.accountId))}
                        disabled={busy !== null}
                        aria-label={`Dismiss the reports of @${item.userName}'s profile`}
                    >
                        {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
                    </button>
                </div>
            </div>

            {!item.published && <p className="admin-hint">Not published any more: its owner has made it private.</p>}

            {item.bio !== null && <p className="moderation-text" dir="auto">{item.bio}</p>}
            {item.avatarUrl !== null && (
                // The address, because the picture is the host's and can change after this is read (ADR 0056).
                <p className="admin-row-meta moderation-address">{item.avatarUrl}</p>
            )}
            <ReportList reports={item.reports} />

            <fieldset className="moderation-clear" disabled={busy !== null}>
                <legend className="admin-row-meta">{`Clear from @${item.userName}'s profile`}</legend>
                {options.map(option => (
                    <label key={option.key} htmlFor={`${id}-${option.key}`}>
                        <input
                            id={`${id}-${option.key}`}
                            type="checkbox"
                            checked={fields[option.key]}
                            disabled={!option.present}
                            onChange={event => setFields(current => ({ ...current, [option.key]: event.target.checked }))}
                        />
                        {option.label}
                    </label>
                ))}
                <button
                    type="button"
                    className="admin-btn admin-btn-danger"
                    onClick={() => void run('clear', () => moderation.clearProfile(item.accountId, fields))}
                    disabled={!chosen}
                >
                    {busy === 'clear' ? 'Clearing…' : 'Clear'}
                </button>
            </fieldset>

            {error !== null && <p className="admin-error" role="alert">{error}</p>}
        </li>
    );
}

function HiddenReviewItem({ item, moderation }: { item: HiddenReview; moderation: UseModerationAdminResult }) {
    const { busy, error, run } = useAct();
    const game = gameName(item.gameId, item.gameTitle);

    return (
        <li className="moderation-item">
            <div className="admin-row">
                <div>
                    <p className="admin-row-name">
                        <Link to={`/games/${item.gameId}`}>{game}</Link>
                    </p>
                    <p className="admin-row-meta">
                        {'by '}
                        <Link to={`/u/${item.userName}`}>{`@${item.userName}`}</Link>
                        {` · hidden ${formatDate(item.hiddenAt)}`}
                    </p>
                </div>
                <button
                    type="button"
                    className="admin-btn"
                    onClick={() => void run('show', () => moderation.showReview(item.reviewId))}
                    disabled={busy !== null}
                    aria-label={`Show @${item.userName}'s review of ${game} again`}
                >
                    {busy === 'show' ? 'Showing…' : 'Show again'}
                </button>
            </div>
            <p className="moderation-text moderation-text-short" dir="auto">{item.body}</p>
            {error !== null && <p className="admin-error" role="alert">{error}</p>}
        </li>
    );
}
