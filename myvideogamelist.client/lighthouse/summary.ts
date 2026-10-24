import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { FORM_FACTORS, PAGES, RUNS, byteLimits, type FormFactor, type PageKey } from './budgets';

const score = (value: number) => String(Math.round(value * 100));
const kib = (value: number) => String(Math.round(value / 1024));

/** The median run's report, as far as this reads it. */
interface Report {
    categories: Record<string, { score: number | null }>;
    audits: Record<string, {
        numericValue?: number;
        details?: { items?: { description?: string; url?: string; resourceType?: string; resourceSize?: number }[] };
    } | undefined>;
}

/** The bytes the median run's requests came to once decoded, of one resource type or of all. */
function decoded(report: Report, type?: string): number {
    return (report.audits['network-requests']?.details?.items ?? [])
        .filter(item => type === undefined || item.resourceType === type)
        .reduce((sum, item) => sum + (item.resourceSize ?? 0), 0);
}

/**
 * A column of the table. Most read an assertion LHCI judged: how it shows, and whether it is held to its
 * baseline exactly. The byte budgets are judged here instead, on the median run (`byteLimits`).
 */
type Column = { title: string; format: (value: number) => string } & (
    | {
        auditId: string;
        auditProperty?: string;
        /** Held to its baseline in both directions: a figure that moves either way fails (budgets.ts). */
        exact?: true;
    }
    | { measure: (report: Report) => number; limit: (formFactor: FormFactor, page: PageKey) => number }
);

/** Every figure the audit judges, in the order the table shows them. */
const COLUMNS: readonly Column[] = [
    { title: 'Performance', auditId: 'categories', auditProperty: 'performance', format: score },
    { title: 'Accessibility', auditId: 'categories', auditProperty: 'accessibility', format: score, exact: true },
    { title: 'Best practices', auditId: 'categories', auditProperty: 'best-practices', format: score, exact: true },
    { title: 'SEO', auditId: 'categories', auditProperty: 'seo', format: score, exact: true },
    { title: 'Console errors', auditId: 'errors-in-console', format: String, exact: true },
    { title: 'CLS', auditId: 'cumulative-layout-shift', format: value => value.toFixed(3) },
    {
        title: 'Script, KiB',
        format: kib,
        measure: report => decoded(report, 'Script'),
        limit: (formFactor, page) => byteLimits(formFactor, page).script,
    },
    {
        title: 'Total, KiB',
        format: kib,
        measure: report => decoded(report),
        limit: (formFactor, page) => byteLimits(formFactor, page).total,
    },
];

/** One figure: the median LHCI judged, and what came of it. */
interface Measured {
    /** Null where a run gave no value: a performance score on a page with no LCP. */
    value: number | null;
    /**
     * `fail` is an error-level assertion that did not hold and `warn` a warn-level one. `moved` is an
     * exact figure that held its threshold but left its baseline, the other way. `unasserted` is a
     * performance score the baseline has none for, read from the median run instead (#315).
     */
    verdict: 'pass' | 'warn' | 'fail' | 'moved' | 'unasserted';
    /** The threshold it missed, or the baseline it moved from. */
    expected?: number;
    /** How the threshold reads: a minimum or a maximum. */
    bound?: 'min' | 'max';
}

interface PageOutcome {
    key: PageKey;
    name: string;
    url: string;
    figures: Measured[];
    /** An error-level assertion that failed and that no column shows. None, while the two agree. */
    other: string[];
    /**
     * What the median run's console said, for when its count is not the baseline's: a cover IGDB's image
     * host failed to serve reads as that, and a new error in the page as that.
     */
    console: string[];
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
    name: 'minScore' | 'maxLength' | 'maxNumericValue';
    level: 'warn' | 'error';
    passed: boolean;
    /** Null where LHCI wrote NaN: no run gave a value. */
    actual: number | null;
    expected: number;
}

/** One entry of the `manifest.json` that `lhci upload --target=filesystem` writes. */
interface ManifestEntry {
    url: string;
    isRepresentativeRun: boolean;
    htmlPath: string;
    jsonPath: string;
}

function measured(results: AssertionResult[], exact: boolean): Measured {
    const value = results[0].actual;
    const bound = results[0].name === 'minScore' ? 'min' : 'max';
    const failed = results.filter(result => !result.passed);
    const worst = failed.find(result => result.level === 'error') ?? failed[0];
    if (worst !== undefined) {
        return { value, verdict: worst.level === 'error' ? 'fail' : 'warn', expected: worst.expected, bound };
    }

    const baseline = results[0].expected;
    return exact && value !== baseline
        ? { value, verdict: 'moved', expected: baseline, bound }
        : { value, verdict: 'pass' };
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

        const lhr = JSON.parse(readFileSync(json, 'utf8')) as Report;

        const figures = COLUMNS.map((column): Measured => {
            if ('measure' in column) {
                const value = column.measure(lhr);
                const limit = column.limit(formFactor, page.key);
                return value > limit ? { value, verdict: 'fail', expected: limit, bound: 'max' } : { value, verdict: 'pass' };
            }
            const found = mine.filter(result =>
                result.auditId === column.auditId && result.auditProperty === column.auditProperty);
            if (found.length > 0) return measured(found, column.exact === true);
            // A page whose baseline has no performance score has no assertion on it: the median run says.
            if (column.auditProperty !== 'performance') throw new Error(`No assertion on ${column.title} for ${url}.`);
            return { value: lhr.categories.performance.score, verdict: 'unasserted' };
        });

        const shown = (result: AssertionResult) => COLUMNS.some(column =>
            'auditId' in column && result.auditId === column.auditId && result.auditProperty === column.auditProperty);
        const other = mine
            .filter(result => !result.passed && result.level === 'error' && !shown(result))
            .map(result => `${result.auditId}${result.auditProperty ? `:${result.auditProperty}` : ''} `
                + `is ${result.actual}, against ${result.expected}`);

        return {
            key: page.key,
            name: page.name,
            url,
            figures,
            other,
            console: (lhr.audits['errors-in-console']?.details?.items ?? [])
                .map(item => [item.description, item.url].filter(Boolean).join(' at ')),
            lcp: lhr.audits['largest-contentful-paint']?.numericValue ?? null,
            report: `${formFactor}/${basename(html)}`,
        };
    });

    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { formFactor, pages };
}

function cell(figure: Measured, format: (value: number) => string): string {
    if (figure.verdict === 'unasserted') {
        return figure.value === null ? '– no LCP' : `⚠️ ${format(figure.value)} (no baseline)`;
    }
    if (figure.value === null) return figure.verdict === 'pass' ? '–' : '❌ no value';
    if (figure.verdict === 'pass') return format(figure.value);
    if (figure.verdict === 'moved') return `❌ ${format(figure.value)} (baseline ${format(figure.expected!)})`;
    const mark = figure.verdict === 'fail' ? '❌' : '⚠️';
    return `${mark} ${format(figure.value)} (${figure.bound} ${format(figure.expected!)})`;
}

/** What a figure that is not as it should be says, for the list of failures or of warnings. */
function sentence(figure: Measured, column: Column): string {
    if (figure.value === null) return `${column.title} has no value`;
    const shown = column.format(figure.value);
    if (figure.verdict === 'unasserted') {
        // The page has an LCP after all: #315 is fixed, or never applied to it.
        return `${column.title} is ${shown} and has no baseline, which lighthouse/budgets.ts should now give it`;
    }
    if (figure.verdict === 'moved') {
        return `${column.title} is ${shown}, not its baseline ${column.format(figure.expected!)}: `
            + 'if the change is meant, write it in lighthouse/budgets.ts';
    }
    return `${column.title} ${shown}, ${figure.bound === 'min' ? 'under' : 'over'} ${column.format(figure.expected!)}`;
}

/**
 * The job summary: a table of medians per page and form factor, with what missed its threshold or left
 * its baseline marked, and the list of what fails the job. A form factor Lighthouse CI could not get
 * through is named instead of tabled.
 */
export function summarise(outcomes: Outcome[], unaudited: FormFactor[]): { markdown: string; failures: string[] } {
    const failures: string[] = [];
    const warnings: string[] = [];
    const lines = [
        '## Lighthouse',
        '',
        `The median of ${RUNS} runs of each page, on the production build behind the stand-in for the `
            + 'edge (ADR 0068). ❌ fails the job, ⚠️ only warns. A figure held exactly fails when it moves '
            + 'either way, and its baseline is in brackets. "No LCP" is a page without a performance baseline '
            + 'that Lighthouse gave no performance score (three pages, until #315 was fixed). Every report is '
            + "in this run's `lighthouse-reports` artifact.",
    ];

    for (const formFactor of FORM_FACTORS) {
        lines.push('', `### ${formFactor === 'mobile' ? 'Mobile' : 'Desktop'}`, '');
        if (unaudited.includes(formFactor)) {
            lines.push("❌ Not audited: Lighthouse CI stopped before it had every score. Its output is in the job's log.");
            continue;
        }

        const pages = outcomes.find(outcome => outcome.formFactor === formFactor)?.pages ?? [];
        lines.push(
            `| Page | ${COLUMNS.map(column => column.title).join(' | ')} | LCP, median run |`,
            `|---|${COLUMNS.map(() => '--:').join('|')}|--:|`,
        );

        for (const page of pages) {
            page.figures.forEach((figure, index) => {
                if (figure.verdict === 'pass' || (figure.verdict === 'unasserted' && figure.value === null)) return;
                const column = COLUMNS[index];
                const said = 'auditId' in column && column.auditId === 'errors-in-console' && page.console.length > 0
                    ? ` (the median run's: ${page.console.join('; ')})`
                    : '';
                const line = `${formFactor}, ${page.name}: ${sentence(figure, COLUMNS[index])}${said}`;
                (figure.verdict === 'warn' || figure.verdict === 'unasserted' ? warnings : failures).push(line);
            });
            for (const other of page.other) failures.push(`${formFactor}, ${page.name}: ${other}`);

            lines.push(`| ${page.name} | ${[
                ...page.figures.map((figure, index) => cell(figure, COLUMNS[index].format)),
                page.lcp === null ? '–' : `${(page.lcp / 1000).toFixed(1)} s`,
            ].join(' | ')} |`);
        }
    }

    if (failures.length > 0) lines.push('', '**What fails the job:**', '', ...failures.map(failure => `- ${failure}`));

    // Annotations on the run, so that a warning is seen without opening the summary.
    if (process.env.GITHUB_ACTIONS) {
        for (const warning of warnings) console.log(`::warning title=Lighthouse::${warning}`);
        for (const failure of failures) console.log(`::error title=Lighthouse::${failure}`);
    }

    return { markdown: `${lines.join('\n')}\n`, failures };
}
