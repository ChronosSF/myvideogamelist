import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScreenshotGallery } from '@/components/ScreenshotGallery';

const SHOTS = [
    'https://images.igdb.com/igdb/image/upload/t_screenshot_big/sc1.jpg',
    'https://images.igdb.com/igdb/image/upload/t_screenshot_big/sc2.jpg',
];

describe('ScreenshotGallery links', () => {
    it('says that each screenshot opens in a new tab', () => {
        render(<ScreenshotGallery screenshots={SHOTS} gameTitle="Celeste" />);

        expect(screen.getByRole('link', { name: 'Celeste screenshot 1 of 2 (opens in a new tab)' })).toHaveAttribute('target', '_blank');
        expect(screen.getByRole('link', { name: 'Celeste screenshot 2 of 2 (opens in a new tab)' })).toHaveAttribute('target', '_blank');
    });
});
