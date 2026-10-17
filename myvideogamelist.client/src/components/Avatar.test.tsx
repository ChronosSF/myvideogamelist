import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { Avatar } from '@/components/Avatar';

const PICTURE = 'https://avatars.githubusercontent.com/u/9919?v=4';

/**
 * The avatar is decorative and kept out of the accessibility tree — the name beside it is what is
 * read — so these look for the circle and the image themselves rather than by a role neither is
 * meant to have.
 */
function renderAvatar(avatarUrl: string | null, onUnavailable?: (url: string) => void) {
    const view = render(
        <Avatar userName="alex" avatarUrl={avatarUrl} className="test-avatar" onUnavailable={onUnavailable} />,
    );
    const circle = () => view.container.querySelector('.avatar')!;
    const image = () => view.container.querySelector('img');
    return { ...view, circle, image };
}

describe('Avatar', () => {
    it('is the handle\'s initial when there is no picture', () => {
        const { circle, image } = renderAvatar(null);

        expect(image()).toBeNull();
        expect(circle()).toHaveTextContent('A');
        expect(circle()).toHaveAttribute('aria-hidden', 'true');
        expect(circle()).toHaveClass('test-avatar');
    });

    it('asks for the picture as little as a picture can be asked for', () => {
        // No referrer, so the host does not learn which page it is on; anonymously, so no cookie goes
        // to the host or is kept from it; lazily; and as decoration.
        const { image } = renderAvatar(PICTURE);

        expect(image()).toHaveAttribute('src', PICTURE);
        expect(image()).toHaveAttribute('referrerpolicy', 'no-referrer');
        expect(image()).toHaveAttribute('crossorigin', 'anonymous');
        expect(image()).toHaveAttribute('loading', 'lazy');
        expect(image()).toHaveAttribute('alt', '');
    });

    it('never asks a host the page would refuse', () => {
        const { image, circle } = renderAvatar('https://example.com/me.png');

        expect(image()).toBeNull();
        expect(circle()).toHaveTextContent('A');
    });

    it('puts the initial back when the picture fails to load, and says which failed', () => {
        const unavailable = vi.fn();
        const { image, circle } = renderAvatar(PICTURE, unavailable);

        fireEvent.error(image()!);

        expect(image()).toBeNull();
        expect(circle()).toHaveTextContent('A');
        expect(unavailable).toHaveBeenCalledWith(PICTURE);
    });

    it('puts the initial back for a picture that failed before React was listening', () => {
        // The server renders the <img> and the browser starts loading it before hydration, so an
        // address that fails fast fires its error to nobody. Mounting asks the image instead. The
        // address is in capitals so that the one reported is the one stored, not the browser's
        // rewriting of it.
        vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
        vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
        const stored = 'HTTPS://I.IMGUR.COM/removed.png';
        const unavailable = vi.fn();

        const { image, circle } = renderAvatar(stored, unavailable);

        expect(image()).toBeNull();
        expect(circle()).toHaveTextContent('A');
        expect(unavailable).toHaveBeenCalledWith(stored);
    });

    it('keeps a picture that had already loaded by then', () => {
        vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
        vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(460);
        const unavailable = vi.fn();

        const { image } = renderAvatar(PICTURE, unavailable);

        expect(image()).toHaveAttribute('src', PICTURE);
        expect(unavailable).not.toHaveBeenCalled();
    });

    it('gives a new address its own chance after the last one failed', () => {
        const { image, rerender } = renderAvatar(PICTURE);
        fireEvent.error(image()!);
        expect(image()).toBeNull();

        const next = 'https://i.imgur.com/removed.png';
        rerender(<Avatar userName="alex" avatarUrl={next} className="test-avatar" />);

        expect(image()).toHaveAttribute('src', next);
    });
});
