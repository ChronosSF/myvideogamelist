import type { MultiplayerModesDto } from '@/types/game';

interface MultiplayerSummaryProps {
    modes: MultiplayerModesDto;
}

/**
 * Turns the capability flags into the phrases a person actually searches for. Order matters:
 * couch co-op and online co-op are the two people care about most, so they lead.
 */
function capabilities(modes: MultiplayerModesDto): string[] {
    const labels: string[] = [];

    if (modes.offlineCoop) labels.push('Local co-op');
    if (modes.onlineCoop) labels.push('Online co-op');
    if (modes.campaignCoop) labels.push('Campaign co-op');
    if (modes.splitScreen) labels.push('Split screen');
    if (modes.lanCoop) labels.push('LAN co-op');
    if (modes.dropIn) labels.push('Drop-in / drop-out');

    return labels;
}

/**
 * How a game can be played with other people, folded across platforms by the API.
 *
 * Renders nothing when IGDB reports no capability and no player ceiling — a heading over an
 * empty row implies the data is missing when the honest reading is that the game is
 * single-player.
 */
export function MultiplayerSummary({ modes }: MultiplayerSummaryProps) {
    const labels = capabilities(modes);

    // Only the co-op ceilings are shown. `onlineMax` and `offlineMax` count competitive lobbies
    // too, which says nothing about playing *together* and is the number people misread.
    const online = modes.onlineCoopMax ?? modes.onlineMax;
    const offline = modes.offlineCoopMax ?? modes.offlineMax;

    if (labels.length === 0 && online === null && offline === null) return null;

    return (
        <div className="flex flex-wrap items-center gap-2">
            {labels.map(label => (
                <span
                    key={label}
                    className="px-2.5 py-1 bg-purple-900/40 light:bg-purple-50 text-purple-300 light:text-purple-700 text-xs font-medium rounded-full border border-purple-800/50 light:border-purple-200"
                >
                    {label}
                </span>
            ))}

            {online !== null && (
                <span className="text-xs text-slate-400 light:text-slate-500">
                    Up to {online} online
                </span>
            )}
            {offline !== null && (
                <span className="text-xs text-slate-400 light:text-slate-500">
                    Up to {offline} locally
                </span>
            )}
        </div>
    );
}
