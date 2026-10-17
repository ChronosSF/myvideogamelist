import type { TagDto } from '@/types/tag';
import './TagChips.css';

interface TagChipsProps {
    /** Already resolved and in name order — see `tagsFor`. Nothing is drawn for none. */
    tags: TagDto[];
    /** How many to draw before the rest become "+2"; every one of them when absent. */
    max?: number;
}

/**
 * A game's tags, read-only and compact: a row of chips under a title or on a card.
 *
 * In orange, the tags' own colour, so the owner's words are never taken for IGDB's genres beside them.
 * A list, so a screen reader says how many there are and reads each; past `max` the rest are one chip
 * whose visible text is a count and whose accessible name says which they are, so nothing is hidden from
 * anybody — only folded.
 */
export function TagChips({ tags, max }: TagChipsProps) {
    if (tags.length === 0) return null;

    const shown = max === undefined ? tags : tags.slice(0, max);
    const folded = tags.slice(shown.length);
    const foldedNames = folded.map(tag => tag.name).join(', ');

    return (
        <ul className="tag-chips" aria-label="Your tags">
            {shown.map(tag => (
                <li key={tag.id} className="tag-chip" title={tag.name}>{tag.name}</li>
            ))}
            {folded.length > 0 && (
                <li className="tag-chips-more" title={foldedNames}>
                    <span aria-hidden="true">+{folded.length}</span>
                    <span className="sr-only">{`and ${foldedNames}`}</span>
                </li>
            )}
        </ul>
    );
}
