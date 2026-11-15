import { useEffect, useId, useRef } from 'react';
import type { GameDto } from '@/types/game';
import type { PlaythroughDto, PlaythroughInputDto } from '@/types/playthrough';
import { type PromptKind, PROMPT_WORDS } from '@/lib/playthroughPrompt';
import { PlaythroughForm } from '@/components/PlaythroughForm';
import './LoginDialog.css';
import './GameYours.css';
import './PlaythroughPopup.css';

interface PlaythroughPopupProps {
    game: GameDto;
    /** What the yes did, which decides the field focused first: the hours after a finish. */
    kind: PromptKind;
    /** The run the yes wrote, which the form opens on. */
    playthrough: PlaythroughDto;
    saving: boolean;
    error: string | null;
    onSubmit: (input: PlaythroughInputDto) => void;
    /** Takes the popup away; the provider puts focus back where it was before the toast was reached. */
    onClose: () => void;
}

/**
 * The playthrough form, opened in place on the run a yes just wrote (ADR 0097): from the lists page, a
 * card or the game page alike, with no navigation and no second toast.
 *
 * A native modal `<dialog>`, as the site's other dialogs are: the page behind it is inert, Tab stays
 * inside, and Escape is a `cancel` event wherever focus is. On a phone it is a sheet across the bottom.
 * It does not close on a press outside it, unlike the report dialog: what is typed into a form is not
 * worth losing to a stray tap on the scrim. The form is the Your game tab's own, with its fields in the
 * same order, and the popup's stylesheet sizes them for a dialog; after a finish, the hours are focused,
 * since they are what the reader was asked for.
 *
 * Fetched only once a yes has been said (`PlaythroughPromptProvider`), so neither the form nor its styles
 * are on every page.
 */
export function PlaythroughPopup({ game, kind, playthrough, saving, error, onSubmit, onClose }: PlaythroughPopupProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();

    // Opened once it is in the document, which `showModal` needs, and then the first field focused: React's
    // `autoFocus` would run while the dialog is still closed. The `open` check is Strict Mode's second run.
    useEffect(() => {
        const element = dialog.current;
        if (element === null || element.open) return;

        element.showModal();
        const first = element.querySelector<HTMLElement>('[data-focus-first]')
            ?? element.querySelector<HTMLElement>('select, input, textarea');
        first?.focus();
    }, []);

    return (
        <dialog
            ref={dialog}
            className="dialog-modal playthrough-popup"
            aria-labelledby={titleId}
            // Escape: prevented, and the dialog closed by unmounting, so the page and the browser agree.
            onCancel={event => {
                event.preventDefault();
                onClose();
            }}
            onClose={onClose}
        >
            <div className="playthrough-popup-panel">
                <div className="flex flex-col gap-2 min-w-0">
                    <p className="type-kicker text-xs text-fg-faint truncate">{PROMPT_WORDS.kicker(game.title)}</p>
                    <h2 id={titleId} className="type-display text-[28px] max-sm:text-2xl leading-[0.95] text-fg-strong">
                        {PROMPT_WORDS.popupTitle}
                    </h2>
                </div>
                <PlaythroughForm
                    platforms={game.platforms}
                    editing={playthrough}
                    onSubmit={onSubmit}
                    onCancel={onClose}
                    pending={saving}
                    error={error}
                    focusField={kind === 'finish' ? 'hours' : undefined}
                />
            </div>
        </dialog>
    );
}
