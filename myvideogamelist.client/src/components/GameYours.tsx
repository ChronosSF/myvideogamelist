import { useId, useState } from 'react';
import { OWNERSHIPS, OWNERSHIP_NAMES } from '@/types/list';
import { useAuthDialog } from '@/hooks/useAuthDialog';
import { useGameEntry } from '@/hooks/useGameEntry';
import { EntryNotesForm } from '@/components/EntryNotesForm';
import { EntryTagEditor } from '@/components/EntryTagEditor';
import { LoadingState } from '@/components/LoadingState';
import { PlaythroughForm } from '@/components/PlaythroughForm';
import { PlaythroughList } from '@/components/PlaythroughList';
import { ReviewForm } from '@/components/ReviewForm';
import { SkeletonLine } from '@/components/SkeletonLine';
import './GameYours.css';

const PLUS = 'M12 5v14M5 12h14';

interface GameYoursProps {
    /** Auth has not answered: the server render, and the first in the browser. */
    authLoading: boolean;
}

/**
 * The game page's Your game tab (ADR 0084): the reader's review at the reading column's width, their
 * playthroughs beside it, how they have the game, their tags and notes, and the one control that erases
 * the lot. Their list, score, wishlist and favourite are in the hero above, which is drawn from the same
 * entry (`GameEntryProvider`).
 */
export function GameYours({ authLoading }: GameYoursProps) {
    const entry = useGameEntry();
    const authDialog = useAuthDialog();
    const ownershipLabelId = useId();

    // A new run's form, opened by Add. Editing a run opens the same form with that run in it.
    const [adding, setAdding] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    if (entry === null) {
        if (authLoading) {
            return (
                <LoadingState label="Loading your record of this game…" className="max-w-prose">
                    <SkeletonLine width="w-1/3" />
                    <SkeletonLine width="w-full" />
                    <SkeletonLine width="w-5/6" />
                </LoadingState>
            );
        }

        return (
            <section className="rule-heavy pt-4 max-w-prose">
                <h2 className="type-display text-3xl text-fg-strong mb-3">Your game</h2>
                <p className="text-fg-muted mb-5">
                    Sign in to keep your playthroughs, a review, your notes and your tags for this game,
                    beside its list and your score.
                </p>
                <button type="button" onClick={() => authDialog.open('login')} className="px-4 py-2 btn-primary text-sm">
                    Sign in
                </button>
            </section>
        );
    }

    const formOpen = adding || entry.editing !== null;
    const closeForm = () => {
        setAdding(false);
        entry.setEditing(null);
    };

    return (
        <div className="space-y-14">
            <div className="flex flex-col lg:flex-row gap-14 lg:items-start">
                {/* The review, at the reading column's width rather than a sidebar's. */}
                <section aria-labelledby="your-review" className="flex-1 min-w-0 rule-heavy pt-4">
                    <h2 id="your-review" className="type-display text-3xl text-fg-strong mb-5">Your review</h2>
                    <div className="game-yours-review">
                        <ReviewForm
                            review={entry.review}
                            playthroughs={entry.playthroughs}
                            profileVisibility={entry.profileVisibility}
                            onSave={input => void entry.saveReview(input)}
                            onDelete={() => void entry.deleteReview()}
                            pending={!entry.ready || entry.savingReview}
                            error={entry.reviewError}
                        />
                    </div>
                </section>

                {/* The runs, and the form only when one is being logged or edited (issue 222). */}
                <section aria-labelledby="your-playthroughs" className="lg:w-96 xl:w-[26rem] rule-heavy pt-4">
                    <div className="flex items-baseline justify-between gap-3 mb-5">
                        <h2 id="your-playthroughs" className="type-display text-3xl text-fg-strong">Playthroughs</h2>
                        {!formOpen && (
                            <button
                                type="button"
                                onClick={() => setAdding(true)}
                                disabled={!entry.ready}
                                aria-label="Add a playthrough"
                                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 h-9 btn-outline text-sm font-semibold disabled:opacity-60"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={PLUS} />
                                </svg>
                                Add
                            </button>
                        )}
                    </div>
                    <PlaythroughList
                        playthroughs={entry.playthroughs}
                        platforms={entry.game.platforms}
                        onEdit={playthrough => {
                            setAdding(false);
                            entry.setEditing(playthrough);
                        }}
                        onDelete={playthrough => void entry.deletePlaythrough(playthrough)}
                        busyId={entry.deletingPlaythroughId}
                        disabled={!entry.ready || entry.savingPlaythrough}
                    />
                    {formOpen && (
                        <PlaythroughForm
                            platforms={entry.game.platforms}
                            editing={entry.editing}
                            onSubmit={input => {
                                void entry.savePlaythrough(input).then(saved => {
                                    if (saved) setAdding(false);
                                });
                            }}
                            onCancel={closeForm}
                            pending={!entry.ready || entry.savingPlaythrough}
                            error={entry.playthroughError}
                        />
                    )}
                    {!formOpen && entry.playthroughError !== null && (
                        <p className="game-yours-hint" role="alert">{entry.playthroughError}</p>
                    )}
                </section>
            </div>

            {/* The entry's own small fields, in one row. */}
            <section aria-labelledby="your-copy" className="rule-heavy pt-4">
                <h2 id="your-copy" className="type-display text-3xl text-fg-strong mb-5">Your copy, tags and notes</h2>
                <div className="grid gap-10 md:grid-cols-3">
                    {/* Toggles, so pressing the one that is on clears it — in a colour of their own, because
                        this is about the copy and not about the playing. */}
                    <div className="border-t border-line pt-3">
                        <p className="game-yours-label" id={ownershipLabelId}>How you have it</p>
                        <div className="game-yours-lists" role="group" aria-labelledby={ownershipLabelId}>
                            {OWNERSHIPS.map(kind => {
                                const active = entry.ownership === kind;
                                return (
                                    <button
                                        key={kind}
                                        type="button"
                                        className={`game-yours-list-btn game-yours-ownership-btn${active ? ' active' : ''}`}
                                        onClick={() => void entry.changeOwnership(active ? null : kind)}
                                        disabled={!entry.ready || entry.pending}
                                        aria-pressed={active}
                                        title={active ? 'Clear' : `Mark as ${OWNERSHIP_NAMES[kind].toLowerCase()}`}
                                    >
                                        {OWNERSHIP_NAMES[kind]}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="game-yours-hint">
                            {entry.ownership === null
                                ? 'Not recorded. Whether the copy is yours to keep; where you play it goes on a playthrough.'
                                : 'Press it again to clear it.'}
                        </p>
                        {entry.ownershipError !== null && (
                            <p className="game-yours-hint" role="alert">{entry.ownershipError}</p>
                        )}
                    </div>

                    {/* The account's tags are a read of their own, and an editor offered over one that
                        failed would show none of this game's and "create" tags the account already has. */}
                    <div className="border-t border-line pt-3">
                        <EntryTagEditor
                            tags={entry.tags}
                            vocabulary={entry.vocabulary}
                            onAdd={entry.addTag}
                            onCreate={entry.createTag}
                            onRemove={entry.removeTag}
                            busy={entry.pending}
                            disabled={!entry.ready || entry.tagsStatus !== 'ready'}
                            error={entry.tagsError}
                            gameTitle={entry.game.title}
                        />
                        {entry.tagsStatus === 'failed' && (
                            <p className="game-yours-hint" role="alert">
                                Your tags could not be loaded, so they cannot be changed just now.{' '}
                                <button type="button" className="text-link" onClick={entry.reloadTags}>
                                    Try again
                                </button>
                            </p>
                        )}
                    </div>

                    <div className="border-t border-line pt-3">
                        <EntryNotesForm
                            notes={entry.notes}
                            onSave={next => void entry.saveNotes(next)}
                            pending={!entry.ready || entry.pending || entry.savingNotes}
                            error={entry.notesError}
                        />
                    </div>
                </div>
            </section>

            {entry.hasData && (
                <div className="game-yours-danger">
                    {confirmingDelete ? (
                        <>
                            <p className="game-yours-hint">
                                Delete your score, list placement, ownership, tags, notes,
                                playthroughs and review for this game? Your history of moving it
                                between lists is kept, and so are the tags themselves.
                            </p>
                            <div className="game-yours-confirm">
                                <button
                                    type="button"
                                    className="danger"
                                    onClick={() => {
                                        setConfirmingDelete(false);
                                        void entry.deleteAll().then(deleted => {
                                            if (deleted) setAdding(false);
                                        });
                                    }}
                                    disabled={entry.pending}
                                >
                                    Delete
                                </button>
                                <button type="button" onClick={() => setConfirmingDelete(false)}>
                                    Cancel
                                </button>
                            </div>
                        </>
                    ) : (
                        <button
                            type="button"
                            className="game-yours-delete"
                            onClick={() => setConfirmingDelete(true)}
                            disabled={entry.pending}
                        >
                            Delete my data for this game
                        </button>
                    )}
                    {entry.deleteError !== null && (
                        <p className="game-yours-hint" role="alert">{entry.deleteError}</p>
                    )}
                </div>
            )}
        </div>
    );
}
