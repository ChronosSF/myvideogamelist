import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MultiplayerSummary } from '@/components/MultiplayerSummary';
import type { MultiplayerModesDto } from '@/types/game';

/**
 * A game IGDB says nothing multiplayer about, unless a test says otherwise. Built here rather than in
 * `src/test/factories.ts`, which most of the open PRs are also editing, so that this file adds to it
 * nothing to conflict with.
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

/** The ways to play together the summary names, in its order. */
const named = () => screen.queryAllByText(/co-op|split screen|drop-in/i).map(chip => chip.textContent);

describe('MultiplayerSummary', () => {
    it('names every way to play together, local and online co-op first', () => {
        render(<MultiplayerSummary modes={modes({
            dropIn: true, lanCoop: true, splitScreen: true, campaignCoop: true, onlineCoop: true, offlineCoop: true,
        })} />);

        expect(named()).toEqual(['Local co-op', 'Online co-op', 'Campaign co-op', 'Split screen', 'LAN co-op', 'Drop-in / drop-out']);
    });

    it('says how many can play together, online and on one machine', () => {
        render(<MultiplayerSummary modes={modes({ onlineCoop: true, offlineCoop: true, onlineCoopMax: 4, offlineCoopMax: 2 })} />);

        expect(screen.getByText('Up to 4 online')).toBeInTheDocument();
        expect(screen.getByText('Up to 2 locally')).toBeInTheDocument();
    });

    it('renders nothing for a game with no way to play together, rather than an empty row', () => {
        const { container } = render(<MultiplayerSummary modes={modes()} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('never offers a competitive lobby size as how many can play together', () => {
        // A co-op game whose co-op ceilings IGDB does not know, and whose matches hold sixty-four.
        // `onlineMax` says nothing about playing together and is, by the component's own account, the
        // number people misread.
        render(<MultiplayerSummary modes={modes({ onlineCoop: true, offlineCoop: true, onlineMax: 64, offlineMax: 8 })} />);

        expect(named()).toEqual(['Local co-op', 'Online co-op']);
        expect(screen.queryByText(/^Up to/)).not.toBeInTheDocument();
    });
});
