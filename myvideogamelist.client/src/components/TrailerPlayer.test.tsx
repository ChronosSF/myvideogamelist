import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TrailerPlayer } from '@/components/TrailerPlayer';

const POSTER = 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/sc1.jpg';

describe('TrailerPlayer', () => {
    it('loads nothing from YouTube until asked: no player, and no thumbnail of theirs', () => {
        const { container } = render(<TrailerPlayer videoId="abc123" title="God of War" poster={POSTER} />);

        expect(container.querySelector('iframe')).toBeNull();
        const images = [...container.querySelectorAll('img')].map(image => image.getAttribute('src'));
        expect(images).toEqual([POSTER]);
        expect(screen.getByRole('button', { name: /Play trailer/ })).toBeInTheDocument();
    });

    it('loads the privacy-enhanced player on a press, already playing, and hands it the focus', async () => {
        const actor = userEvent.setup();
        render(<TrailerPlayer videoId="abc123" title="God of War" poster={null} />);

        await actor.click(screen.getByRole('button', { name: /Play trailer/ }));

        const player = screen.getByTitle('God of War trailer');
        expect(player).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abc123?autoplay=1');
        expect(player).toHaveFocus();
        expect(screen.queryByRole('button', { name: /Play trailer/ })).toBeNull();
    });
});
