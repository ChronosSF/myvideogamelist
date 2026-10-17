import { describe, expect, it } from 'vitest';
import { cutAtWord, DESCRIPTION_LENGTH, firstSentence, gameDescription } from '@/lib/gameDescription';
import { MIN_MEMBER_SCORES, MIN_PLAYTHROUGH_SAMPLES } from '@/lib/score';
import type { CommunityScores } from '@/types/community';
import type { CommunityTimes, PlaythroughTypeKey } from '@/types/playthrough';

const WITCHER = 'The Witcher 3: Wild Hunt is a story-driven, next-generation open world role-playing game, '
    + 'set in a visually stunning fantasy universe, full of meaningful choices and impactful consequences. '
    + 'In The Witcher you play as the professional monster hunter, Geralt of Rivia.';

/** Members' scores: how many track the game, how many scored it, and their mean on the 1–10 scale. */
function scores(tracked: number, scored = 0, mean: number | null = scored > 0 ? 8.4 : null): CommunityScores {
    return { tracked, scored, mean, distribution: Array<number>(10).fill(0) };
}

/** Community times with one tier filled in, the others empty. */
function times(samples: number, medianMinutes: number, type: PlaythroughTypeKey = 'normally'): CommunityTimes {
    const empty = (key: PlaythroughTypeKey) => ({ type: key, samples: 0, medianMinutes: null });
    return {
        buckets: (['rushed', 'normally', 'completionist'] as const)
            .map(key => (key === type ? { type: key, samples, medianMinutes } : empty(key))),
    };
}

const describeGame = (summary: string | null, community: CommunityScores | null = null, playtimes: CommunityTimes | null = null) =>
    gameDescription({ title: 'The Witcher 3: Wild Hunt', description: summary }, community, playtimes);

describe('firstSentence', () => {
    it('is the summary up to its first full stop, with its whitespace folded', () => {
        expect(firstSentence('A knight in a ruined kingdom.\n\nBeneath it, bugs.')).toBe('A knight in a ruined kingdom.');
        expect(firstSentence('  Two   spaces\nand a line.  ')).toBe('Two spaces and a line.');
    });

    it('ends at a question or an exclamation, with what closes after it', () => {
        expect(firstSentence('Can you survive the night? Probably not.')).toBe('Can you survive the night?');
        expect(firstSentence('The sign says "Run!" Nobody does.')).toBe('The sign says "Run!"');
    });

    it('does not end at an abbreviation written before a name or a number', () => {
        expect(firstSentence('Dr. Mario clears viruses with pills. It came out in 1990.'))
            .toBe('Dr. Mario clears viruses with pills.');
        expect(firstSentence('Vol. 2 picks up where the first left off. More follows.'))
            .toBe('Vol. 2 picks up where the first left off.');
        expect(firstSentence('Super Mario Bros. Wonder is a platformer. It has elephants.'))
            .toBe('Super Mario Bros. Wonder is a platformer.');
    });

    it('does not end at an initial, or at letters written with stops', () => {
        expect(firstSentence('Based on J. R. R. Tolkien and his books. It follows Frodo.'))
            .toBe('Based on J. R. R. Tolkien and his books.');
        expect(firstSentence('A drive across the U.S. Midwest in a borrowed car. It rains.'))
            .toBe('A drive across the U.S. Midwest in a borrowed car.');
    });

    it('does not end at a stop inside a number, or before a lower-case word', () => {
        expect(firstSentence('A 2.5D platformer about climbing. It is hard.')).toBe('A 2.5D platformer about climbing.');
        expect(firstSentence('Find keys, e.g. brass ones, to open doors. Then leave.'))
            .toBe('Find keys, e.g. brass ones, to open doors.');
    });

    it('is the whole text when no sentence ends inside it', () => {
        expect(firstSentence('A game with no full stop at all')).toBe('A game with no full stop at all');
    });
});

describe('cutAtWord', () => {
    it('leaves text that fits alone', () => {
        expect(cutAtWord('Short enough.', 13)).toBe('Short enough.');
    });

    it('cuts after a whole word, with an ellipsis, inside the limit', () => {
        const cut = cutAtWord('One two three four five six', 15);

        expect(cut).toBe('One two three…');
        expect(cut.length).toBeLessThanOrEqual(15);
    });

    it('keeps a word that ends exactly where the room does', () => {
        // Fourteen characters with the ellipsis: "One two three" is thirteen, and the space after it
        // is where the room ends.
        expect(cutAtWord('One two three four', 14)).toBe('One two three…');
    });

    it('drops a separator left hanging at the cut', () => {
        expect(cutAtWord('Swords, shields, and more besides', 18)).toBe('Swords, shields…');
    });

    it('cuts inside a word only when there is no earlier word to stop after', () => {
        const cut = cutAtWord('Supercalifragilistic', 10);

        expect(cut).toBe('Supercali…');
        expect(cut).toHaveLength(10);
    });
});

describe('gameDescription', () => {
    it('is the summary’s first sentence, not the whole summary cut mid-word, when nothing is ours', () => {
        const description = describeGame(WITCHER);

        expect(description).toBe(cutAtWord(firstSentence(WITCHER), DESCRIPTION_LENGTH));
        expect(description.endsWith('…')).toBe(true);
        expect(description.length).toBeLessThanOrEqual(DESCRIPTION_LENGTH);
        // Cut after a word: what is kept is the summary's start, and the summary does not go on with
        // a letter there — the old cut, at two hundred characters, stopped wherever it fell.
        const kept = description.slice(0, -1);
        expect(WITCHER.startsWith(kept)).toBe(true);
        expect(WITCHER[kept.length]).not.toMatch(/[\p{L}\p{N}]/u);
        // And the second sentence is not reached for.
        expect(description).not.toContain('Geralt');
    });

    it('keeps a first sentence that fits whole, and nothing after it', () => {
        expect(describeGame('A knight in a ruined kingdom. Beneath it, bugs.')).toBe('A knight in a ruined kingdom.');
    });

    it('leads with what is ours, in order, and ends with the summary', () => {
        const description = describeGame(
            WITCHER,
            scores(12, MIN_MEMBER_SCORES + 4, 8.44),
            times(MIN_PLAYTHROUGH_SAMPLES + 1, 52 * 60),
        );

        expect(description.startsWith(
            'Tracked by 12 members. Member score 84/100 from 9 scores. '
            + 'Normally beaten in 52h (median of 4 playthroughs). The Witcher 3',
        )).toBe(true);
        expect(description.length).toBeLessThanOrEqual(DESCRIPTION_LENGTH);
        expect(description.endsWith('…')).toBe(true);
    });

    it('says one member, not one members', () => {
        expect(describeGame('A short game.', scores(1))).toBe('Tracked by 1 member. A short game.');
    });

    it('prints no member score under the floor — no number, and no sentence for it', () => {
        // Four members averaging 9.9 is four opinions, not a verdict (ADR 0016).
        const description = describeGame('A short game.', scores(6, MIN_MEMBER_SCORES - 1, 9.9));

        expect(description).toBe('Tracked by 6 members. A short game.');
        expect(description).not.toMatch(/99|score/i);
    });

    it('prints no time under the playthrough floor, or from another tier', () => {
        expect(describeGame('A short game.', scores(3), times(MIN_PLAYTHROUGH_SAMPLES - 1, 600)))
            .toBe('Tracked by 3 members. A short game.');
        // Only the "normally" tier is quoted, so the sentence means the same thing on every game.
        expect(describeGame('A short game.', scores(3), times(MIN_PLAYTHROUGH_SAMPLES + 5, 600, 'rushed')))
            .toBe('Tracked by 3 members. A short game.');
    });

    it('quotes the time with the number of playthroughs behind it, when nothing else is ours', () => {
        expect(describeGame('A short game.', scores(0), times(MIN_PLAYTHROUGH_SAMPLES, 95)))
            .toBe('Normally beaten in 1.5h (median of 3 playthroughs). A short game.');
    });

    it('stays inside the limit with the longest figures it can print', () => {
        const description = describeGame(
            WITCHER,
            scores(123_456, 98_765, 10),
            times(12_345, 99 * 60 * 60),
        );

        expect(description.length).toBeLessThanOrEqual(DESCRIPTION_LENGTH);
        expect(description).toContain('Tracked by 123,456 members.');
        expect(description).toContain('Member score 100/100 from 98,765 scores.');
        expect(description).toContain('Normally beaten in 5940h (median of 12,345 playthroughs).');
    });

    it('is our figures alone when IGDB has no summary', () => {
        expect(describeGame(null, scores(2))).toBe('Tracked by 2 members.');
        expect(describeGame('   ', scores(2))).toBe('Tracked by 2 members.');
    });

    it('invites tracking the game when there is nothing to say at all', () => {
        expect(describeGame(null)).toBe('Track The Witcher 3: Wild Hunt on MyVideoGameList.');
    });

    it('leaves out a count an older API did not send, rather than printing nothing as a number', () => {
        // Mid-deploy, a new front end can reach an API that predates the tracked count.
        const older = { scored: 0, mean: null, distribution: Array<number>(10).fill(0) } as unknown as CommunityScores;

        const description = describeGame('A short game.', older);

        expect(description).toBe('A short game.');
        expect(description).not.toMatch(/undefined|NaN/);
    });
});
