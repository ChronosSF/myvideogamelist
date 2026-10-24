import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameCardSkeleton } from '@/components/GameCardSkeleton';
import { LoadingState } from '@/components/LoadingState';
import { Skeleton } from '@/components/Skeleton';

/** Read from disk: Vitest hands a stylesheet import back empty, and jsdom applies no CSS anyway. */
const stylesheet = readFileSync(resolve(__dirname, 'Skeleton.css'), 'utf8');

describe('Skeleton', () => {
    it('is a shape only, hidden from assistive technology', () => {
        const { container } = render(<Skeleton className="block h-4 w-20" />);

        expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
        expect(container.firstElementChild).toHaveClass('skeleton', 'block', 'h-4', 'w-20');
    });

    it('leaves the sheen to the skeleton around it, one per card rather than one per shape', () => {
        // A card has fourteen shapes, so a sheen on each would move a hundred and sixty-eight things
        // across a page of twelve cards, where one per card moves twelve.
        const { container } = render(<GameCardSkeleton />);

        expect(container.querySelectorAll('.skeleton-sheen')).toHaveLength(1);
        expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(1);
        expect(stylesheet).not.toMatch(/\.skeleton::after/);
    });

    it('holds its sheen still for anybody who has asked for less motion', () => {
        // jsdom evaluates no media query, so the rule is read where it is written.
        const reduced = stylesheet.slice(stylesheet.indexOf('@media (prefers-reduced-motion: reduce)'));

        expect(reduced).toMatch(/\.skeleton-sheen::after\s*{[^}]*animation:\s*none/);
    });

    it('fills with a token, and shades with nothing but translucent white', () => {
        // ADR 0049 allows translucent white as a sheen because it shades rather than colours. Any
        // other colour function, or any hex, would be a colour written outside the palette.
        expect(stylesheet).toContain('background-color: var(--color-raised)');
        expect(stylesheet).not.toMatch(/#[0-9a-f]{3,8}\b/i);

        const colours = stylesheet.match(/\b(?:rgba?|hsla?)\([^)]*\)/g) ?? [];
        expect(colours.length).toBeGreaterThan(0);
        for (const colour of colours) expect(colour).toMatch(/^rgba\(255, 255, 255, 0?\.\d+\)$/);
    });
});

describe('LoadingState', () => {
    it('says in words what is loading, and hides the shapes from assistive technology', () => {
        render(
            <LoadingState label="Loading your lists…">
                <Skeleton className="block h-4" />
            </LoadingState>,
        );

        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Loading your lists…');
        expect(status.nextElementSibling).toHaveAttribute('aria-hidden', 'true');
        // Not busy: it is replaced rather than updated, so nothing would clear it, and a screen
        // reader may hold back what a busy region holds, the sentence included.
        expect(status.closest('[aria-busy]')).toBeNull();
    });
});
