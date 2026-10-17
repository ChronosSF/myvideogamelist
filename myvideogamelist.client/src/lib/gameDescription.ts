import type { CommunityScores } from '@/types/community';
import type { GameDto } from '@/types/game';
import type { CommunityTimes } from '@/types/playthrough';
import { formatMinutesPlayed } from '@/lib/duration';
import { formatCount } from '@/lib/format';
import { hasMemberScore, MIN_PLAYTHROUGH_SAMPLES, ratingPercent } from '@/lib/score';

/**
 * A game page's meta description: what MyVideoGameList members have made of the game, then the first
 * sentence of IGDB's summary.
 *
 * The summary alone is what the page said until now, and it is the same text every site built on
 * IGDB has, so a search result showed nothing a reader could not get anywhere else. What only this
 * site knows leads, where it exists: how many members track the game, their score, and how long they
 * take to beat it. Each figure is held to the floor the page holds it to, and travels with its count
 * (ADR 0016) — a description is one more place a score is shown. See `docs/decisions/0069-*`.
 *
 * Built from the loader's data alone, with no clock and no runtime locale, because `meta` runs in the
 * browser too and the two renders must write the same tag.
 */

/**
 * The longest description this writes. Google sets no limit and cuts a snippet "as needed, typically
 * to fit the device width"; this is about what a desktop result shows whole, so the sentence is cut
 * here, at a word, rather than wherever the result runs out of room.
 */
export const DESCRIPTION_LENGTH = 160;

/**
 * The least of the summary's sentence worth keeping after our figures. Below it the fragment says
 * nothing, and the description is better ending on our own last figure.
 */
const MIN_SENTENCE_LENGTH = 20;

/**
 * The tier whose median the description quotes: the middle one, where most logged runs land — the
 * Grouvee import maps both its "Main Story" levels to it (ADR 0050) — and the one IGDB's own
 * "normally" figure answers to. One tier keeps the sentence meaning the same thing on every game.
 */
const QUOTED_TIER = 'normally';

/**
 * Words written with a full stop that does not end a sentence, in lower case. Only the ones that can
 * stand before a capital or a number need listing — "Dr. Mario", "Vol. 2" — since a stop followed by
 * a lower-case word is never taken for an ending anyway.
 */
const ABBREVIATIONS = new Set([
    'bros', 'capt', 'co', 'col', 'corp', 'dr', 'ep', 'feat', 'ft', 'gen', 'inc', 'jr', 'lt', 'ltd',
    'mr', 'mrs', 'ms', 'mt', 'no', 'prof', 'pt', 'sgt', 'sr', 'st', 'vol', 'vs',
]);

/**
 * A run of terminators and anything closing after them, then the space before something that can
 * start a sentence: a capital or a number, perhaps behind an opening quote or bracket.
 */
const SENTENCE_END = /([.!?…]+)(["'”’)\]]*)\s+(?=["'“‘([]?[\p{Lu}\p{N}])/gu;

/** What may trail a cut without meaning anything: a separator left hanging, or a bracket opened. */
const TRAILING_SEPARATORS = /[\s,;:([{"'“‘–—-]+$/u;

/** The description for a game page. */
export function gameDescription(
    game: Pick<GameDto, 'title' | 'description'>,
    scores: CommunityScores | null,
    times: CommunityTimes | null,
): string {
    const ours = ourFigures(scores, times);
    const sentence = firstSentence(game.description ?? '');

    if (sentence === '') return ours || `Track ${game.title} on MyVideoGameList.`;
    if (ours === '') return cutAtWord(sentence, DESCRIPTION_LENGTH);

    const room = DESCRIPTION_LENGTH - ours.length - 1;
    return room < MIN_SENTENCE_LENGTH ? ours : `${ours} ${cutAtWord(sentence, room)}`;
}

/**
 * What only this site can say about the game, as short sentences, or nothing.
 *
 * Every figure passes the floor the page itself applies before it is printed. `tracked` is tested
 * for being above zero rather than trusted: an API older than this build sends none, and a missing
 * count must leave its sentence out rather than print one with no number in it.
 */
function ourFigures(scores: CommunityScores | null, times: CommunityTimes | null): string {
    const figures: string[] = [];

    const tracked = scores?.tracked;
    if (typeof tracked === 'number' && tracked > 0) {
        figures.push(`Tracked by ${formatCount(tracked)} ${tracked === 1 ? 'member' : 'members'}.`);
    }

    // Out of 100 because it is an average of other people, which is what a percentage means here,
    // never stars (ADR 0021). Always plural: the floor is above one.
    if (hasMemberScore(scores)) {
        figures.push(`Member score ${ratingPercent(scores.mean)}/100 from ${formatCount(scores.scored)} scores.`);
    }

    // A median, never a mean, with the number of runs behind it, exactly as the completion times
    // print it — and only once that number clears the same floor.
    const tier = times?.buckets.find(bucket => bucket.type === QUOTED_TIER);
    const median = tier !== undefined && tier.samples >= MIN_PLAYTHROUGH_SAMPLES
        ? formatMinutesPlayed(tier.medianMinutes)
        : null;
    if (tier !== undefined && median !== null) {
        figures.push(`Normally beaten in ${median} (median of ${formatCount(tier.samples)} playthroughs).`);
    }

    return figures.join(' ');
}

/**
 * The first sentence of a summary, with its whitespace folded to single spaces. The whole text when
 * no sentence ends inside it.
 *
 * A heuristic, since nothing short of a language model knows where an English sentence ends. A stop
 * ends one only before a capital or a number, and not after an abbreviation from the list, a lone
 * initial — the J. and R. of "J. R. R. Tolkien" — or letters written with stops, like "U.S." The
 * mistake it can still make is ending a sentence early, which costs the rest of that sentence; the
 * cut below would have cost most of it anyway.
 */
export function firstSentence(text: string): string {
    const prose = text.replace(/\s+/g, ' ').trim();

    for (const match of prose.matchAll(SENTENCE_END)) {
        if (match[1] === '.' && endsInAbbreviation(prose.slice(0, match.index))) continue;
        return prose.slice(0, match.index + match[1].length + match[2].length);
    }

    return prose;
}

function endsInAbbreviation(before: string): boolean {
    const word = /[\p{L}\p{N}.]*$/u.exec(before)?.[0] ?? '';

    return /^\p{Lu}$/u.test(word)
        || /^(?:\p{L}\.)+\p{L}$/u.test(word)
        || ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * Text no longer than `max`, cut after a whole word and ended with an ellipsis when it had to be cut.
 * One character of `max` is the ellipsis. A first word longer than the room is cut where the room ends,
 * since there is no earlier word to stop after.
 */
export function cutAtWord(text: string, max: number): string {
    if (text.length <= max) return text;

    const room = max - 1;
    const space = text.lastIndexOf(' ', room);
    const kept = (space > 0 ? text.slice(0, space) : text.slice(0, room)).replace(TRAILING_SEPARATORS, '');

    return `${kept}…`;
}
