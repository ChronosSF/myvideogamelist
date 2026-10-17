import type { MetaDescriptor } from 'react-router';
import { browseParams, EMPTY_BROWSE } from '@/lib/gameBrowse';
import { hasMemberScore, MAX_SCORE, ratingPercent } from '@/lib/score';
import { SITE_NAME, type SiteConfig } from '@/lib/seo';
import type { CommunityScores } from '@/types/community';
import type { GameDto } from '@/types/game';

/**
 * What a page says about itself in schema.org's vocabulary, as JSON-LD, for a search engine to read.
 *
 * Returned from a route's `meta` as `script:ld+json` descriptors, which React Router's `<Meta>`
 * renders on the server into `<script type="application/ld+json">` in the head. That is the channel
 * rather than a script tag of our own, for two reasons. `<Meta>` escapes the JSON's `<`, `>` and `&`,
 * so a title from IGDB holding `</script>` cannot end the block early. And the markup it writes is
 * React Router's, so no `dangerouslySetInnerHTML` enters `src/` (ADR 0053 §2).
 *
 * Under ADR 0053's script policy the block needs neither the render's nonce nor a hash. A script whose
 * type is not JavaScript is a data block: the browser never runs it, so it never consults
 * `script-src` about it. See `docs/decisions/0069-*`.
 *
 * Every URL in it is absolute and built from `SITE_URL`, as the canonical URL is (ADR 0036 §6). A
 * deployment with no public address to build them from writes none at all.
 */

const SCHEMA = 'https://schema.org';

/** The browse page, which is also where a search lands (`routes.ts`). */
const GAMES_PATH = '/games';

/** The placeholder a `SearchAction` names for the words somebody searches for. */
const SEARCH_TERM = 'search_term_string';

/** The lowest score a member can give: half a star, one of the ten steps (ADR 0021). */
const LOWEST_SCORE = 1;

interface GameStructuredData {
    site: SiteConfig;
    /** The page's canonical path, the one `pageMeta` is given, so the two cannot name different pages. */
    path: string;
    game: GameDto;
    /** The members' scores as the loader read them, which is the badge the server render shows. */
    scores: CommunityScores | null;
    /** Today in UTC, `YYYY-MM-DD`, as the loader saw it. Decides whether the game is out yet. */
    today: string;
}

/**
 * A game page's `VideoGame`, and the `BreadcrumbList` from the home page down to it.
 *
 * Every property is what the page itself shows, and is left out where the page shows nothing.
 *
 * - **The developers are the `author`**, since schema.org gives a game no `developer` property, and
 *   the publishers the `publisher`.
 * - **`datePublished` only once that day has come.** IGDB dates a game it has only a year for with
 *   that year's last day — "Metro Rivals: New York", known only to be 2026, had 31 December 2026
 *   (`specs/release-timeline-and-calendar.md`, the evidence table) — so an unreleased game would
 *   otherwise announce a day nobody named.
 * - **An `AggregateRating` from our members' scores and nothing else**, at or above
 *   `MIN_MEMBER_SCORES` and with its count, valued as the badge shows it: out of 100, from 10 for
 *   one half star to 100 for five stars. Never IGDB's critic score or player rating. Google asks that
 *   ratings not be aggregated from other websites, and those two are IGDB's; ours is the one number
 *   on the page that this site produced (ADR 0021).
 */
export function gameStructuredData({ site, path, game, scores, today }: GameStructuredData): MetaDescriptor[] {
    if (site.siteUrl === null) return [];

    const url = `${site.siteUrl}${path}`;
    const image = game.coverImageUrl ?? game.backgroundImageUrl;

    return [
        {
            'script:ld+json': {
                '@context': SCHEMA,
                '@type': 'VideoGame',
                name: game.title,
                url,
                ...(image ? { image } : {}),
                ...(game.description ? { description: game.description } : {}),
                ...(game.releaseDate !== null && game.releaseDate <= today ? { datePublished: game.releaseDate } : {}),
                ...(game.genres.length > 0 ? { genre: game.genres.map(genre => genre.name) } : {}),
                ...(game.platforms.length > 0 ? { gamePlatform: game.platforms.map(platform => platform.name) } : {}),
                ...(game.developers.length > 0 ? { author: organisations(game.developers) } : {}),
                ...(game.publishers.length > 0 ? { publisher: organisations(game.publishers) } : {}),
                ...(hasMemberScore(scores)
                    ? {
                        aggregateRating: {
                            '@type': 'AggregateRating',
                            ratingValue: ratingPercent(scores.mean),
                            ratingCount: scores.scored,
                            bestRating: ratingPercent(MAX_SCORE),
                            worstRating: ratingPercent(LOWEST_SCORE),
                        },
                    }
                    : {}),
            },
        },
        {
            'script:ld+json': {
                '@context': SCHEMA,
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Home', item: `${site.siteUrl}/` },
                    { '@type': 'ListItem', position: 2, name: 'Games', item: `${site.siteUrl}${GAMES_PATH}` },
                    { '@type': 'ListItem', position: 3, name: game.title, item: url },
                ],
            },
        },
    ];
}

/**
 * The home page's `WebSite`: the site's name and address, and where a search for a game goes.
 *
 * Google reads the name and address for the site name it shows over a result, and only from the home
 * page. It stopped showing the search box a `SearchAction` asked for on 21 November 2024, and says
 * the markup can stay; the action is here for whatever else reads it, and costs nothing.
 */
export function siteStructuredData(site: SiteConfig): MetaDescriptor[] {
    if (site.siteUrl === null) return [];

    return [{
        'script:ld+json': {
            '@context': SCHEMA,
            '@type': 'WebSite',
            name: SITE_NAME,
            url: `${site.siteUrl}/`,
            potentialAction: {
                '@type': 'SearchAction',
                target: { '@type': 'EntryPoint', urlTemplate: `${site.siteUrl}${searchPathTemplate()}` },
                'query-input': `required name=${SEARCH_TERM}`,
            },
        },
    }];
}

/**
 * The browse page's address for a search, with the placeholder where the words go.
 *
 * Built by the browse page's own `browseParams`, so the action names the parameter the page reads a
 * search from. The placeholder is wrapped in its braces afterwards, because the parameters would
 * encode them and schema.org needs them as they are.
 */
export function searchPathTemplate(): string {
    const query = browseParams({ ...EMPTY_BROWSE, search: SEARCH_TERM }).toString();
    return `${GAMES_PATH}?${query.replace(SEARCH_TERM, `{${SEARCH_TERM}}`)}`;
}

function organisations(companies: { name: string }[]) {
    return companies.map(company => ({ '@type': 'Organization', name: company.name }));
}
