import type { ReleaseEntry } from '@/types/releases';

/**
 * How wide `ReleaseCard`'s cover is drawn: its 3.5rem column less the cover's border (`ReleaseCard.css`).
 * The two-week line's marks ask for the same, so a release day's cover is fetched once for the mark and
 * its row.
 */
export const RELEASE_COVER_SIZES = 'calc(3.5rem - 2px)';

/** A key for an entry among its day's or its band's: its group, or its one release, by id. */
export function releaseEntryKey(entry: Pick<ReleaseEntry, 'groupName' | 'releases'>): string {
    return `${entry.groupName ?? ''}|${entry.releases.map(r => r.gameId).join(',')}`;
}
