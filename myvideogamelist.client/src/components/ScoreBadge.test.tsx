import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreBadge } from '@/components/ScoreBadge';

describe('ScoreBadge', () => {
    it('shows the score out of 100', () => {
        render(<ScoreBadge kind="critics" percent={93} count={12} />);

        expect(screen.getByText('93')).toBeInTheDocument();
    });

    it('says which aggregate it is', () => {
        render(<ScoreBadge kind="players" percent={88} count={2400} />);

        expect(screen.getByText('players')).toBeInTheDocument();
    });

    it('carries the sample size for assistive tech, not only in the tooltip', () => {
        // ADR 0016 again: the number on its own is the thing that misleads.
        render(<ScoreBadge kind="critics" percent={93} count={12} />);

        expect(screen.getByText('Critic score: 93 out of 100, from 12 reviews')).toBeInTheDocument();
    });

    it('puts the same sentence in the tooltip for everyone else', () => {
        render(<ScoreBadge kind="critics" percent={93} count={12} />);

        expect(screen.getByTitle('Critic score: 93 out of 100, from 12 reviews')).toBeInTheDocument();
    });

    it('drops the word in the square variant, which sits on cover art', () => {
        render(<ScoreBadge variant="square" kind="critics" percent={93} count={12} />);

        expect(screen.getByText('93')).toBeInTheDocument();
        expect(screen.queryByText('critics')).not.toBeInTheDocument();
    });

    it('drops the word in the plain variant, which sits in a table cell', () => {
        render(<ScoreBadge variant="plain" kind="players" percent={71} count={30} />);

        expect(screen.getByText('71')).toBeInTheDocument();
        expect(screen.queryByText('players')).not.toBeInTheDocument();
    });

    it('still names itself to assistive tech in the variants that drop the word', () => {
        // Which is what makes dropping it acceptable: a bare "71" in a column would say nothing.
        render(<ScoreBadge variant="plain" kind="players" percent={71} count={30} />);

        expect(screen.getByText('Player rating: 71 out of 100, from 30 ratings')).toBeInTheDocument();
    });

    it('colours a good score differently from a poor one', () => {
        const { container: good } = render(<ScoreBadge kind="critics" percent={90} count={9} />);
        const { container: poor } = render(<ScoreBadge kind="critics" percent={30} count={9} />);

        expect(good.firstElementChild!.className).not.toBe(poor.firstElementChild!.className);
    });
});
