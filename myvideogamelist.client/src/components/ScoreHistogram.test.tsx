import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreHistogram } from '@/components/ScoreHistogram';
import type { ScoreStats } from '@/types/stats';

const SCORED: ScoreStats = {
    scored: 4,
    mean: 8.25,
    distribution: [0, 0, 0, 0, 0, 1, 1, 1, 1, 0],
};

const NOTHING_SCORED: ScoreStats = {
    scored: 0,
    mean: null,
    distribution: Array<number>(10).fill(0),
};

/**
 * The same component renders the owner's own profile and a stranger's, so the only thing that can
 * go wrong quietly is the copy: a chart that is correct while the sentence beside it addresses the
 * wrong person. Hence both wordings, and hence the negative assertions.
 */
describe("ScoreHistogram on the reader's own profile", () => {
    it('labels the columns in the second person', () => {
        render(<ScoreHistogram scores={SCORED} />);

        expect(screen.getByRole('list', { name: 'Your scores, from 1 to 10' }))
            .toBeInTheDocument();
    });

    it('asks for a score when there are none, because the reader can supply one', () => {
        render(<ScoreHistogram scores={NOTHING_SCORED} />);

        expect(screen.getByText('No scores yet. Rate a game and this fills in.'))
            .toBeInTheDocument();
    });
});

describe("ScoreHistogram on somebody else's profile", () => {
    it('names whose scores these are', () => {
        render(<ScoreHistogram scores={SCORED} owner="Nadia" />);

        expect(screen.getByRole('list', { name: "Nadia's scores, from 1 to 10" }))
            .toBeInTheDocument();
        expect(screen.queryByRole('list', { name: /^Your scores/ })).not.toBeInTheDocument();
    });

    it('does not tell a visitor to go and rate a game', () => {
        // The empty columns are not the visitor's to fill, so the call to action would be a
        // request they cannot act on for an account that is not theirs.
        render(<ScoreHistogram scores={NOTHING_SCORED} owner="Nadia" />);

        expect(screen.getByText('Nadia has not scored anything yet.')).toBeInTheDocument();
        expect(screen.queryByText(/rate a game/i)).not.toBeInTheDocument();
    });
});
