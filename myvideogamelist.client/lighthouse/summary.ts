import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PAGES, RUNS, type FormFactor, type PageKey } from './budgets';

/** The four category scores, in the order the table shows them. */
const CATEGORIES = [
    ['performance', 'Performance'],
    ['accessibility', 'Accessibility'],
    ['best-practices', 'Best practices'],
    ['seo', 'SEO'],
] as const;

type Category = (typeof CATEGORIES)[number][0];

/** One figure: the median LHCI judged, and what came of it. */
interface Measured {
    /** Null for a performance score Lighthouse could not give, the page having no LCP. */
    value: number | null;
    /**
     * `fail` is an error-level assertion that did not hold and `warn` a warn-level one. `unasserted`
     * is a performance score the baseline has none for, read from the median run instead (#315).
     */
    verdict: 'pass' | 'warn' | 'fail' | 'unasserted';
    /** The threshold it missed, when it missed one. */
    expected?: number;
}

interface PageOutcome {
    key: PageKey;
    name: string;
    url: string;
    categories: Record<Category, Measured>;
    cls: Measured;
    /** The median run's, in milliseconds: shown for reading, and asserted nowhere. */
    lcp: number | null;
    /** The median run's report, relative to the reports directory. */
    report: string;
}

export interface Outcome {
    formFactor: FormFactor;
    pages: PageOutcome[];
}

/** One entry of LHCI's `assertion-results.json`, as far as this reads it. */
interface AssertionResult {
    url: string;
    auditId: string;
    auditProperty?: string;
    level: 'warn' | 'error';
    passed: boolean;
    actual: number;
    expected: number;
}

/** One entry of the `manifest.json` that `lhci upload --target=filesystem` writes. */
interface ManifestEntry {
    url: string;
    isRepresentativeRun: boolean;
    htmlPath: string;
    jsonPath: string;
}

function measured(results: AssertionResult[]): Measured {
    const failed = results.filter(result => !result.passed);
    const worst = failed.find(result => result.level === 'error') ?? failed[0];
    return {
        value: results[0].actual,
        verdict: worst === undefined ? 'pass' : worst.level === 'error' ? 'fail' : 'warn',
        expected: worst?.expected,
    };
}

/**
 * What one form factor's audit came to, read from the files LHCI leaves: the assertion results, which
 * hold every median it judged and its verdict, and the filesystem upload's manifest, which says which
 * run is each page's median. Each page's report is renamed for the page, since LHCI names it for the
 * URL's path and the home page's would be `.report.html`.
 */
export function readOutcome(
    formFactor: FormFactor,
    urls: Map<PageKey, string>,
    directory: string,
    assertionResults: string,
): Outcome {
    copyFileSync(assertionResults, join(directory, 'assertion-results.json'));
    const results = JSON.parse(readFileSync(assertionResults, 'utf8')) as AssertionResult[];
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as ManifestEntry[];

    const pages = PAGES.map(page => {
        const url = urls.get(page.key)!;
        const mine = results.filter(result => result.url === url);
        const of = (auditId: string, property?: string) => {
            const found = mine.filter(result => result.auditId === auditId && result.auditProperty === property);
            if (found.length === 0) throw new Error(`No assertion on ${auditId} ${property ?? ''} for ${url}.`);
            return measured(found);
        };

        const median = manifest.find(entry => entry.url === url && entry.isRepresentativeRun);
        if (median === undefined) throw new Error(`LHCI reported no median run for ${url}.`);

        const html = join(directory, `${page.key}.report.html`);
        const json = join(directory, `${page.key}.report.json`);
        renameSync(median.htmlPath, html);
        renameSync(median.jsonPath, json);
        for (const entry of manifest.filter(entry => entry.url === url)) {
            entry.htmlPath = html;
            entry.jsonPath = json;
        }

        const lhr = JSON.parse(readFileSync(json, 'utf8')) as {
            categories: Record<Category, { score: number | null }>;
            audits: Record<string, { numericValue?: number } | undefined>;
        };

        // A page whose baseline has no performance score has no assertion on it: the median run says.
        const performance: Measured = mine.some(result => result.auditProperty === 'performance')
            ? of('categories', 'performance')
            : { value: lhr.categories.performance.score, verdict: 'unasserted' };

        return {
            key: page.key,
            name: page.name,
            url,
            categories: {
                ...Object.fromEntries(CATEGORIES.slice(1).map(([category]) => [category, of('categories', category)])),
                performance,
            } as Record<Category, Measured>,
            cls: of('cumulative-layout-shift'),
            lcp: lhr.audits['largest-contentful-paint']?.numericValue ?? null,
            report: `${formFactor}/${basename(html)}`,
        };
    });

    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { formFactor, pages };
}

const score = (value: number) => String(Math.round(value * 100));

function cell(figure: Measured, format: (value: number) => string, comparison: string): string {
    if (figure.value === null) return '– no LCP';
    if (figure.verdict === 'pass') return format(figure.value);
    if (figure.verdict === 'unasserted') return `⚠️ ${format(figure.value)} (no baseline)`;
    const mark = figure.verdict === 'fail' ? '❌' : '⚠️';
    return `${mark} ${format(figure.value)} (${comparison} ${format(figure.expected!)})`;
}

/**
 * The job summary: a table of medians per page and form factor, with what missed its threshold marked,
 * and the list of misses at the error level, which is what fails the job.
 */
export function summarise(outcomes: Outcome[]): { markdown: string; failures: string[] } {
    const failures: string[] = [];
    const warnings: string[] = [];
    const lines = [
        '## Lighthouse',
        '',
        `The median of ${RUNS} runs of each page, on the production build behind the stand-in for the `
            + 'edge (ADR 0068). ❌ fails the job, ⚠️ only warns. "No LCP" is a page Lighthouse gives no '
            + "performance score, a rail's scroll snapping having ended the measurement (#315). Every report "
            + "is in this run's `lighthouse-reports` artifact.",
    ];

    for (const { formFactor, pages } of outcomes) {
        lines.push(
            '',
            `### ${formFactor === 'mobile' ? 'Mobile' : 'Desktop'}`,
            '',
            `| Page | ${CATEGORIES.map(([, title]) => title).join(' | ')} | CLS | LCP, median run |`,
            `|---|${CATEGORIES.map(() => '--:').join('|')}|--:|--:|`,
        );

        for (const page of pages) {
            const figures: [string, Measured][] = [
                ...CATEGORIES.map(([category, title]) => [title, page.categories[category]] as [string, Measured]),
                ['CLS', page.cls],
            ];
            for (const [title, figure] of figures) {
                if (figure.verdict === 'pass' || figure.value === null) continue;
                if (figure.verdict === 'unasserted') {
                    // The page has an LCP after all: #315 is fixed, or never applied to it.
                    warnings.push(`${formFactor}, ${page.name}: ${title} is ${score(figure.value)} and has no `
                        + 'baseline, which lighthouse/budgets.ts should now give it');
                    continue;
                }
                const shown = title === 'CLS' ? figure.value.toFixed(3) : score(figure.value);
                const threshold = title === 'CLS' ? figure.expected!.toFixed(3) : score(figure.expected!);
                const line = `${formFactor}, ${page.name}: ${title} ${shown}, `
                    + `${title === 'CLS' ? 'over' : 'under'} ${threshold}`;
                (figure.verdict === 'fail' ? failures : warnings).push(line);
            }

            lines.push(`| ${page.name} | ${[
                ...CATEGORIES.map(([category]) => cell(page.categories[category], score, 'min')),
                cell(page.cls, value => value.toFixed(3), 'max'),
                page.lcp === null ? '–' : `${(page.lcp / 1000).toFixed(1)} s`,
            ].join(' | ')} |`);
        }
    }

    // Annotations on the run, so that a warning is seen without opening the summary.
    if (process.env.GITHUB_ACTIONS) {
        for (const warning of warnings) console.log(`::warning title=Lighthouse::${warning}`);
        for (const failure of failures) console.log(`::error title=Lighthouse::${failure}`);
    }

    return { markdown: `${lines.join('\n')}\n`, failures };
}
