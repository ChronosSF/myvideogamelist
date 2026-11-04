import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PageTabs, type PageTab } from '@/components/PageTabs';

/**
 * A page's tabs (ADR 0084): links, each an address of its own, with the one for the address on screen
 * marked as the current page. The first tab's address is the page's own, which the others extend, so it
 * is current only there.
 */

const TABS: PageTab[] = [
    { to: '/games/1942', label: 'Overview', end: true },
    { to: '/games/1942/yours', label: 'Your game' },
];

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <PageTabs label="This game" tabs={TABS} />
        </MemoryRouter>,
    );
}

describe('PageTabs', () => {
    it('is a navigation named for what the tabs are of, with a link to each tab', () => {
        renderAt('/games/1942');

        const nav = screen.getByRole('navigation', { name: 'This game' });
        const links = within(nav).getAllByRole('link');
        expect(links.map(link => [link.textContent, link.getAttribute('href')])).toEqual([
            ['Overview', '/games/1942'],
            ['Your game', '/games/1942/yours'],
        ]);
    });

    it('marks the first tab as the current page on its own address', () => {
        renderAt('/games/1942');

        expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Your game' })).not.toHaveAttribute('aria-current');
    });

    it('marks only the tab whose address it is under, not the first tab whose address that extends', () => {
        renderAt('/games/1942/yours');

        expect(screen.getByRole('link', { name: 'Your game' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    });
});
