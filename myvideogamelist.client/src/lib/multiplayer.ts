import type { MultiplayerModesDto } from '@/types/game';

/** What How to play says about playing a game with other people. */
export interface MultiplayerSummaryText {
    /** The capabilities, as the phrases a person actually searches for. */
    labels: string[];
    /** The co-op ceilings, online and locally, where IGDB knows them. */
    online: number | null;
    offline: number | null;
}

/**
 * The capability flags as the phrases a person actually searches for, and the co-op ceilings; or
 * null when there is nothing to say. Order matters: couch co-op and online co-op are the two people
 * care about most, so they lead.
 *
 * Only the co-op ceilings are shown. `onlineMax` and `offlineMax` count competitive lobbies too, which
 * says nothing about playing *together* and is the number people misread — so a game whose co-op
 * ceiling IGDB does not know shows none, never its lobby size in its place.
 *
 * Null rather than an empty summary, so that the game page can leave out the section's heading as
 * well as the row: a heading over nothing implies the data is missing, when the honest reading is
 * that the game is played alone.
 */
export function multiplayerSummary(modes: MultiplayerModesDto): MultiplayerSummaryText | null {
    const labels: string[] = [];

    if (modes.offlineCoop) labels.push('Local co-op');
    if (modes.onlineCoop) labels.push('Online co-op');
    if (modes.campaignCoop) labels.push('Campaign co-op');
    if (modes.splitScreen) labels.push('Split screen');
    if (modes.lanCoop) labels.push('LAN co-op');
    if (modes.dropIn) labels.push('Drop-in / drop-out');

    const online = modes.onlineCoopMax;
    const offline = modes.offlineCoopMax;

    return labels.length === 0 && online === null && offline === null ? null : { labels, online, offline };
}
