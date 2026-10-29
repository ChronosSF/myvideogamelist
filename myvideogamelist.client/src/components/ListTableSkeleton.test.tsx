import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ListTable } from '@/components/ListTable';
import { ListTableSkeleton } from '@/components/ListTableSkeleton';
import { NewsCard } from '@/components/NewsCard';
import { NewsCardSkeleton } from '@/components/NewsCardSkeleton';
import { DEFAULT_SORT } from '@/lib/listSort';
import { entry } from '@/test/factories';

/**
 * The classes of the boxes a size comes from, compared between the real thing and its skeleton. jsdom
 * lays nothing out, so this is what can be checked here; the heights themselves were measured in a
 * browser and are in the pull request that added these.
 */
const classesOf = (elements: Iterable<Element>) => [...elements]
    // The column's own class. The table also marks its figures `num`, which sets the digits' form and
    // not their size.
    .map(element => (element.getAttribute('class') ?? '').split(' ').find(name => name.startsWith('col-')));

describe('ListTableSkeleton', () => {
    it("is the table's own markup, with the table's columns in its order, header and rows alike", () => {
        const table = render(
            <MemoryRouter>
                <ListTable
                    entries={[entry({ game: { id: 1, title: 'Celeste', coverImageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg' } })]}
                    sort={DEFAULT_SORT}
                    listName="Playing"
                    isPending={() => false}
                    isFavourite={() => false}
                    onSortChange={vi.fn()}
                    onScoreChange={vi.fn()}
                    onRemove={vi.fn()}
                />
            </MemoryRouter>,
        ).container;
        const skeleton = render(<ListTableSkeleton rows={3} />).container;

        expect(skeleton.querySelector('.list-table-scroll > table.list-table')).not.toBeNull();
        expect(classesOf(skeleton.querySelectorAll('thead th'))).toEqual(classesOf(table.querySelectorAll('thead th')));
        expect(classesOf(skeleton.querySelectorAll('tbody tr:first-child td')))
            .toEqual(classesOf(table.querySelectorAll('tbody tr:first-child td')));
        expect(skeleton.querySelectorAll('tbody tr')).toHaveLength(3);
    });

    it("gives each row the cover's own box, which is what sets a row's height", () => {
        // Read where the table sets it, so that a change there fails here: jsdom applies no stylesheet.
        const stylesheet = readFileSync(resolve(__dirname, 'ListTable.css'), 'utf8');
        const rule = /\.col-cover img,[^{]*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? '';
        expect(rule).toMatch(/(?<!-)width:\s*2\.25rem/);
        expect(rule).toMatch(/(?<!-)height:\s*3rem/);

        // The bar in its place is those two lengths on Tailwind's quarter-rem scale.
        const { container } = render(<ListTableSkeleton rows={1} />);
        expect(container.querySelector('td.col-cover .skeleton')).toHaveClass('w-9', 'h-12');
    });
});

describe('NewsCardSkeleton', () => {
    it("is drawn in the news card's own frame, with the cover's box beside the words", () => {
        const card = render(
            <MemoryRouter>
                <NewsCard item={{
                    id: 'n1',
                    gameId: 1,
                    gameTitle: 'Hades',
                    gameCoverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg',
                    title: 'Patch 1.1',
                    excerpt: 'Fixes.',
                    url: 'https://example.com/news',
                    source: 'Steam',
                    publishedAt: '2026-10-01T10:00:00Z',
                }}
                />
            </MemoryRouter>,
        ).container.firstElementChild!;
        const skeleton = render(<NewsCardSkeleton />).container.firstElementChild!;

        for (const name of ['flex', 'gap-4', 'py-5', 'border-b', 'border-line']) {
            expect(card).toHaveClass(name);
            expect(skeleton).toHaveClass(name);
        }
        // The cover is 3rem by 4rem in both.
        expect(card.querySelector('img')).toHaveClass('w-12', 'h-16');
        expect(skeleton.firstElementChild).toHaveClass('w-12', 'h-16');
    });
});
