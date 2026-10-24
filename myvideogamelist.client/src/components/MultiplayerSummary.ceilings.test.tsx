import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MultiplayerSummary } from '@/components/MultiplayerSummary';
import type { MultiplayerModesDto } from '@/types/game';

/**
 * No way to play together and no ceilings, so each test turns on only what it is about. Built here
 * rather than in `src/test/factories.ts`, which has no builder for this DTO and which most of the
 * open pull requests are also editing.
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

describe('MultiplayerSummary ceilings', () => {
    it('shows the co-op ceilings, online and locally', () => {
        render(<MultiplayerSummary modes={modes({ onlineCoop: true, offlineCoop: true, onlineCoopMax: 4, offlineCoopMax: 2 })} />);

        expect(screen.getByText('Up to 4 online')).toBeInTheDocument();
        expect(screen.getByText('Up to 2 locally')).toBeInTheDocument();
    });

    it('never offers a competitive lobby size as how many can play together', () => {
        // A co-op game whose co-op ceilings IGDB does not know, and whose matches hold sixty-four.
        render(<MultiplayerSummary modes={modes({ onlineCoop: true, offlineCoop: true, onlineMax: 64, offlineMax: 8 })} />);

        expect(screen.getByText('Online co-op')).toBeInTheDocument();
        expect(screen.queryAllByText(/^Up to/)).toHaveLength(0);
    });

    it('draws nothing for a game whose only figure is a lobby size', () => {
        const { container } = render(<MultiplayerSummary modes={modes({ onlineMax: 64, offlineMax: 4 })} />);

        expect(container).toBeEmptyDOMElement();
    });
});
