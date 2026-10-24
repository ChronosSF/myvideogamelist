import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FavouriteMark } from '@/components/FavouriteMark';
import { Rosette } from '@/components/Rosette';

/** The outline an svg draws, so two marks can be told apart by what they are rather than by name. */
const outline = (container: HTMLElement) => container.querySelector('svg path')?.getAttribute('d');

describe('FavouriteMark', () => {
    it('is the rosette, filled — the mark the favourite toggles draw, never a star', () => {
        // Stars are the reader's own score and nothing else (ADR 0021); the mark has to be the same shape
        // as the game page's and the release card's toggles, or it would mean something else.
        const rosette = render(<Rosette filled />).container;
        const mark = render(<FavouriteMark variant="cover" />).container;

        expect(outline(mark)).toBe(outline(rosette));
        expect(mark.querySelector('svg')).toHaveAttribute('fill', 'currentColor');
    });

    it('is named where it follows a title, and is decoration on a cover', () => {
        // On a cover the game's name carries the words instead, since a cover is a link or a button
        // whose name is its own.
        const { container } = render(
            <>
                <FavouriteMark variant="inline" />
                <FavouriteMark variant="cover" />
            </>,
        );

        expect(screen.getByRole('img', { name: 'One of your favourites' })).toBeInTheDocument();
        expect(container.querySelector('.favourite-mark-cover')).toHaveAttribute('aria-hidden', 'true');
    });
});
