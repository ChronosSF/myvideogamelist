import { useEffect, useId, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router';
import { ScoreBadge } from '@/components/ScoreBadge';
import { type SearchAnswer, useGameSearch } from '@/hooks/useGameSearch';
import { formatCount } from '@/lib/format';
import { searchPagePath } from '@/lib/gameBrowse';
import { releaseYear } from '@/lib/releaseDate';
import { aggregateTitle, hasCriticScore } from '@/lib/score';
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

/**
 * IGDB's 90×128 cover rather than the 264×374 one the cards use: the thumbnail is drawn at 36×48,
 * and six of the larger size would be most of what the dropdown costs to show.
 */
function thumbnail(url: string): string {
    return url.replace('/t_cover_big/', '/t_cover_small/');
}

function reviewCount(count: number): string {
    return `${formatCount(count)} review${count === 1 ? '' : 's'}`;
}

/**
 * What an option is called: its title, its year, which tells a game from its own re-release, and its
 * critic score said in words — or why there is none.
 */
function optionName(game: GameDto): string {
    const year = game.releaseDate === null ? '' : `, ${releaseYear(game.releaseDate)}`;
    const count = game.criticScoreCount ?? 0;
    const critics = hasCriticScore(game)
        ? aggregateTitle('critics', game.criticScore!, game.criticScoreCount)
        : count === 0 ? 'No critic reviews' : `Too few critic reviews to score: ${count}`;
    return `${game.title}${year}. ${critics}`;
}

/**
 * The critic score above `MIN_CRITIC_REVIEWS`, as everywhere else, or a dash with the count under
 * it. The count is the reason for the dash: a bare one reads as "no score", where the truth is "a
 * score from too few reviews to mean anything" (ADR 0016).
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
 * Server-rendered as a plain GET form to `/games` — a working search before any script has loaded —
 * and turned into an ARIA combobox once hydrated, never before: a combobox that cannot open its list
 * would promise assistive technology something it cannot do. Enter on the box, or "See all results",
 * opens the browse page for the term; an option opens its game.
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

    const inputRef = useRef<HTMLInputElement>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);

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
     * On the wrapper, so it works from the dropdown's own link and button as well as from the box.
     * Handled even with nothing to close, because a search input's own Escape clears it.
     */
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;

        if (popupShown) {
            event.preventDefault();
            setOpen(false);
            setActive(-1);
            inputRef.current?.focus();
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

    const announcement = !popupShown ? ''
        : search.status === 'failed' ? search.message
        : search.status !== 'answered' ? ''
        : search.answer.games.length === 0 ? `No games found for ${term}.`
        : `${search.answer.games.length} ${search.answer.games.length === 1 ? 'game' : 'games'} found for ${term}.`;

    return (
        <div className="navbar-search" data-open={panelOpen || undefined} onKeyDown={onKeyDown} onBlur={onBlur}>
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
                        d={panelOpen ? 'M6 18L18 6M6 6l12 12' : 'M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z'}
                    />
                </svg>
            </button>

            <form id={formId} role="search" action="/games" method="get" className="navbar-search-form" onSubmit={submit}>
                <div className="navbar-search-field">
                    <svg className="navbar-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                    </svg>
                    <input
                        ref={inputRef}
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
                                <button type="button" className="navbar-search-retry" onClick={search.retry}>
                                    Try again
                                </button>
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
