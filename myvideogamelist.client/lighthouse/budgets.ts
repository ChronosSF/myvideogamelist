import { CHROME_PROFILE, GAME_ID, SITE } from './harness';
import type { Account } from './seed';

/** Mobile is the headline run: Lighthouse's default, a mid-range phone on a slow 4G connection. */
export const FORM_FACTORS = ['mobile', 'desktop'] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

/** Each URL is audited this many times on each form factor, and every assertion reads the median. */
export const RUNS = 3;

export const PAGES = [
    { key: 'home', name: 'Home, signed out', path: () => '/' },
    { key: 'games', name: 'Browse', path: () => '/games' },
    { key: 'game', name: 'Game', path: () => `/games/${GAME_ID}` },
    { key: 'profile', name: 'Public profile', path: (account: Account) => `/u/${account.userName}` },
    { key: 'lists', name: 'Lists, signed in', path: () => '/lists', signedIn: true },
] as const;

export type PageKey = (typeof PAGES)[number]['key'];

/** A page's medians on one form factor. Scores are Lighthouse's, from 0 to 1. */
interface Baseline {
    accessibility: number;
    bestPractices: number;
    seo: number;
    /**
     * What Lighthouse's console audit counts. None on any page since #316: until then, every signed-out
     * page logged the 401 the session check was answered with.
     */
    consoleErrors: number;
    /**
     * Everything the page loads, in KiB once decoded: its covers from IGDB's image host above all. As
     * decoded rather than as sent, because a machine can sit between the browser and the server
     * undoing the compression — this one did, leaving an `X-Content-Encoding-Over-Network` header on
     * every response — and a size as sent is then three times CI's for the same page.
     */
    kib: number;
    /**
     * Null where Lighthouse finds no largest contentful paint, and so gives no performance score at
     * all, which leaves the page's performance unasserted. None is null now: the home, game and profile
     * pages on a phone were, until #315 was fixed.
     */
    performance: number | null;
}

/**
 * The baseline: each page's medians on the job's first run on GitHub's runner (run 39040552994, on
 * 2026-10-17), against an empty database. The thresholds below are derived from it, so this is the one
 * table to change, in the pull request that moves a figure and with the reason in its description.
 *
 * Accessibility, best practices, SEO and the console's errors are held to it exactly, in both
 * directions: they move only when the page does, so a figure that rises has to be written here too, or
 * the next change could give it back unseen — and the lists page rising to 100 for SEO would be the
 * page losing its `noindex`.
 *
 * A developer's machine scores the same in all of those, and can score lower for performance: where
 * IGDB's image host is farther away than it is from GitHub's runners, and where something on the machine
 * decodes what the server compressed (see `kib`). One such machine scored 0.70 for browse on a phone,
 * against 0.90 here. A local run warns about it and passes.
 *
 * Accessibility is short of 100 on four pages because of heading order and a description list (#329).
 * SEO is 66 on the lists page because it says `noindex`, as every page that is one member's own does
 * (ADR 0036).
 *
 * Six figures are from a later run, 40070934403 on 2026-10-24, once master was merged in. Three rose a
 * point: accessibility on a desktop for the game page, the profile and the lists, when the navbar's search
 * (#270) arrived. From 64rem it is a box in the bar, a labelled combobox, and it brings audits those pages
 * had nothing for: a field's label, and ARIA roles and the attributes they require. It passes them. The
 * home page gains the same audits and still rounds to 0.96; browse already had a search field. Below 64rem
 * the search waits behind a toggle, so a phone's figures are as they were. The other three are new:
 * performance on a phone for the home, game and profile pages, which had no score until #315's fix came
 * with #272. Theirs are the scores of each page's median run, as the job's summary gives a page with no
 * baseline.
 *
 * One figure fell a point with nothing on its page getting worse: accessibility on a desktop for the
 * lists, 0.9556 to 0.9541, when a game card's list toggle stopped being its cover (#329). The cover was a
 * `div` with `role="button"`, which `aria-command-name` audits and which passed it; the toggle is a
 * `<button>`, which that audit does not cover, and a passing audit that stops applying takes its weight
 * out of the average. What the change fixed does not count: Lighthouse has no `nested-interactive` audit
 * and weighs `label-content-name-mismatch` at nothing. A phone's figure moved the same way, 0.9541 to
 * 0.9526, and rounds to 0.95 either side.
 *
 * Another fell a point the same way: accessibility on a phone for the home page, 0.9578 to 0.9527, when
 * the hero's picture and the Trending rail made way for the welcome panel and Just out (ADR 0073). The
 * audited home page now has no image and no rail that scrolls — the stand-in's games have no release
 * rows, so neither release panel is drawn — and `image-alt`, `image-redundant-alt` and `tabindex`, which
 * it passed, stopped applying, taking eighteen of its weight out of the average. Its one failing audit is
 * the one it failed before, the Sign Up button's contrast (#246). A desktop's figure moved the same way,
 * 0.9634 to 0.9595, and rounds to 0.96 either side.
 *
 * Sixteen figures rose when the session check stopped answering a visitor with a 401 (#316): best
 * practices from 0.96 to 1 and the console's errors from 1 to 0, on the home page, browse, the game page
 * and the profile, on both form factors. Chrome logs every 4xx a page's fetch receives as an error, so
 * that 401 was the one error on each of those pages, and the one best-practices audit they failed. The
 * figures are from a developer's machine, which scores the same as the runner in both.
 *
 * Twenty figures moved with the editorial redesign (ADR 0075), from a developer's machine, whose decoded
 * weights matched the runner's to a KiB. Accessibility rose on every page, to 100 on the home page: no
 * page breaks contrast any more, now that every text tone passes 4.5:1 (#234), a filled button is the
 * ink on lime rather than white (#246), and a score's solid fill carries the ink too (#329). The weights
 * moved with the fonts, which a page loads from this origin — Archivo's two faces at 13 KiB each,
 * Schibsted Grotesk's 46 and DM Mono's 15 — and with what each page now shows: the home page's fell, as
 * its welcome panel draws no picture.
 *
 * Performance on a phone is left where it was. On the runner the redesign's first paint did not move,
 * but its largest came 0.6 to 1.2 seconds later on every page, with Archivo's whole variable file at 88
 * KiB: a page's largest text is set in it and waits for it, and on browse and the lists the fonts' bytes
 * went ahead of the first cover. Archivo is cut to its two faces since (`npm run fonts`), which took a
 * page's fonts from 149 KiB to 87 and, on a developer's machine, its largest paint 250 to 470 ms sooner;
 * the job warns about what is left, which is the record of it.
 */
const BASELINE: Record<FormFactor, Record<PageKey, Baseline>> = {
    mobile: {
        home: { accessibility: 1, bestPractices: 1, seo: 1, consoleErrors: 0, kib: 651, performance: 0.87 },
        games: { accessibility: 0.98, bestPractices: 1, seo: 1, consoleErrors: 0, kib: 943, performance: 0.9 },
        game: { accessibility: 0.96, bestPractices: 1, seo: 1, consoleErrors: 0, kib: 2102, performance: 0.87 },
        profile: { accessibility: 0.98, bestPractices: 1, seo: 1, consoleErrors: 0, kib: 772, performance: 0.89 },
        lists: { accessibility: 0.99, bestPractices: 1, seo: 0.66, consoleErrors: 0, kib: 796, performance: 0.89 },
    },
    desktop: {
        home: { accessibility: 1, bestPractices: 1, seo: 1, consoleErrors: 0, kib: 651, performance: 1 },
        games: { accessibility: 0.98, bestPractices: 1, seo: 1, consoleErrors: 0, kib: 1107, performance: 0.99 },
        game: { accessibility: 0.97, bestPractices: 1, seo: 1, consoleErrors: 0, kib: 2014, performance: 1 },
        profile: { accessibility: 0.98, bestPractices: 1, seo: 1, consoleErrors: 0, kib: 714, performance: 1 },
        lists: { accessibility: 0.99, bestPractices: 1, seo: 0.66, consoleErrors: 0, kib: 796, performance: 0.99 },
    },
};

/**
 * The most a page's layout may shift, on every page. Every baseline is under 0.002, so this is ten
 * times the worst of them and a fifth of the 0.1 Google calls good: an image that arrives without its
 * size, or a banner that pushes the page down, crosses it, and the difference between two runs does not.
 */
const CLS_LIMIT = 0.02;

/**
 * The most script a page may load, in KiB once decoded, on every page. Every page loads 359 to 398, so
 * this is half as much again as the most: a dependency of any size, or a route that stops being split
 * off, crosses it. Bytes do not move with the runner, so this fails where a performance score could
 * not — a script that arrives before the first paint costs time but no blocking time, and on a page
 * with none the score keeps over half its weight however slowly the page loads.
 */
const SCRIPT_LIMIT_KIB = 600;

/**
 * How much more a page may load in all than its baseline: half as much again. A page's weight is its
 * script and IGDB's images, so this is what an image of megabytes, or a grid's covers asked for at a
 * bigger size, crosses.
 */
const WEIGHT_HEADROOM = 1.5;

/**
 * How far a performance score may fall below its baseline before the job warns. On GitHub's runner the
 * three runs of a page differed by four points at most; ten is past that.
 */
const PERFORMANCE_NOISE = 0.1;

/**
 * The performance score under which the job fails, on every page: a backstop for a page that has
 * stopped working, such as a main thread blocked for seconds, and never the runner having a slow minute,
 * nor a developer's machine across an ocean from IGDB's image host, where the desktop home page scored
 * 0.71. It catches little else: a page that blocks nothing and shifts nothing keeps more than half its
 * score however slowly it loads, which is what the two byte budgets above are for.
 */
const PERFORMANCE_FLOOR: Record<FormFactor, number> = { mobile: 0.5, desktop: 0.6 };

/**
 * The axe rules each page breaks (`axe.lh.ts`), which are reported and do not fail: the rest of #329.
 * Contrast left every page with the editorial redesign (ADR 0075). Held exactly, as the scores are: a rule
 * the page no longer breaks fails until it leaves the list, and one that is not on it fails until it is
 * fixed.
 */
export const KNOWN_VIOLATIONS: Record<PageKey, readonly string[]> = {
    home: [],
    games: ['heading-order'],
    game: ['definition-list'],
    profile: ['heading-order'],
    lists: ['heading-order'],
};

/**
 * The colour pairs each page's text breaks contrast with, as axe names them, foreground on background:
 * none, since the editorial redesign (ADR 0075). Kept by pair rather than by rule, so that should one come
 * back while a page has another on record, the new pair is named; a pair is a property of the theme, and
 * stays put however much data a page shows.
 */
export const KNOWN_CONTRAST: Record<PageKey, readonly string[]> = {
    home: [],
    games: [],
    game: [],
    profile: [],
    lists: [],
};

/**
 * The most a page may load, in bytes once decoded: script, and everything. Judged by the summary on the
 * median run's requests rather than asserted through LHCI, whose byte figures are sizes as sent.
 */
export function byteLimits(formFactor: FormFactor, page: PageKey): { script: number; total: number } {
    return {
        script: SCRIPT_LIMIT_KIB * 1024,
        total: Math.round(BASELINE[formFactor][page].kib * WEIGHT_HEADROOM) * 1024,
    };
}

/** The URL each page is audited at, for this run's account. */
export function urlsFor(account: Account): Map<PageKey, string> {
    return new Map(PAGES.map(page => [page.key, new URL(page.path(account), SITE).href]));
}

const exactly = (url: string) => `^${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;

/** Two decimals, as Lighthouse rounds a score, so that 0.92 − 0.1 is 0.82 and not a hair over. */
const score = (value: number) => Math.round(value * 100) / 100;

/**
 * Lighthouse CI's configuration for one form factor: what `lhci collect`, `assert` and `upload` read.
 * Built here rather than kept as a `lighthouserc` file because the profile's URL names the run's own
 * account, and so that the baseline above is the one place a threshold comes from.
 */
export function lhciConfig(formFactor: FormFactor, urls: Map<PageKey, string>, chromePath: string) {
    const assertMatrix = PAGES.flatMap(page => {
        const baseline = BASELINE[formFactor][page.key];
        const matchingUrlPattern = exactly(urls.get(page.key)!);

        // The tier that fails: these change only when the page does. LHCI holds a minimum or a
        // maximum; the summary holds the exact ones to their baseline in the other direction too.
        const tier = {
            matchingUrlPattern,
            aggregationMethod: 'median',
            assertions: {
                'categories:accessibility': ['error', { minScore: baseline.accessibility }],
                'categories:best-practices': ['error', { minScore: baseline.bestPractices }],
                'categories:seo': ['error', { minScore: baseline.seo }],
                'errors-in-console': ['error', { maxLength: baseline.consoleErrors }],
                'cumulative-layout-shift': ['error', { maxNumericValue: CLS_LIMIT }],
            } as Record<string, unknown>,
        };
        if (baseline.performance === null) return [tier];

        // Performance, which moves with the runner: a warning below the baseline's noise, and a
        // failure only under the floor. The same key cannot be asserted at two levels in one entry.
        tier.assertions['categories:performance'] =
            ['warn', { minScore: score(Math.max(0, baseline.performance - PERFORMANCE_NOISE)) }];
        return [tier, {
            matchingUrlPattern,
            aggregationMethod: 'median',
            assertions: {
                'categories:performance': ['error', { minScore: PERFORMANCE_FLOOR[formFactor] }],
            },
        }];
    });

    return {
        ci: {
            collect: {
                url: [...urls.values()],
                numberOfRuns: RUNS,
                // Playwright's Chromium, pinned with Playwright, rather than whatever Chrome a runner
                // image ships this week: a browser update moves the scores.
                chromePath,
                puppeteerScript: './sign-in.cjs',
                puppeteerLaunchOptions: {
                    // As Playwright launches it. Ubuntu's AppArmor refuses Chromium's sandbox to a
                    // browser it has no profile for, which is every build but an installed Google Chrome.
                    args: ['--no-sandbox'],
                    // A profile of the run's own, which the next run's setup removes. Left to puppeteer,
                    // each collect leaves one behind in the system's temporary folder: LHCI exits without
                    // closing the browser, and the folder is removed only on a close.
                    userDataDir: `${CHROME_PROFILE}${formFactor}`,
                },
                settings: {
                    ...(formFactor === 'desktop' ? { preset: 'desktop' } : {}),
                    // Half Lighthouse's own 45 s. A page here loads in seconds, and a stalled image host
                    // should cost thirty runs ten minutes, not twenty-two and the job's timeout.
                    maxWaitForLoad: 20_000,
                },
            },
            assert: { includePassedAssertions: true, assertMatrix },
            upload: {
                target: 'filesystem',
                outputDir: `./reports/${formFactor}`,
                // No date in the name, so each page keeps one report, the median run's: the other runs'
                // are written first and overwritten by it.
                reportFilenamePattern: '%%PATHNAME%%.report.%%EXTENSION%%',
            },
        },
    };
}
