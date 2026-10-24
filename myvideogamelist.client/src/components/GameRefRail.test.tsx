import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { GameRefRail } from '@/components/GameRefRail';
import type { GameRefDto } from '@/types/game';

const THREE: GameRefDto[] = [1, 2, 3].map(id => ({
    id,
    name: `Game ${id}`,
    coverImageUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/co${id}.jpg`,
}));

const SIZES = '(min-width: 40rem) calc(8rem - 2px), calc(7rem - 2px)';

describe('GameRefRail covers', () => {
    it('waits for every cover until it is scrolled near, as a game page rail far below the fold should', () => {
        const { container } = render(<MemoryRouter><GameRefRail games={THREE} label="Similar games" /></MemoryRouter>);

        const covers = [...container.querySelectorAll('img')];
        expect(covers.map(cover => cover.getAttribute('loading'))).toEqual(['lazy', 'lazy', 'lazy']);
        expect(covers.map(cover => cover.getAttribute('decoding'))).toEqual(['async', 'async', 'async']);
        expect(covers[0]).toHaveAttribute('sizes', `auto, ${SIZES}`);
    });

    it('loads as many as it is told to with the page, for a rail at the top of one', () => {
        const { container } = render(
            <MemoryRouter><GameRefRail games={THREE} label="alex's favourite games" eager={2} /></MemoryRouter>,
        );

        const covers = [...container.querySelectorAll('img')];
        expect(covers.map(cover => cover.getAttribute('loading'))).toEqual(['eager', 'eager', 'lazy']);
        expect(covers[0]).toHaveAttribute('sizes', SIZES);
    });
});
