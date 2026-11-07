import type { Route } from './+types/GameOverviewPage';
import { CompletionTimes } from '@/components/CompletionTimes';
import { GameCommunity } from '@/components/GameCommunity';
import { GameNewsPanel } from '@/components/GameNewsPanel';
import { GameRefRail } from '@/components/GameRefRail';
import { MultiplayerSummary } from '@/components/MultiplayerSummary';
import { RelatedGamesRail } from '@/components/RelatedGamesRail';
import { ScoreBadge } from '@/components/ScoreBadge';
import { ScreenshotGallery } from '@/components/ScreenshotGallery';
import { SectionHeading } from '@/components/SectionHeading';
import { StoreLinks } from '@/components/StoreLinks';
import { TrailerPlayer } from '@/components/TrailerPlayer';
import { useAuth } from '@/hooks/useAuth';
import { useFavourites } from '@/hooks/useFavourites';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { formatCount } from '@/lib/format';
import { useGamePage } from '@/lib/gamePage';
import { multiplayerSummary } from '@/lib/multiplayer';
import { releaseDay } from '@/lib/releaseDate';
import { hasCriticScore, hasMemberScore, ratingPercent } from '@/lib/score';

/**
 * The game page's own policy, handed on: the game's hour at the edge for a render its loader answered whole,
 * nothing shared for one it did not, and a thrown Response's own (`GamePage`'s `headers`). Stated here rather
 * than left to React Router's passing on a parent's to a child with none, so that this route says what it
 * goes out with, as every route does (ADR 0013).
 */
export function headers({ parentHeaders, errorHeaders }: Route.HeadersArgs) {
    return {
        'Cache-Control': errorHeaders?.get('Cache-Control')
            ?? parentHeaders.get('Cache-Control')
            ?? PRIVATE_NO_STORE,
    };
}

/** A term from IGDB's vocabulary — a platform, a theme, a mode — as an outlined chip in the metadata type. */
function InfoChip({ label }: { label: string }) {
    return (
        <span className="px-2.5 py-1 type-meta text-fg-soft rounded-sm border border-line-strong">
            {label}
        </span>
    );
}

/** One fact in the rail's list of them: its label in small capitals, and what it is. */
const FACT = 'py-3 border-b border-line';
const FACT_LABEL = 'type-kicker text-fg-faint mb-1';

const EXTERNAL_LINK = 'M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14';

/**
 * The game page's Overview tab (ADR 0084): what the game is, for everybody. Its series first, since
 * that is what a reader goes on to (issue 450); then the reading column — the description, how long it
 * takes, what members thought, where to play it, the trailer and screenshots, its add-ons, its news, and
 * last what IGDB thinks is like it — beside a rail of the facts, which suit scanning.
 *
 * Rendered outside the reader's own entry (`GameEntryProvider`), so that a signed-in reader's arrival
 * does not remount it: nothing here is theirs but the marks the site's own providers draw.
 */
export default function GameOverviewPage() {
    const { game, memberScores, community } = useGamePage();
    const { user } = useAuth();

    // The reader's own, for the rosette on the rails' covers. Empty in the server render and until the
    // favourites arrive, so the shared-cached page is the same for everybody (ADR 0064).
    const { isFavourite } = useFavourites();

    // Null on the listing endpoints by design; this page is the one that asks IGDB for it.
    const details = game.details;

    // Collections and franchises both mean "series" to a reader and frequently repeat each
    // other, so they are merged and deduplicated rather than shown as two identical rows.
    const series = details
        ? [...new Set([...details.collections, ...details.franchises])]
        : [];

    const releaseDate = releaseDay(game.releaseDate);

    const youtubeEmbedId = game.trailerUrl
        ? new URLSearchParams(new URL(game.trailerUrl).search).get('v')
        : null;

    const hasModes = details !== null && (details.gameModes.length > 0
        || (details.multiplayerModes !== null && multiplayerSummary(details.multiplayerModes) !== null));

    return (
        <div className="space-y-14">
            {/* Keyed on the game, as the trailer is: this tab stays mounted from one game to the next, and a
                rail that outlived its game would carry an "Add these to Backlog?" asked about one series onto
                the next, and open a long series where the last one opened. */}
            {details?.related && (
                <RelatedGamesRail
                    key={game.id}
                    related={details.related}
                    gameId={game.id}
                    seriesNames={details.collections}
                />
            )}

            <div className="flex flex-col lg:flex-row gap-14">
                <div className="flex-1 min-w-0 space-y-12">
                    {/* The page's lede, with a drop cap: the one passage on it that is read rather than
                        scanned. */}
                    {game.description && (
                        <section>
                            <SectionHeading>About</SectionHeading>
                            <p className="game-page-lede max-w-prose text-fg text-[1.0625rem] leading-relaxed whitespace-pre-line">
                                {game.description}
                            </p>
                        </section>
                    )}

                    {/* The headline answer to "should I start this?". Renders its own section and decides
                        for itself whether it has anything to show — its second row comes from our own
                        members and is fetched on the client, so this cannot know. */}
                    <CompletionTimes timeToBeat={details?.timeToBeat ?? null} gameId={game.id} />

                    {/* Third, where a reader deciding about the game looks next. It arrives after
                        hydration, and all it can push down when it does is what follows it. Renders
                        nothing until both of its requests have answered, and nothing at all when there is
                        nothing to read. Handed the scores the hero shows, so that a request that failed
                        leaves the two agreeing on the loader's figure. */}
                    <GameCommunity
                        community={{ ...community, scores: memberScores }}
                        viewer={user?.userName ?? null}
                    />

                    {/* Where it is sold. Hides itself when IGDB names no store. */}
                    <StoreLinks stores={details?.stores ?? []} />

                    {/* Trailer. Keyed on the game: the page stays mounted from one game to the next, and a
                        player still pressed for the last game would load this one's from YouTube, and start
                        it playing, without anybody asking. */}
                    {youtubeEmbedId && (
                        <section>
                            <SectionHeading>Trailer</SectionHeading>
                            <TrailerPlayer
                                key={game.id}
                                videoId={youtubeEmbedId}
                                title={game.title}
                                poster={details?.screenshots[0] ?? game.backgroundImageUrl ?? null}
                            />
                        </section>
                    )}

                    {details && details.screenshots.length > 0 && (
                        <section>
                            <SectionHeading>Screenshots</SectionHeading>
                            <ScreenshotGallery screenshots={details.screenshots} gameTitle={game.title} />
                        </section>
                    )}

                    {/* Expansions and DLC are the same thing to a reader deciding what else to buy, so
                        they share one rail — apart from the series above, which is other games. */}
                    {details && (details.expansions.length > 0 || details.dlcs.length > 0) && (
                        <section>
                            <SectionHeading>Expansions &amp; DLC</SectionHeading>
                            <GameRefRail
                                games={[...details.expansions, ...details.dlcs]}
                                label={`Expansions and DLC for ${game.title}`}
                                isFavourite={isFavourite}
                            />
                        </section>
                    )}

                    {/* Hides itself when the game has no Steam presence (ROADMAP N7). */}
                    <GameNewsPanel gameId={game.id} />

                    {/* Last in the column: it sends people away from this page, so everything about the
                        game itself gets read first. A recommendation, not a connection (issue 450). */}
                    {details && details.similarGames.length > 0 && (
                        <section>
                            <SectionHeading>Similar games</SectionHeading>
                            <GameRefRail
                                games={details.similarGames}
                                label={`Games similar to ${game.title}`}
                                isFavourite={isFavourite}
                            />
                        </section>
                    )}
                </div>

                {/* The facts, as a list under a heavy rule. */}
                <aside className="lg:w-80 rule-heavy self-start" aria-labelledby="game-details">
                    <p id="game-details" className="type-kicker text-fg-muted pt-4 pb-1">The details</p>
                    {releaseDate && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Release Date</p>
                            <p className="text-sm text-fg-strong font-medium">{releaseDate}</p>
                        </div>
                    )}

                    {/* The one place the sample size is on the page rather than in a tooltip. ADR 0016: a
                        score without its count is not shippable. */}
                    {hasCriticScore(game) && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Critic Score</p>
                            <ScoreBadge kind="critics" percent={game.criticScore!} count={game.criticScoreCount} />
                            <span className="ml-2 text-xs text-fg-faint" aria-hidden="true">
                                from {formatCount(game.criticScoreCount!)} reviews
                            </span>
                        </div>
                    )}

                    {game.rating !== null && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Player Rating</p>
                            <ScoreBadge kind="players" percent={ratingPercent(game.rating)} count={game.ratingCount} />
                            {game.ratingCount !== null && (
                                <span className="ml-2 text-xs text-fg-faint" aria-hidden="true">
                                    from {formatCount(game.ratingCount)} ratings
                                </span>
                            )}
                        </div>
                    )}

                    {/* Ours, with its count in words beside it like the two above, and in the server render
                        like them. Google shows a rating from structured data only when a reader can see it
                        on the page (ADR 0069). Each count is for the eye only: the badge's accessible name
                        already ends with it. */}
                    {hasMemberScore(memberScores) && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Member Score</p>
                            <ScoreBadge kind="members" percent={ratingPercent(memberScores.mean)} count={memberScores.scored} />
                            <span className="ml-2 text-xs text-fg-faint" aria-hidden="true">
                                from {formatCount(memberScores.scored)} scores
                            </span>
                        </div>
                    )}

                    {game.developers.length > 0 && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Developer{game.developers.length > 1 ? 's' : ''}</p>
                            <p className="text-sm text-fg-strong font-medium">
                                {game.developers.map(dev => dev.name).join(', ')}
                            </p>
                        </div>
                    )}

                    {game.publishers.length > 0 && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Publisher{game.publishers.length > 1 ? 's' : ''}</p>
                            <p className="text-sm text-fg-strong font-medium">
                                {game.publishers.map(pub => pub.name).join(', ')}
                            </p>
                        </div>
                    )}

                    {game.genres.length > 0 && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Genres</p>
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {game.genres.map(genre => <InfoChip key={genre.id} label={genre.name} />)}
                            </div>
                        </div>
                    )}

                    {/* A second axis on genre — "Open world", "Horror" — so beside it. */}
                    {details && details.themes.length > 0 && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Themes</p>
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {details.themes.map(theme => <InfoChip key={theme} label={theme} />)}
                            </div>
                        </div>
                    )}

                    {game.platforms.length > 0 && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Platforms</p>
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {game.platforms.map(platform => <InfoChip key={platform.id} label={platform.name} />)}
                            </div>
                        </div>
                    )}

                    {/* How to play: solo, together, and with how many. No row at all when neither the modes
                        nor the summary have anything to say. */}
                    {details && hasModes && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>How to play</p>
                            <div className="space-y-2 mt-1.5">
                                {details.gameModes.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {details.gameModes.map(mode => <InfoChip key={mode} label={mode} />)}
                                    </div>
                                )}
                                {details.multiplayerModes && <MultiplayerSummary modes={details.multiplayerModes} />}
                            </div>
                        </div>
                    )}

                    {game.esrbRating && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>ESRB Rating</p>
                            <span className="px-2 py-0.5 bg-raised border border-line-strong text-fg text-sm font-mono rounded">
                                {game.esrbRating}
                            </span>
                        </div>
                    )}

                    {series.length > 0 && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Series</p>
                            <p className="text-sm text-fg font-medium">{series.join(', ')}</p>
                        </div>
                    )}

                    {details && details.playerPerspectives.length > 0 && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Perspective</p>
                            <p className="text-sm text-fg font-medium">{details.playerPerspectives.join(', ')}</p>
                        </div>
                    )}

                    {details && details.gameEngines.length > 0 && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Engine{details.gameEngines.length > 1 ? 's' : ''}</p>
                            <p className="text-sm text-fg font-medium">{details.gameEngines.join(', ')}</p>
                        </div>
                    )}

                    {/* A dozen-plus languages would dominate the rail, so they collapse. A native <details>
                        needs no JavaScript and so survives SSR intact. */}
                    {details && details.languages.length > 0 && (
                        <details className={`group ${FACT}`}>
                            <summary className="type-kicker text-fg-faint cursor-pointer hover:text-fg-soft transition-colors">
                                Languages ({details.languages.length})
                            </summary>
                            <ul className="mt-2 space-y-1.5">
                                {details.languages.map(entry => (
                                    <li key={entry.language} className="text-xs">
                                        <span className="text-fg font-medium">{entry.language}</span>
                                        {entry.supportTypes.length > 0 && (
                                            <span className="text-fg-faint"> — {entry.supportTypes.join(', ')}</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}

                    {game.website && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Website</p>
                            <a
                                href={game.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm font-semibold text-link break-all"
                            >
                                Official Site{' '}
                                <span className="sr-only">(opens in a new tab)</span>
                                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={EXTERNAL_LINK} />
                                </svg>
                            </a>
                        </div>
                    )}

                    {game.trailerUrl && !youtubeEmbedId && (
                        <div className={FACT}>
                            <p className={FACT_LABEL}>Trailer</p>
                            <a
                                href={game.trailerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm font-semibold text-link"
                            >
                                Watch Trailer{' '}
                                <span className="sr-only">(opens in a new tab)</span>
                                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={EXTERNAL_LINK} />
                                </svg>
                            </a>
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}
