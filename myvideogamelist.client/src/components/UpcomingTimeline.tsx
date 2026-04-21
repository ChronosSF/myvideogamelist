import { useEffect, useMemo, useState } from 'react';
import type { GameDto, PlatformDto } from '@/types/game';
import { useUpcomingGames } from '@/hooks/useUpcomingGames';
import './UpcomingTimeline.css';

const LS_KEY = 'mvgl_upcoming_disabled_platforms';

// Parse "YYYY-MM-DD" safely into a local-time Date
function parseLocalDate(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function formatDateHeading(dateStr: string): string {
    const date = parseLocalDate(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    if (date.getTime() === today.getTime()) return 'Today';
    if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';

    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function isToday(dateStr: string): boolean {
    const date = parseLocalDate(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date.getTime() === today.getTime();
}

// ─── Inline mini card ────────────────────────────────────────────────────────

interface TimelineGameCardProps {
    game: GameDto;
}

function TimelineGameCard({ game }: TimelineGameCardProps) {
    return (
        <article className="timeline-game-card" title={game.title}>
            {game.coverImageUrl ? (
                <img
                    src={game.coverImageUrl}
                    alt={`${game.title} cover`}
                    className="timeline-game-cover"
                    loading="lazy"
                />
            ) : (
                <div className="timeline-game-cover-placeholder" aria-hidden="true">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                </div>
            )}
            <div className="timeline-game-info">
                <p className="timeline-game-title">{game.title}</p>
                {game.platforms.length > 0 && (
                    <div className="timeline-game-platforms">
                        {game.platforms.slice(0, 3).map(p => (
                            <span key={p.id} className="timeline-platform-tag">
                                {p.abbreviation || p.name}
                            </span>
                        ))}
                        {game.platforms.length > 3 && (
                            <span className="timeline-platform-tag">+{game.platforms.length - 3}</span>
                        )}
                    </div>
                )}
            </div>
        </article>
    );
}

// ─── Platform filter checkbox ─────────────────────────────────────────────────

interface PlatformCheckboxProps {
    platform: PlatformDto;
    checked: boolean;
    onChange: (id: number, checked: boolean) => void;
}

function PlatformCheckbox({ platform, checked, onChange }: PlatformCheckboxProps) {
    return (
        <label className={`platform-filter-label${checked ? ' checked' : ''}`}>
            <input
                type="checkbox"
                checked={checked}
                onChange={e => onChange(platform.id, e.target.checked)}
                aria-label={platform.name}
            />
            {platform.abbreviation || platform.name}
        </label>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function UpcomingTimeline() {
    const { games, loading, error } = useUpcomingGames();

    // Sorted unique platforms across all fetched games
    const allPlatforms = useMemo<PlatformDto[]>(() => {
        const map = new Map<number, PlatformDto>();
        for (const game of games) {
            for (const p of game.platforms) {
                map.set(p.id, p);
            }
        }
        return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [games]);

    // Disabled platform IDs — stored in localStorage so new platforms default to visible
    const [disabledIds, setDisabledIds] = useState<Set<number>>(() => {
        try {
            const saved = localStorage.getItem(LS_KEY);
            if (!saved) return new Set<number>();
            const arr = JSON.parse(saved) as unknown;
            if (Array.isArray(arr)) return new Set(arr.filter((x): x is number => typeof x === 'number'));
        } catch {
            // ignore malformed data
        }
        return new Set<number>();
    });

    // Persist disabled IDs whenever they change
    useEffect(() => {
        localStorage.setItem(LS_KEY, JSON.stringify([...disabledIds]));
    }, [disabledIds]);

    function togglePlatform(id: number, nowChecked: boolean) {
        setDisabledIds(prev => {
            const next = new Set(prev);
            if (nowChecked) next.delete(id); // re-enable
            else next.add(id);              // disable
            return next;
        });
    }

    function selectAll() {
        setDisabledIds(new Set());
    }

    function deselectAll() {
        setDisabledIds(new Set(allPlatforms.map(p => p.id)));
    }

    // Filter & group games by release date
    const dateGroups = useMemo<[string, GameDto[]][]>(() => {
        const filtered = games.filter(game =>
            game.releaseDate !== null &&
            (game.platforms.length === 0 || game.platforms.some(p => !disabledIds.has(p.id)))
        );

        const map = new Map<string, GameDto[]>();
        for (const game of filtered) {
            const key = game.releaseDate!;
            const group = map.get(key) ?? [];
            group.push(game);
            map.set(key, group);
        }

        return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    }, [games, disabledIds]);

    const noResults = !loading && !error && dateGroups.length === 0;

    return (
        <section className="bg-slate-900 light:bg-slate-50 border-t border-slate-700/50 light:border-slate-200">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">

                {/* Section header */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-9 h-9 bg-blue-900/40 border border-blue-700/40 rounded-lg flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-white light:text-slate-900 font-bold text-xl leading-tight">Upcoming Releases</h2>
                        <p className="text-slate-400 light:text-slate-500 text-sm">Next 2 weeks</p>
                    </div>
                </div>

                {/* Platform filters */}
                {!loading && !error && allPlatforms.length > 0 && (
                    <div className="mb-8">
                        <div className="flex items-center gap-3 mb-3">
                            <span className="text-slate-400 light:text-slate-500 text-xs uppercase tracking-wider font-medium">
                                Filter by platform
                            </span>
                            <button
                                onClick={selectAll}
                                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                            >
                                All
                            </button>
                            <span className="text-slate-600 text-xs">·</span>
                            <button
                                onClick={deselectAll}
                                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                            >
                                None
                            </button>
                        </div>
                        <div className="platform-filter-list">
                            {allPlatforms.map(platform => (
                                <PlatformCheckbox
                                    key={platform.id}
                                    platform={platform}
                                    checked={!disabledIds.has(platform.id)}
                                    onChange={togglePlatform}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Loading state */}
                {loading && (
                    <div className="flex items-center gap-3 py-16 justify-center">
                        <div className="w-7 h-7 border-3 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" aria-label="Loading" />
                        <p className="text-slate-400 text-sm">Loading upcoming releases…</p>
                    </div>
                )}

                {/* Error state */}
                {error && (
                    <div className="flex items-center justify-center py-16">
                        <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-8 max-w-md text-center">
                            <svg className="w-9 h-9 text-red-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 4a8 8 0 100 16 8 8 0 000-16z" />
                            </svg>
                            <p className="text-red-300 font-medium mb-1">Failed to load upcoming releases</p>
                            <p className="text-red-400/70 text-sm">{error}</p>
                        </div>
                    </div>
                )}

                {/* Empty state */}
                {noResults && (
                    <div className="flex items-center justify-center py-16">
                        <div className="text-center">
                            <svg className="w-14 h-14 text-slate-700 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <p className="text-slate-400 font-medium">No upcoming releases found.</p>
                            <p className="text-slate-500 text-sm mt-1">
                                {disabledIds.size > 0 ? 'Try enabling more platforms above.' : 'Check back soon!'}
                            </p>
                        </div>
                    </div>
                )}

                {/* Timeline */}
                {!loading && !error && dateGroups.length > 0 && (
                    <div className="timeline-track space-y-8">
                        {dateGroups.map(([dateKey, dayGames]) => (
                            <div key={dateKey} className="timeline-day">
                                {/* Dot */}
                                <div className={`timeline-dot${isToday(dateKey) ? ' today' : ''}`} aria-hidden="true">
                                    <div className="w-2 h-2 rounded-full bg-blue-300 opacity-80" />
                                </div>

                                {/* Date label */}
                                <div className="flex items-baseline gap-2 mb-3">
                                    <h3 className="text-white light:text-slate-900 font-semibold text-base">
                                        {formatDateHeading(dateKey)}
                                    </h3>
                                    {isToday(dateKey) && (
                                        <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-600/30 text-blue-300 border border-blue-500/40 rounded-full">
                                            today
                                        </span>
                                    )}
                                    <span className="text-slate-500 text-xs">
                                        {dayGames.length} {dayGames.length === 1 ? 'game' : 'games'}
                                    </span>
                                </div>

                                {/* Scrollable game row */}
                                <div className="timeline-games-row" role="list" aria-label={`Games releasing ${formatDateHeading(dateKey)}`}>
                                    {dayGames.map(game => (
                                        <div key={game.id} role="listitem">
                                            <TimelineGameCard game={game} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
