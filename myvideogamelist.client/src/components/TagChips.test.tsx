import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TagChips } from '@/components/TagChips';
import { tag } from '@/test/factories';

const TAGS = [
    tag({ id: 1, name: 'Co-op' }),
    tag({ id: 2, name: 'short' }),
    tag({ id: 3, name: 'with Sam' }),
    tag({ id: 4, name: 'replay' }),
];

describe('TagChips', () => {
    it('draws nothing for a game with no tags', () => {
        const { container } = render(<TagChips tags={[]} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('lists every tag when there is no limit', () => {
        render(<TagChips tags={TAGS} />);

        const list = screen.getByRole('list', { name: 'Your tags' });
        expect(within(list).getAllByRole('listitem').map(item => item.textContent))
            .toEqual(['Co-op', 'short', 'with Sam', 'replay']);
    });

    it('folds the rest into a count past the limit, still naming them to a screen reader', () => {
        render(<TagChips tags={TAGS} max={2} />);

        const items = within(screen.getByRole('list', { name: 'Your tags' })).getAllByRole('listitem');
        expect(items).toHaveLength(3);
        expect(items[2]).toHaveTextContent('+2');
        expect(items[2]).toHaveTextContent('and with Sam, replay');
        expect(items[2]).toHaveAttribute('title', 'with Sam, replay');
    });
});
