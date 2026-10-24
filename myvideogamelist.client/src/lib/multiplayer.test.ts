import { describe, expect, it } from 'vitest';
import { multiplayerSummary } from '@/lib/multiplayer';
import type { MultiplayerModesDto } from '@/types/game';

/**
 * No way to play together and no ceilings. Built here rather than in `src/test/factories.ts`, which
 * has no builder for this DTO and which most of the open pull requests are also editing.
 */
function modes(overrides: Partial<MultiplayerModesDto> = {}): MultiplayerModesDto {
    return {
        onlineCoop: false,
        offlineCoop: false,
        campaignCoop: false,
        lanCoop: false,
        splitScreen: false,
        dropIn: false,
        onlineMax: null,
        onlineCoopMax: null,
        offlineMax: null,
        offlineCoopMax: null,
        ...overrides,
    };
}

describe('multiplayerSummary', () => {
    it('has nothing to say for a game whose only figures are lobby sizes', () => {
        // The game page leaves out How to play's heading on this, rather than draw it over nothing.
        expect(multiplayerSummary(modes({ onlineMax: 64, offlineMax: 4 }))).toBeNull();
    });

    it('names the ways to play together, couch and online co-op first, and the co-op ceilings', () => {
        expect(multiplayerSummary(modes({ dropIn: true, onlineCoop: true, offlineCoop: true, onlineCoopMax: 4, onlineMax: 64 })))
            .toEqual({ labels: ['Local co-op', 'Online co-op', 'Drop-in / drop-out'], online: 4, offline: null });
    });

    it('has something to say for a co-op ceiling alone', () => {
        expect(multiplayerSummary(modes({ offlineCoopMax: 2 }))).toEqual({ labels: [], online: null, offline: 2 });
    });
});
