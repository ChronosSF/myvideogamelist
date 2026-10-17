import { useId, useRef, useState } from 'react';
import {
    type TagDto, MAX_TAGS_PER_GAME, TAG_NAME_MAX, compareTags, gamesCarrying, normaliseTagName, sameTagName,
} from '@/types/tag';
import './EntryTagEditor.css';

interface EntryTagEditorProps {
    /** The tags the game carries now, resolved and in name order. */
    tags: TagDto[];
    /** Every tag of the account, which the suggestions are drawn from. */
    vocabulary: TagDto[];
    /** Puts one of the account's tags on the game. */
    onAdd: (tag: TagDto) => void;
    /** Makes a tag of this name — normalised, and new to the account — and puts it on the game. */
    onCreate: (name: string) => void;
    onRemove: (tag: TagDto) => void;
    /**
     * A write to this game is out. Nothing is committed while it is, but nothing is disabled either:
     * a disabled control drops the focus, and the input is where the next tag is being typed.
     */
    busy: boolean;
    /** There is nothing trustworthy to edit — the entry, or the account's tags, did not arrive. */
    disabled: boolean;
    error: string | null;
    gameTitle: string;
}

type Option = { kind: 'tag'; tag: TagDto } | { kind: 'create'; name: string };

/** As many suggestions as fit under the input without scrolling the panel away. */
const MAX_SUGGESTIONS = 8;

/**
 * The account's tags worth offering for what has been typed: those the game does not carry yet, the
 * ones starting with it first, then the most used. With nothing typed, the most used — what an ArrowDown
 * on an empty box opens.
 */
function suggestionsFor(query: string, vocabulary: TagDto[], carried: ReadonlySet<number>): TagDto[] {
    const wanted = normaliseTagName(query).toLowerCase();
    const available = vocabulary.filter(tag => !carried.has(tag.id));
    const byUse = (a: TagDto, b: TagDto) => b.count - a.count || compareTags(a, b);

    if (wanted === '') return [...available].sort(byUse).slice(0, MAX_SUGGESTIONS);

    const starts = (tag: TagDto) => (tag.name.toLowerCase().startsWith(wanted) ? 0 : 1);
    return available
        .filter(tag => tag.name.toLowerCase().includes(wanted))
        .sort((a, b) => starts(a) - starts(b) || byUse(a, b))
        .slice(0, MAX_SUGGESTIONS);
}

/**
 * The tags on one game, and the box that adds more: on the game page's panel, beside the notes and the
 * ownership it shares the entry with.
 *
 * A combobox in the ARIA sense — an input with a list of the account's tags that narrows as it is typed
 * into — and the list is a helper rather than a guess. Enter commits exactly what was typed: the
 * account's tag of that name if it has one, in any letter case, or a new tag made there and then. The
 * suggestions are reached with the arrow keys or the pointer, and nothing is highlighted until one of
 * them is, so a tag nobody chose is never the one that lands.
 *
 * Every change is saved at once, as the ownership toggles are, so there is no Save to forget. While one
 * is out nothing else is committed, and the editor says so rather than silently ignoring the key — but
 * nothing is disabled, because the focus would go with it. Each change is announced in a polite live
 * region, and a failure in an alert.
 */
export function EntryTagEditor({
    tags, vocabulary, onAdd, onCreate, onRemove, busy, disabled, error, gameTitle,
}: EntryTagEditorProps) {
    const id = useId();
    const inputId = `${id}-input`;
    const listboxId = `${id}-listbox`;
    const hintId = `${id}-hint`;
    const headingId = `${id}-heading`;
    const inputRef = useRef<HTMLInputElement>(null);

    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [announcement, setAnnouncement] = useState('');

    const carried = new Set(tags.map(tag => tag.id));
    const full = tags.length >= MAX_TAGS_PER_GAME;
    const typed = normaliseTagName(query);

    // The account's tag with exactly this name, in any case — what Enter means by "this one".
    const exact = typed === '' ? undefined : vocabulary.find(tag => sameTagName(tag.name, typed));
    const alreadyOn = exact !== undefined && carried.has(exact.id);

    const options: Option[] = suggestionsFor(query, vocabulary, carried).map(tag => ({ kind: 'tag', tag }));
    if (typed !== '' && exact === undefined && typed.length <= TAG_NAME_MAX) {
        options.push({ kind: 'create', name: typed });
    }

    const expanded = open && !disabled && !full && options.length > 0;
    const activeOption = expanded && active >= 0 && active < options.length ? options[active] : null;

    const close = () => {
        setOpen(false);
        setActive(-1);
    };

    /** What a press means, given a write may be out. False when it was refused, and says why. */
    const canCommit = () => {
        if (disabled) return false;
        if (busy) {
            setAnnouncement('Still saving your last change. Try again in a moment.');
            return false;
        }
        return true;
    };

    const commit = (option: Option) => {
        if (!canCommit()) return;

        if (option.kind === 'tag') {
            onAdd(option.tag);
            setAnnouncement(`Added ${option.tag.name}.`);
        } else {
            onCreate(option.name);
            setAnnouncement(`Added ${option.name}, a new tag.`);
        }
        setQuery('');
        close();
    };

    const commitTyped = () => {
        if (typed === '') return;

        if (alreadyOn) {
            setAnnouncement(`${exact.name} is already on ${gameTitle}.`);
            setQuery('');
            close();
            return;
        }
        if (exact !== undefined) commit({ kind: 'tag', tag: exact });
        else if (typed.length <= TAG_NAME_MAX) commit({ kind: 'create', name: typed });
    };

    const remove = (tag: TagDto) => {
        if (!canCommit()) return;

        onRemove(tag);
        setAnnouncement(`Removed ${tag.name}.`);
        // The button pressed goes with its chip, so the focus would otherwise fall to the page.
        inputRef.current?.focus();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        switch (event.key) {
            case 'ArrowDown': {
                event.preventDefault();
                if (!expanded) {
                    setOpen(true);
                    setActive(0);
                    return;
                }
                setActive(current => (current + 1) % options.length);
                return;
            }
            case 'ArrowUp': {
                event.preventDefault();
                if (!expanded) {
                    setOpen(true);
                    setActive(options.length - 1);
                    return;
                }
                setActive(current => (current <= 0 ? options.length - 1 : current - 1));
                return;
            }
            case 'Enter': {
                if (activeOption === null && typed === '') return;
                event.preventDefault();
                if (activeOption !== null) commit(activeOption);
                else commitTyped();
                return;
            }
            case 'Escape': {
                if (expanded) {
                    event.preventDefault();
                    close();
                } else if (query !== '') {
                    event.preventDefault();
                    setQuery('');
                }
                return;
            }
            default:
                return;
        }
    };

    return (
        <div className="entry-tags">
            <p className="game-user-panel-label" id={headingId}>Tags</p>

            {tags.length > 0 ? (
                <ul className="entry-tags-chips" aria-labelledby={headingId}>
                    {tags.map(tag => (
                        <li key={tag.id} className="entry-tag">
                            <span className="entry-tag-name" title={tag.name}>{tag.name}</span>
                            <button
                                type="button"
                                className="entry-tag-remove"
                                onClick={() => remove(tag)}
                                disabled={disabled}
                                aria-disabled={busy || undefined}
                                aria-label={`Remove the tag ${tag.name}`}
                                title={`Remove ${tag.name}`}
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="game-user-panel-hint">No tags on this game yet.</p>
            )}

            <div className="entry-tags-combo">
                <label htmlFor={inputId} className="sr-only">{`Add a tag to ${gameTitle}`}</label>
                <input
                    ref={inputRef}
                    id={inputId}
                    type="text"
                    className="entry-tags-input"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={expanded}
                    aria-controls={listboxId}
                    aria-activedescendant={activeOption === null ? undefined : `${listboxId}-${active}`}
                    aria-describedby={hintId}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={TAG_NAME_MAX}
                    placeholder={full ? `At most ${MAX_TAGS_PER_GAME} tags on a game` : 'Add a tag'}
                    value={query}
                    readOnly={full}
                    disabled={disabled}
                    onChange={event => {
                        setQuery(event.target.value);
                        setOpen(event.target.value.trim() !== '');
                        setActive(-1);
                    }}
                    onKeyDown={handleKeyDown}
                    onBlur={close}
                />

                {/* Always in the document, so the input's aria-controls never names nothing; hidden
                    while there is nothing to offer. */}
                <ul
                    id={listboxId}
                    role="listbox"
                    aria-label="Your tags"
                    className="entry-tags-options"
                    hidden={!expanded}
                >
                    {expanded && options.map((option, index) => (
                        <li
                            key={option.kind === 'tag' ? `tag-${option.tag.id}` : 'create'}
                            id={`${listboxId}-${index}`}
                            role="option"
                            aria-selected={index === active}
                            // Named outright, so the count is read as a phrase of its own — "co-op,
                            // 3 games" — rather than run into the name, which is what joining the two
                            // spans' text gives.
                            aria-label={option.kind === 'tag'
                                ? `${option.tag.name}, ${gamesCarrying(option.tag.count)}`
                                : undefined}
                            className={`entry-tags-option${index === active ? ' active' : ''}`}
                            // Keeps the focus in the input, which a press on the list would otherwise
                            // take — and with it the list, on the input's blur, before the click lands.
                            onMouseDown={event => event.preventDefault()}
                            onMouseEnter={() => setActive(index)}
                            onClick={() => commit(option)}
                        >
                            {option.kind === 'tag' ? (
                                <>
                                    <span className="entry-tags-option-name">{option.tag.name}</span>
                                    <span className="entry-tags-option-count">{gamesCarrying(option.tag.count)}</span>
                                </>
                            ) : (
                                <span className="entry-tags-option-name">{`Create “${option.name}”`}</span>
                            )}
                        </li>
                    ))}
                </ul>
            </div>

            <p id={hintId} className="game-user-panel-hint">
                {full
                    ? `A game can carry at most ${MAX_TAGS_PER_GAME} tags. Remove one to add another.`
                    : alreadyOn
                        ? `${exact.name} is already on this game.`
                        : 'Type a tag and press Enter, or pick one of yours. Only you see your tags.'}
            </p>

            <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

            {error !== null && (
                <p className="game-user-panel-hint" role="alert">{error}</p>
            )}
        </div>
    );
}
