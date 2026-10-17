import { describe, expect, it } from 'vitest';
import type { MetaDescriptor } from 'react-router';
import { browseFrom } from '@/lib/gameBrowse';
import { MIN_MEMBER_SCORES } from '@/lib/score';
import { gameStructuredData, searchPathTemplate, siteStructuredData } from '@/lib/structuredData';
import { game, platform } from '@/test/factories';
import type { CommunityScores } from '@/types/community';
import type { GameDto } from '@/types/game';

const SITE = { siteUrl: 'https://myvideogamelist.net', indexable: true };
const NO_ADDRESS = { siteUrl: null, indexable: false };
const TODAY = '2026-10-17';

/** A JSON-LD object, read loosely: these tests are about its shape. */
type Block = Record<string, unknown> & { '@type': string };

/** The JSON-LD among a page's tags, as `<Meta>` would write it — through JSON, so nothing else survives. */
function blocksIn(tags: MetaDescriptor[]): Block[] {
    return tags
        .filter((tag): tag is { 'script:ld+json': Block } => 'script:ld+json' in tag)
        .map(tag => JSON.parse(JSON.stringify(tag['script:ld+json'])) as Block);
}

function block(tags: MetaDescriptor[], type: string): Block | undefined {
    return blocksIn(tags).find(found => found['@type'] === type);
}

function scores(scored: number, mean: number | null = 8.44): CommunityScores {
    return { scored, mean, distribution: Array<number>(10).fill(0), tracked: scored };
}

function company(id: number, name: string) {
    return { id, name, country: null, foundedYear: null, website: null, logoUrl: null, description: null };
}

const HOLLOW_KNIGHT: GameDto = game({
    id: 14593,
    title: 'Hollow Knight',
    description: 'Forge your own path in Hollow Knight!',
    releaseDate: '2017-02-24',
    coverImageUrl: 'https://images.igdb.com/cover.jpg',
    backgroundImageUrl: 'https://images.igdb.com/art.jpg',
    genres: [{ id: 8, name: 'Platform', description: null }, { id: 31, name: 'Adventure', description: null }],
    platforms: [platform(6, 'PC (Microsoft Windows)'), platform(130, 'Nintendo Switch')],
    developers: [company(1, 'Team Cherry')],
    publishers: [company(1, 'Team Cherry')],
});

const forGame = (loaded: GameDto, memberScores: CommunityScores | null = null, today = TODAY) =>
    gameStructuredData({ site: SITE, path: `/games/${loaded.id}`, game: loaded, scores: memberScores, today });

describe('gameStructuredData', () => {
    it('describes the game as a VideoGame, from what the page shows', () => {
        const videoGame = block(forGame(HOLLOW_KNIGHT), 'VideoGame');

        expect(videoGame).toEqual({
            '@context': 'https://schema.org',
            '@type': 'VideoGame',
            name: 'Hollow Knight',
            url: 'https://myvideogamelist.net/games/14593',
            image: 'https://images.igdb.com/cover.jpg',
            description: 'Forge your own path in Hollow Knight!',
            datePublished: '2017-02-24',
            genre: ['Platform', 'Adventure'],
            gamePlatform: ['PC (Microsoft Windows)', 'Nintendo Switch'],
            // schema.org has no `developer`: the developer is the work's author.
            author: [{ '@type': 'Organization', name: 'Team Cherry' }],
            publisher: [{ '@type': 'Organization', name: 'Team Cherry' }],
        });
    });

    it('leaves out each property the page has nothing for, rather than writing it empty', () => {
        const videoGame = block(forGame(game({ id: 7, title: 'Bare', backgroundImageUrl: 'https://images.igdb.com/art.jpg' })), 'VideoGame');

        expect(videoGame).toEqual({
            '@context': 'https://schema.org',
            '@type': 'VideoGame',
            name: 'Bare',
            url: 'https://myvideogamelist.net/games/7',
            // Key art when there is no cover, as the share card does.
            image: 'https://images.igdb.com/art.jpg',
        });
    });

    it('gives a release date only once that day has come', () => {
        // IGDB dates a game known only by its year with the year's last day, so an unreleased game
        // would otherwise announce a day nobody named.
        const upcoming = game({ id: 8, title: 'Later', releaseDate: '2027-12-31' });

        expect(block(forGame(upcoming), 'VideoGame')).not.toHaveProperty('datePublished');
        expect(block(forGame(upcoming, null, '2027-12-31'), 'VideoGame')).toHaveProperty('datePublished', '2027-12-31');
    });

    it("rates the game by its members' score, as the badge shows it, once enough have scored it", () => {
        const videoGame = block(forGame(HOLLOW_KNIGHT, scores(MIN_MEMBER_SCORES)), 'VideoGame');

        expect(videoGame?.aggregateRating).toEqual({
            '@type': 'AggregateRating',
            ratingValue: 84,
            ratingCount: MIN_MEMBER_SCORES,
            // Out of 100, as every aggregate is shown; half a star, a 1 of 10, is the least it can be.
            bestRating: 100,
            worstRating: 10,
        });
    });

    it('gives no rating under the floor, however good the few scores are', () => {
        const videoGame = block(forGame(HOLLOW_KNIGHT, scores(MIN_MEMBER_SCORES - 1, 10)), 'VideoGame');

        expect(videoGame).not.toHaveProperty('aggregateRating');
    });

    it("never rates the game by IGDB's critic score or player rating", () => {
        // Both well counted and high, and neither is ours: Google asks that ratings not be gathered
        // from other sites, and on this page they are IGDB's.
        const rated = { ...HOLLOW_KNIGHT, criticScore: 87, criticScoreCount: 40, rating: 9.1, ratingCount: 2500 };

        expect(block(forGame(rated), 'VideoGame')).not.toHaveProperty('aggregateRating');
        expect(block(forGame(rated, scores(0, null)), 'VideoGame')).not.toHaveProperty('aggregateRating');
    });

    it('places the game under the catalogue under the home page', () => {
        expect(block(forGame(HOLLOW_KNIGHT), 'BreadcrumbList')).toEqual({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://myvideogamelist.net/' },
                { '@type': 'ListItem', position: 2, name: 'Games', item: 'https://myvideogamelist.net/games' },
                { '@type': 'ListItem', position: 3, name: 'Hollow Knight', item: 'https://myvideogamelist.net/games/14593' },
            ],
        });
    });

    it('writes nothing on a deployment with no public address to build its URLs from', () => {
        const tags = gameStructuredData({ site: NO_ADDRESS, path: '/games/14593', game: HOLLOW_KNIGHT, scores: scores(20), today: TODAY });

        expect(tags).toEqual([]);
    });
});

describe('siteStructuredData', () => {
    it('names the site at its home page, with a search', () => {
        expect(block(siteStructuredData(SITE), 'WebSite')).toEqual({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'MyVideoGameList',
            url: 'https://myvideogamelist.net/',
            potentialAction: {
                '@type': 'SearchAction',
                target: {
                    '@type': 'EntryPoint',
                    urlTemplate: 'https://myvideogamelist.net/games?search={search_term_string}',
                },
                'query-input': 'required name=search_term_string',
            },
        });
    });

    it('sends a search to the address the browse page reads a search from', () => {
        // Whatever the browse page calls its parameter, the template has to agree with it, or every
        // search arriving this way would land on the unfiltered catalogue.
        const [path, query] = searchPathTemplate().split('?');
        const filled = query.replace('{search_term_string}', encodeURIComponent('hollow knight'));

        expect(path).toBe('/games');
        expect(browseFrom(new URLSearchParams(filled)).search).toBe('hollow knight');
    });

    it('writes nothing on a deployment with no public address', () => {
        expect(siteStructuredData(NO_ADDRESS)).toEqual([]);
    });
});
