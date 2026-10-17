import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { Avatar } from '@/components/Avatar';

const PICTURE = 'https://avatars.githubusercontent.com/u/9919?v=4';

/**
 * The avatar is decorative and hidden from assistive technology — the name beside it is what is
 * read — so these look for the image itself rather than by role, which it deliberately has none of.
 */
function renderAvatar(avatarUrl: string | null, userName = 'alex') {
    const view = render(<Avatar userName={userName} avatarUrl={avatarUrl} className="test-avatar" />);
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
        // No referrer, so the host does not learn which page it is on; lazily; and as decoration.
        const { image } = renderAvatar(PICTURE);

        expect(image()).toHaveAttribute('src', PICTURE);
        expect(image()).toHaveAttribute('referrerpolicy', 'no-referrer');
        expect(image()).toHaveAttribute('loading', 'lazy');
        expect(image()).toHaveAttribute('alt', '');
    });

    it('never asks a host the page would refuse', () => {
        const { image, circle } = renderAvatar('https://example.com/me.png');

        expect(image()).toBeNull();
        expect(circle()).toHaveTextContent('A');
    });

    it('puts the initial back when the picture fails to load', () => {
        const { image, circle } = renderAvatar(PICTURE);

        fireEvent.error(image()!);

        expect(image()).toBeNull();
        expect(circle()).toHaveTextContent('A');
    });

    it('puts the initial back for a picture that failed before React was listening', () => {
        // The server renders the <img> and the browser starts loading it before hydration, so an
        // address that fails fast fires its error to nobody. Mounting asks the image instead.
        vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
        vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);

        const { image, circle } = renderAvatar(PICTURE);

        expect(image()).toBeNull();
        expect(circle()).toHaveTextContent('A');
    });

    it('keeps a picture that had already loaded by then', () => {
        vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
        vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(460);

        const { image } = renderAvatar(PICTURE);

        expect(image()).toHaveAttribute('src', PICTURE);
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
