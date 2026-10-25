import type { MultiplayerModesDto } from '@/types/game';
import { multiplayerSummary } from '@/lib/multiplayer';

interface MultiplayerSummaryProps {
    modes: MultiplayerModesDto;
}

/**
 * How a game can be played with other people, folded across platforms by the API: the phrases and
 * the co-op ceilings `multiplayerSummary` picks out, and nothing at all when it has nothing to say.
 */
export function MultiplayerSummary({ modes }: MultiplayerSummaryProps) {
    const summary = multiplayerSummary(modes);
    if (summary === null) return null;

    const { labels, online, offline } = summary;

    return (
        <div className="flex flex-wrap items-center gap-2">
            {labels.map(label => (
                <span
                    key={label}
                    className="px-2.5 py-1 bg-multiplayer-900/40 text-multiplayer-300 text-xs font-medium rounded-full border border-multiplayer-800/50"
                >
                    {label}
                </span>
            ))}

            {online !== null && (
                <span className="text-xs text-fg-muted">
                    Up to {online} online
                </span>
            )}
            {offline !== null && (
                <span className="text-xs text-fg-muted">
                    Up to {offline} locally
                </span>
            )}
        </div>
    );
}
