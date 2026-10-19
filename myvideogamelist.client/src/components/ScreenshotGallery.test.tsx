import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScreenshotGallery } from '@/components/ScreenshotGallery';

const SHOTS = [
    'https://images.igdb.com/igdb/image/upload/t_screenshot_big/sc1.jpg',
    'https://images.igdb.com/igdb/image/upload/t_screenshot_big/sc2.jpg',
];

describe('ScreenshotGallery', () => {
    it('numbers each screenshot for a screen reader, out of how many there are', () => {
        render(<ScreenshotGallery screenshots={SHOTS} gameTitle="Celeste" />);

        expect(screen.getAllByRole('img').map(img => img.getAttribute('alt')))
            .toEqual(['Celeste screenshot 1 of 2', 'Celeste screenshot 2 of 2']);
    });

    it('links each one to the full-size image IGDB serves off the same path', () => {
        // The API sends the grid size; the full size differs only in the `t_` segment.
        render(<ScreenshotGallery screenshots={SHOTS} gameTitle="Celeste" />);

        expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
            'https://images.igdb.com/igdb/image/upload/t_1080p/sc1.jpg',
            'https://images.igdb.com/igdb/image/upload/t_1080p/sc2.jpg',
        ]);
    });

    it('renders nothing for a game without screenshots', () => {
        const { container } = render(<ScreenshotGallery screenshots={[]} gameTitle="Celeste" />);

        expect(container).toBeEmptyDOMElement();
    });
});
