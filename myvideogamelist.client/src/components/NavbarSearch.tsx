import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router';
import { ScoreBadge } from '@/components/ScoreBadge';
import { MAX_SEARCH_LENGTH, type SearchAnswer, useGameSearch } from '@/hooks/useGameSearch';
import { formatCount } from '@/lib/format';
import { searchPagePath } from '@/lib/gameBrowse';
import { releaseYear } from '@/lib/releaseDate';
import { criticScoreWords, hasCriticScore } from '@/lib/score';
import { useHydrated } from '@/lib/useHydrated';
import type { GameDto } from '@/types/game';
import './NavbarSearch.css';

interface NavbarSearchProps {
    /**
     * Whether the box is open below lg, where it hangs from the bar behind a button. Held by the
     * navbar, which keeps it and the bar's two menus from sharing the screen.
     */
    panelOpen: boolean;
    onPanelOpenChange: (open: boolean) => void;
}

/** One array for "nothing listed", so a render that lists nothing does not look like a new list. */
const NO_GAMES: GameDto[] = [];

const MAGNIFIER = 'M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z';

/**
 * IGDB's small cover, ninety pixels wide, rather than the card-sized one: the thumbnail is drawn at
 * 36×48, and six of the larger size would be most of what the dropdown costs to show.
 */
function thumbnail(url: string): string {
    return url.replace('/t_cover_big/', '/t_cover_small/');
}

function reviewCount(count: number): string {
    return `${formatCount(count)} review${count === 1 ? '' : 's'}`;
}

function gameCount(count: number): string {
    return `${count} ${count === 1 ? 'game' : 'games'}`;
}

/**
 * What an option is called: its title, its year, which tells a game from its own re-release, and its
 * critic score said in words — or why there is none.
 */
function optionName(game: GameDto): string {
    const year = game.releaseDate === null ? '' : `, ${releaseYear(game.releaseDate)}`;
    return `${game.title}${year}. ${criticScoreWords(game)}`;
}

/**
 * The critic score once it rests on `MIN_CRITIC_REVIEWS` reviews, or a dash with the count when it
 * rests on fewer. The cards leave a badge out under the floor; here the row has a column for it, and
 * a bare dash would read as "no score" where the truth is "a score from too few reviews to mean
 * anything" — so the count goes under it (ADR 0016).
 */
function CriticScore({ game }: { game: GameDto }) {
    if (hasCriticScore(game)) {
        return <ScoreBadge kind="critics" percent={game.criticScore!} count={game.criticScoreCount} />;
    }

    const count = game.criticScoreCount ?? 0;
    return (
        <span className="navbar-search-unscored">
            <span className="navbar-search-dash">—</span>
            {count === 0 ? 'no reviews' : reviewCount(count)}
        </span>
    );
}

/**
 * The search box on every page, with a typeahead over `/api/games?search=`.
 *
 * Server-rendered as a plain GET form to `/games`, which searches before any script has loaded — in
 * the bar from lg, and below it through a link to the browse page in place of the button, since the
 * panel the button opens needs the script. It turns into an ARIA combobox once hydrated, never
 * before: a combobox that cannot open its list would promise assistive technology something it
 * cannot do. Enter on the box, or "See all results", opens the browse page for the term; an option
 * opens its game.
 *
 * What it asks of the API, and how often, is `useGameSearch`'s business.
 */
export function NavbarSearch({ panelOpen, onPanelOpenChange }: NavbarSearchProps) {
    const hydrated = useHydrated();
    const navigate = useNavigate();
    const location = useLocation();

    const [query, setQuery] = useState('');
    // Whether the dropdown may show: the reader is in the box and has not dismissed it.
    const [open, setOpen] = useState(false);
    // The highlighted option's index, or -1 for none.
    const [active, setActive] = useState(-1);

    const search = useGameSearch(query, open);

    // The answer on screen. Kept while the next term waits for its own, so the list does not blank
    // out at every pause, and dropped once there is nothing to ask about, so a new word does not
    // open on an old word's games.
    const [shown, setShown] = useState<SearchAnswer | null>(null);
    if (search.status === 'answered' && shown !== search.answer) setShown(search.answer);
    if (search.status === 'idle' && shown !== null) setShown(null);

    const games = search.status === 'failed' ? NO_GAMES : shown?.games ?? NO_GAMES;

    // A different list puts the highlight back on the box, or it would sit on whichever game took the
    // old one's place.
    const [listed, setListed] = useState(games);
    if (listed !== games) {
        setListed(games);
        setActive(-1);
    }

    // Any navigation empties the box and closes it — an option or a search followed, a link
    // elsewhere, the back button. Adjusted during render, as the navbar does for its menus.
    const [lastLocationKey, setLastLocationKey] = useState(location.key);
    if (lastLocationKey !== location.key) {
        setLastLocationKey(location.key);
        setQuery('');
        setOpen(false);
        setActive(-1);
    }

    // The panel closing takes the dropdown with it, and stops the asking along with it.
    const [lastPanelOpen, setLastPanelOpen] = useState(panelOpen);
    if (lastPanelOpen !== panelOpen) {
        setLastPanelOpen(panelOpen);
        if (!panelOpen) {
            setOpen(false);
            setActive(-1);
        }
    }

    const id = useId();
    const formId = `${id}-form`;
    const listboxId = `${id}-listbox`;
    const optionId = (game: GameDto) => `${id}-game-${game.id}`;

    const inputRef = useRef<HTMLInputElement | null>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);

    // Whatever was typed into the server-rendered box before the script arrived. Hydration leaves it
    // in the field but not in `query`, and the next commit — the one that makes the box a combobox —
    // would write the empty `query` over it, mid-word. So it is taken into state as the field is
    // attached, and a box already focused is open.
    const attachInput = useCallback((node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (node === null || node.value === '') return;
        setQuery(node.value);
        if (node === document.activeElement) setOpen(true);
    }, []);

    const term = search.term;
    const popupShown = hydrated && open && search.status !== 'idle';
    const expanded = popupShown && games.length > 0;
    const activeGame = expanded && active >= 0 ? games[active] : undefined;
    const activeId = activeGame === undefined ? undefined : optionId(activeGame);

    useEffect(() => {
        if (activeId !== undefined) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
    }, [activeId]);

    /**
     * Done with the box: the dropdown and the phone's panel close at once, rather than when the next
     * page has loaded, and the box empties when it has.
     */
    const leave = () => {
        setOpen(false);
        setActive(-1);
        onPanelOpenChange(false);
        inputRef.current?.blur();
    };

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        leave();
        navigate(searchPagePath(query));
    };

    const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        // Mid-composition the keys belong to the input method: its Enter commits a word.
        if (event.nativeEvent.isComposing) return;

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                if (!open) setOpen(true);
                else if (expanded) setActive(index => (index + 1) % games.length);
                return;
            case 'ArrowUp':
                if (!expanded) return;
                event.preventDefault();
                setActive(index => (index <= 0 ? games.length - 1 : index - 1));
                return;
            case 'Enter':
                if (activeGame === undefined) return; // The form submits: the search in full.
                event.preventDefault();
                leave();
                navigate(`/games/${activeGame.id}`);
                return;
        }
    };

    /**
     * Escape takes off one layer at a time: the dropdown, then the panel it sits in, then the text.
     * On the wrapper, so it works from the dropdown's own button as well as from the box. Every
     * layer it takes off is prevented, or a search input's own Escape would empty the box as well.
     */
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;

        if (popupShown) {
            event.preventDefault();
            // Focus first: focusing the box opens it, so from the dropdown's button the close has to
            // come after or the box's own focus handler undoes it.
            inputRef.current?.focus();
            setOpen(false);
            setActive(-1);
        } else if (panelOpen) {
            event.preventDefault();
            onPanelOpenChange(false);
            toggleRef.current?.focus();
        } else if (event.target === inputRef.current && query !== '') {
            event.preventDefault();
            setQuery('');
        }
    };

    /**
     * Focus leaving the box closes it, as the navbar's menus close. Focus going nowhere is the one
     * exception, in the panel: on a phone that is the keyboard being put away, and whoever did it is
     * still reading the results. The panel has a scrim, a button and Escape to close it with.
     */
    const onBlur = (event: FocusEvent<HTMLDivElement>) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        if (next === null && panelOpen) return;

        setOpen(false);
        setActive(-1);
        if (panelOpen) onPanelOpenChange(false);
    };

    // The dropdown shows at most six of a search's games, so a count is said as the first of more
    // when there are more: "6 games found" would name the dropdown's size as the search's.
    const announcement = !popupShown ? ''
        : search.status === 'failed' ? search.message
        : search.status !== 'answered' ? ''
        : search.answer.games.length === 0 ? `No games found for ${term}.`
        : search.answer.hasMore ? `First ${gameCount(search.answer.games.length)} for ${term}. Press Enter for all results.`
        : `${gameCount(search.answer.games.length)} found for ${term}.`;

    return (
        <div className="navbar-search" data-open={panelOpen || undefined} onKeyDown={onKeyDown} onBlur={onBlur}>
            {hydrated ? (
                <button
                    ref={toggleRef}
                    type="button"
                    className="navbar-search-toggle"
                    aria-label="Search"
                    aria-expanded={panelOpen}
                    aria-controls={formId}
                    onClick={() => {
                        if (panelOpen) {
                            onPanelOpenChange(false);
                            return;
                        }
                        // Committed first, because the box is not displayed until it is, and focused
                        // within the tap itself, which is the only way iOS raises the keyboard for it.
                        flushSync(() => onPanelOpenChange(true));
                        inputRef.current?.focus();
                    }}
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d={panelOpen ? 'M6 18L18 6M6 6l12 12' : MAGNIFIER}
                        />
                    </svg>
                </button>
            ) : (
                // Before the script: the browse page, whose own box searches. A plain anchor, the
                // same markup on the server and in the hydrating render, swapped for the button after.
                <a href="/games" className="navbar-search-toggle" aria-label="Search">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={MAGNIFIER} />
                    </svg>
                </a>
            )}

            <form id={formId} role="search" action="/games" method="get" className="navbar-search-form" onSubmit={submit}>
                <div className="navbar-search-field">
                    <svg className="navbar-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={MAGNIFIER} />
                    </svg>
                    <input
                        ref={attachInput}
                        type="search"
                        name="search"
                        value={query}
                        onChange={event => {
                            setQuery(event.target.value);
                            setOpen(true);
                            setActive(-1);
                        }}
                        onFocus={() => setOpen(true)}
                        onKeyDown={onInputKeyDown}
                        placeholder="Search games…"
                        aria-label="Search games"
                        maxLength={MAX_SEARCH_LENGTH}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        enterKeyHint="search"
                        className="navbar-search-input"
                        {...(hydrated ? {
                            role: 'combobox',
                            'aria-autocomplete': 'list' as const,
                            'aria-expanded': expanded,
                            'aria-controls': listboxId,
                            'aria-activedescendant': activeId,
                        } : {})}
                    />
                </div>

                {hydrated && (
                    // A press anywhere in here must not take focus from the box, or the box's blur
                    // would close the dropdown before the press became a click.
                    <div className="navbar-search-popup" hidden={!popupShown} onMouseDown={event => event.preventDefault()}>
                        <div
                            role="listbox"
                            id={listboxId}
                            aria-label="Games"
                            aria-busy={search.status === 'waiting'}
                            hidden={!expanded}
                        >
                            {games.map((game, index) => (
                                <Link
                                    key={game.id}
                                    id={optionId(game)}
                                    role="option"
                                    aria-selected={index === active}
                                    aria-label={optionName(game)}
                                    to={`/games/${game.id}`}
                                    tabIndex={-1}
                                    className="navbar-search-option"
                                    onClick={leave}
                                >
                                    {game.coverImageUrl === null ? (
                                        <span className="navbar-search-cover" />
                                    ) : (
                                        <img
                                            src={thumbnail(game.coverImageUrl)}
                                            alt=""
                                            className="navbar-search-cover"
                                            loading="lazy"
                                            decoding="async"
                                        />
                                    )}
                                    <span className="navbar-search-text">
                                        <span className="navbar-search-title">{game.title}</span>
                                        {game.releaseDate !== null && (
                                            <span className="navbar-search-year">{releaseYear(game.releaseDate)}</span>
                                        )}
                                    </span>
                                    <CriticScore game={game} />
                                </Link>
                            ))}
                        </div>

                        {search.status === 'waiting' && games.length === 0 && (
                            <p className="navbar-search-message">Searching…</p>
                        )}

                        {search.status === 'answered' && games.length === 0 && (
                            <p className="navbar-search-message">No games found for “{term}”.</p>
                        )}

                        {search.status === 'failed' && (
                            <div className="navbar-search-message navbar-search-failed">
                                <p>{search.message}</p>
                                {search.canRetry && (
                                    <button
                                        type="button"
                                        className="navbar-search-retry"
                                        onClick={() => {
                                            // The box first: this button goes the moment the retry
                                            // starts, and focus left on it would drop to the page,
                                            // leaving the dropdown open with nothing to close it.
                                            inputRef.current?.focus();
                                            search.retry();
                                        }}
                                    >
                                        Try again
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Out of the tab order, like the options: Tab leaves a combobox, and
                            Enter on the box already does what this does. */}
                        {expanded && (
                            <Link to={searchPagePath(term)} className="navbar-search-all" tabIndex={-1} onClick={leave}>
                                See all results for “{term}”
                            </Link>
                        )}
                    </div>
                )}

                {hydrated && <div role="status" className="sr-only">{announcement}</div>}
            </form>
        </div>
    );
}
