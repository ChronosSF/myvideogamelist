import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoverImage } from '@/components/CoverImage';

const COVER = 'https://images.igdb.com/igdb/image/upload/t_cover_big/co4p0f.jpg';

describe('CoverImage', () => {
    it('offers the smaller sizes for the width it is drawn at, and keeps the big one as its source', () => {
        render(<CoverImage url={COVER} alt="Celeste cover" sizes="126px" />);

        const img = screen.getByRole('img', { name: 'Celeste cover' });
        expect(img).toHaveAttribute('src', COVER);
        expect(img.getAttribute('srcset')).toContain('/t_cover_small/co4p0f.jpg 90w');
        expect(img.getAttribute('srcset')).toContain('/t_cover_small_2x/co4p0f.jpg 180w');
    });

    it("lets a lazy cover be chosen by its laid-out width, with the caller's width for a browser that cannot", () => {
        // A lazy image is fetched only after layout, which is what `auto` reads; a browser that does
        // not know the keyword skips it.
        render(<CoverImage url={COVER} alt="Celeste cover" sizes="126px" />);

        expect(screen.getByRole('img', { name: 'Celeste cover' })).toHaveAttribute('sizes', 'auto, 126px');
    });

    it("gives an eager cover only the caller's width, since it is chosen before there is a layout", () => {
        render(<CoverImage url={COVER} alt="Celeste cover" sizes="176px" eager />);

        expect(screen.getByRole('img', { name: 'Celeste cover' })).toHaveAttribute('sizes', '176px');
    });

    it('reserves its box before it loads', () => {
        render(<CoverImage url={COVER} alt="Celeste cover" sizes="126px" />);

        const img = screen.getByRole('img', { name: 'Celeste cover' });
        expect(img).toHaveAttribute('width', '264');
        expect(img).toHaveAttribute('height', '352');
    });

    it('waits until it is scrolled near, and decodes off the main thread, by default', () => {
        render(<CoverImage url={COVER} alt="Celeste cover" sizes="126px" />);

        const img = screen.getByRole('img', { name: 'Celeste cover' });
        expect(img).toHaveAttribute('loading', 'lazy');
        expect(img).toHaveAttribute('decoding', 'async');
    });

    it('loads with the page when it may be the largest first paint, and is never lazy then', () => {
        // A lazy largest paint waits for layout before it can start, which makes it slower.
        render(<CoverImage url={COVER} alt="Celeste cover" sizes="176px" eager />);

        const img = screen.getByRole('img', { name: 'Celeste cover' });
        expect(img).toHaveAttribute('loading', 'eager');
        expect(img).not.toHaveAttribute('decoding');
    });

    it('loads a URL it does not recognise as given, with no sizes to mislead the browser', () => {
        render(<CoverImage url="https://example.com/cover.jpg" alt="A cover" sizes="126px" />);

        const img = screen.getByRole('img', { name: 'A cover' });
        expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
        expect(img).not.toHaveAttribute('srcset');
        expect(img).not.toHaveAttribute('sizes');
    });
});
