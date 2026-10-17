import { GAME_ID, SITE } from './harness';
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

/** A page's medians on one form factor, as Lighthouse scores them, from 0 to 1. */
interface Scores {
    accessibility: number;
    bestPractices: number;
    seo: number;
    /**
     * Null where Lighthouse finds no largest contentful paint, and so gives no performance score at
     * all: the home, game and profile pages on a phone, until #315 is fixed.
     */
    performance: number | null;
}

/**
 * The baseline: what each page scored when this audit was first run, on GitHub's runner, against an
 * empty database. The thresholds below are derived from it, so this is the one table to change, in the
 * pull request that moves a score and with the reason in its description.
 *
 * Accessibility is short of 100 everywhere because of contrast (#234, #246), and on some pages heading
 * order and a description list. Best practices is 96 on every signed-out page because of the 401 the
 * session check logs (#316). SEO is 66 on the lists page because it says `noindex`, as every page about
 * one person does (ADR 0036).
 */
const BASELINE: Record<FormFactor, Record<PageKey, Scores>> = {
    mobile: {
        home: { accessibility: 0.96, bestPractices: 0.96, seo: 1, performance: null },
        games: { accessibility: 0.95, bestPractices: 0.96, seo: 1, performance: 0.71 },
        game: { accessibility: 0.92, bestPractices: 0.96, seo: 1, performance: null },
        profile: { accessibility: 0.94, bestPractices: 0.96, seo: 1, performance: null },
        lists: { accessibility: 0.95, bestPractices: 1, seo: 0.66, performance: 0.71 },
    },
    desktop: {
        home: { accessibility: 0.96, bestPractices: 0.96, seo: 1, performance: 0.96 },
        games: { accessibility: 0.95, bestPractices: 0.96, seo: 1, performance: 0.94 },
        game: { accessibility: 0.92, bestPractices: 0.96, seo: 1, performance: 0.78 },
        profile: { accessibility: 0.94, bestPractices: 0.96, seo: 1, performance: 0.94 },
        lists: { accessibility: 0.95, bestPractices: 1, seo: 0.66, performance: 0.96 },
    },
};

/**
 * The most a page's layout may shift, on every page. Every baseline is under 0.002, so this is ten
 * times the worst of them and a fifth of the 0.1 Google calls good: an image that arrives without its
 * size, or a banner that pushes the page down, crosses it, and the difference between two runs does not.
 */
const CLS_LIMIT = 0.02;

/**
 * How far a performance score may fall below its baseline before the job warns. Two medians of three
 * runs on the same commit differ by a few points; ten is past that.
 */
const PERFORMANCE_NOISE = 0.1;

/**
 * The performance score under which the job fails, on every page: far enough below every baseline that
 * only something broken reaches it — a script that blocks the page, an image of megabytes, a request
 * that waits on another — and never the runner having a slow minute.
 */
const PERFORMANCE_FLOOR: Record<FormFactor, number> = { mobile: 0.4, desktop: 0.6 };

/** The URL each page is audited at, for this run's account. */
export function urlsFor(account: Account): Map<PageKey, string> {
    return new Map(PAGES.map(page => [page.key, new URL(page.path(account), SITE).href]));
}

const exactly = (url: string) => `^${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;

/**
 * Lighthouse CI's configuration for one form factor: what `lhci collect`, `assert` and `upload` read.
 * Built here rather than kept as a `lighthouserc` file because the profile's URL names the run's own
 * account, and so that the baseline above is the one place a threshold comes from.
 */
export function lhciConfig(formFactor: FormFactor, urls: Map<PageKey, string>, chromePath: string) {
    const assertMatrix = PAGES.flatMap(page => {
        const baseline = BASELINE[formFactor][page.key];
        const matchingUrlPattern = exactly(urls.get(page.key)!);

        // The tier that fails: these change only when the page does, so any drop is a regression.
        const tier = {
            matchingUrlPattern,
            aggregationMethod: 'median',
            assertions: {
                'categories:accessibility': ['error', { minScore: baseline.accessibility }],
                'categories:best-practices': ['error', { minScore: baseline.bestPractices }],
                'categories:seo': ['error', { minScore: baseline.seo }],
                'cumulative-layout-shift': ['error', { maxNumericValue: CLS_LIMIT }],
            } as Record<string, unknown>,
        };
        if (baseline.performance === null) return [tier];

        // Performance, which moves with the runner: a warning below the baseline's noise, and a
        // failure only under the floor. The same key cannot be asserted at two levels in one entry.
        tier.assertions['categories:performance'] =
            ['warn', { minScore: Math.max(0, baseline.performance - PERFORMANCE_NOISE) }];
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
                // As Playwright launches it. Ubuntu's AppArmor refuses Chromium's sandbox to a browser
                // it has no profile for, which is every build but an installed Google Chrome.
                puppeteerLaunchOptions: { args: ['--no-sandbox'] },
                settings: formFactor === 'desktop' ? { preset: 'desktop' } : {},
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
