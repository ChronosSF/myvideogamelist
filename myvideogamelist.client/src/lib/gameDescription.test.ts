import { describe, expect, it } from 'vitest';
import { cutAtWord, DESCRIPTION_LENGTH, firstSentence, gameDescription } from '@/lib/gameDescription';
import { MIN_MEMBER_SCORES, MIN_PLAYTHROUGH_SAMPLES } from '@/lib/score';
import { communityScores, communityTimes } from '@/test/factories';
import type { CommunityScores } from '@/types/community';
import type { CommunityTimes } from '@/types/playthrough';

const WITCHER = 'The Witcher 3: Wild Hunt is a story-driven, next-generation open world role-playing game, '
    + 'set in a visually stunning fantasy universe, full of meaningful choices and impactful consequences. '
    + 'In The Witcher you play as the professional monster hunter, Geralt of Rivia.';

/** The Witcher's summary, with whatever members have recorded about it. */
const describeWitcher = (scores: CommunityScores | null = null, times: CommunityTimes | null = null) =>
    gameDescription({ title: 'The Witcher 3: Wild Hunt', description: WITCHER }, scores, times);

/** A game with a summary of one short sentence, so that a test reads what leads it. */
const describeShort = (scores: CommunityScores | null = null, times: CommunityTimes | null = null) =>
    gameDescription({ title: 'Short', description: 'A short game about a long walk.' }, scores, times);

describe('firstSentence', () => {
    it('is the summary up to its first full stop, with its whitespace folded', () => {
        expect(firstSentence('A knight in a ruined kingdom.\n\nBeneath it, bugs.')).toBe('A knight in a ruined kingdom.');
        expect(firstSentence('  Two   spaces\nand then a line.  ')).toBe('Two spaces and then a line.');
    });

    it('ends at a question, an exclamation or an ellipsis, with what closes after it', () => {
        expect(firstSentence('Can you survive the long night? Probably not.')).toBe('Can you survive the long night?');
        expect(firstSentence('The sign on the door says "Run!" Nobody does.')).toBe('The sign on the door says "Run!"');
        expect(firstSentence('The night is long and very dark… Then it gets darker.')).toBe('The night is long and very dark…');
    });

    it('ends before a sentence that starts with a number or behind a quote', () => {
        expect(firstSentence('A tiny platformer about climbing. 2 players can join.')).toBe('A tiny platformer about climbing.');
        expect(firstSentence('A detective story set in old Rome. "Who did it?" asks everyone.'))
            .toBe('A detective story set in old Rome.');
    });

    it('does not end at a word the title ends the same way', () => {
        // Seen live: these three were each described by the name alone, "Yu-Gi-Oh!" for a whole
        // franchise, before the title was consulted.
        expect(firstSentence(
            'Yu-Gi-Oh! Master Duel lets players old and new enjoy the hugely popular Yu-Gi-Oh! TCG in digital form. '
            + 'Players across the globe can compete.',
            'Yu-Gi-Oh! Master Duel',
        )).toBe('Yu-Gi-Oh! Master Duel lets players old and new enjoy the hugely popular Yu-Gi-Oh! TCG in digital form.');
        expect(firstSentence(
            'A new standalone expansion of Go! Go! Nippon! that includes new sightseeing locations. New gardens too.',
            'Go! Go! Nippon! 2016',
        )).toBe('A new standalone expansion of Go! Go! Nippon! that includes new sightseeing locations.');
        expect(firstSentence(
            'Love Live! School Idol Paradise is a rhythm-action game based on the Love Live! franchise. It came in three.',
            'Love Live! School Idol Paradise: Vol.2 BiBi Unit',
        )).toBe('Love Live! School Idol Paradise is a rhythm-action game based on the Love Live! franchise.');
    });

    it('does not end at an abbreviation written before a name or a number', () => {
        expect(firstSentence('Dr. Mario clears viruses with pills. It came out in 1990.'))
            .toBe('Dr. Mario clears viruses with pills.');
        expect(firstSentence('Super Mario Bros. Wonder is a platformer. It has elephants.'))
            .toBe('Super Mario Bros. Wonder is a platformer.');
        expect(firstSentence('Tetris Ver. 2 adds a mode for everyone. It is fun.')).toBe('Tetris Ver. 2 adds a mode for everyone.');
        expect(firstSentence('There are approx. 10 levels in this short game. Done.'))
            .toBe('There are approx. 10 levels in this short game.');
        expect(firstSentence('It came out on Oct. 25, 2019, to some acclaim. It sold.'))
            .toBe('It came out on Oct. 25, 2019, to some acclaim.');
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

    it('takes no ending before twenty characters for the first sentence’s', () => {
        // Too short to be the sentence that says what the game is: far likelier a name or an
        // abbreviation nobody listed.
        expect(firstSentence('Hello there. This game is about cats and dogs. More.'))
            .toBe('Hello there. This game is about cats and dogs.');
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
        expect(cutAtWord('One two three four five six', 15)).toBe('One two three…');
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
        expect(cutAtWord('Supercalifragilistic', 10)).toBe('Supercali…');
    });

    it('never cuts a character stored as a pair in half', () => {
        // Each of these takes two of JavaScript's characters; a cut between the two leaves half of
        // one, which reaches the page as a replacement mark.
        const cut = cutAtWord('🎮'.repeat(100), 10);

        expect(cut).toBe(`${'🎮'.repeat(4)}…`);
    });
});

describe('gameDescription', () => {
    it('is the summary’s first sentence, cut after a word, when nothing is ours', () => {
        // It used to be the summary's first two hundred characters, wherever they ended.
        expect(describeWitcher()).toBe(
            'The Witcher 3: Wild Hunt is a story-driven, next-generation open world role-playing game, '
            + 'set in a visually stunning fantasy universe, full of meaningful…',
        );
    });

    it('keeps a first sentence that fits whole, and nothing after it', () => {
        expect(gameDescription({ title: 'K', description: 'A knight in a ruined kingdom. Beneath it, bugs.' }, null, null))
            .toBe('A knight in a ruined kingdom.');
    });

    it('leads with what is ours, in order, and ends with the summary', () => {
        expect(describeWitcher(
            communityScores({ tracked: 12, scored: MIN_MEMBER_SCORES + 4, mean: 8.44 }),
            communityTimes({ normally: { samples: MIN_PLAYTHROUGH_SAMPLES + 1, medianMinutes: 52 * 60 } }),
        )).toBe(
            'Tracked by 12 members. Member score 84/100 from 9 scores. '
            + 'Members normally beat it in 52h (median of 4 playthroughs). The Witcher 3: Wild Hunt is a…',
        );
    });

    it('says one member, not one members', () => {
        expect(describeShort(communityScores({ tracked: 1 }))).toBe('Tracked by 1 member. A short game about a long walk.');
    });

    it('prints no member score under the floor — no number, and no sentence for it', () => {
        // Four members averaging 9.9 is four opinions, not a verdict (ADR 0016).
        const description = describeShort(communityScores({ tracked: 6, scored: MIN_MEMBER_SCORES - 1, mean: 9.9 }));

        expect(description).toBe('Tracked by 6 members. A short game about a long walk.');
    });

    it('prints no time under the playthrough floor, or from another tier', () => {
        expect(describeShort(null, communityTimes({ normally: { samples: MIN_PLAYTHROUGH_SAMPLES - 1, medianMinutes: 600 } })))
            .toBe('A short game about a long walk.');
        // Only the "normally" tier is quoted, so the sentence means the same thing on every game.
        expect(describeShort(null, communityTimes({ rushed: { samples: MIN_PLAYTHROUGH_SAMPLES + 5, medianMinutes: 600 } })))
            .toBe('A short game about a long walk.');
    });

    it('says whose time it is, with the number of playthroughs behind it', () => {
        // "Normally" is IGDB's name for a tier as well, and the two sources are never blended.
        expect(describeShort(null, communityTimes({ normally: { samples: MIN_PLAYTHROUGH_SAMPLES, medianMinutes: 95 } })))
            .toBe('Members normally beat it in 1.5h (median of 3 playthroughs). A short game about a long walk.');
    });

    it('fits the longest figures a game could gather, cutting the summary to suit', () => {
        expect(describeWitcher(
            communityScores({ tracked: 123_456, scored: 98_765, mean: 10 }),
            communityTimes({ normally: { samples: 12_345, medianMinutes: 99 * 60 } }),
        )).toBe(
            'Tracked by 123,456 members. Member score 100/100 from 98,765 scores. '
            + 'Members normally beat it in 99h (median of 12,345 playthroughs). The Witcher 3: Wild Hunt…',
        );
    });

    it('ends on its own last figure when too little room is left for the summary to say anything', () => {
        const description = describeWitcher(
            communityScores({ tracked: 1_234_567_890, scored: 1_234_567_890, mean: 10 }),
            communityTimes({ normally: { samples: 1_234_567_890, medianMinutes: 600_000 } }),
        );

        expect(description).toBe(
            'Tracked by 1,234,567,890 members. Member score 100/100 from 1,234,567,890 scores. '
            + 'Members normally beat it in 10000h (median of 1,234,567,890 playthroughs).',
        );
    });

    it('is never longer than the limit, whatever it is given', () => {
        const absurd = communityScores({ tracked: 10 ** 15, scored: 10 ** 15, mean: 10 });

        expect(describeWitcher(absurd, communityTimes({ normally: { samples: 10 ** 15, medianMinutes: 600_000 } })).length)
            .toBeLessThanOrEqual(DESCRIPTION_LENGTH);
        expect(gameDescription({ title: 'T'.repeat(300), description: null }, null, null).length)
            .toBeLessThanOrEqual(DESCRIPTION_LENGTH);
    });

    it('is our figures alone when IGDB has no summary', () => {
        expect(gameDescription({ title: 'T', description: null }, communityScores({ tracked: 2 }), null)).toBe('Tracked by 2 members.');
        expect(gameDescription({ title: 'T', description: '   ' }, communityScores({ tracked: 2 }), null)).toBe('Tracked by 2 members.');
    });

    it('invites tracking the game when there is nothing to say at all', () => {
        expect(gameDescription({ title: 'The Witcher 3: Wild Hunt', description: null }, null, null))
            .toBe('Track The Witcher 3: Wild Hunt on MyVideoGameList.');
    });

    it('leaves out a count an older API did not send, rather than printing nothing as a number', () => {
        // Mid-deploy, a new front end can reach an API that predates the tracked count.
        const { tracked: _, ...older } = communityScores();

        expect(describeShort(older as CommunityScores)).toBe('A short game about a long walk.');
    });
});
