import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MultiplayerSummary } from '@/components/MultiplayerSummary';
import type { MultiplayerModesDto } from '@/types/game';

/** A game IGDB says nothing multiplayer about, unless a test says otherwise. */
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

describe('MultiplayerSummary', () => {
    it('names the ways to play together, couch co-op and online co-op first', () => {
        render(<MultiplayerSummary modes={modes({ dropIn: true, splitScreen: true, onlineCoop: true, offlineCoop: true })} />);

        expect(screen.getAllByText(/co-op|split screen|drop-in/i).map(chip => chip.textContent))
            .toEqual(['Local co-op', 'Online co-op', 'Split screen', 'Drop-in / drop-out']);
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

    // #318: the component says only co-op ceilings are shown, and falls back to the lobby's.
    it.skip('never offers a competitive lobby size as how many can play together (#318)', () => {
        // `onlineMax` counts a sixty-four-player match, which says nothing about playing together and
        // is, by the component's own account, the number people misread.
        render(<MultiplayerSummary modes={modes({ onlineMax: 64, offlineMax: 8 })} />);

        expect(screen.queryByText(/^Up to/)).not.toBeInTheDocument();
    });
});
