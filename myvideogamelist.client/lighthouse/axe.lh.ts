import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { KNOWN_CONTRAST, KNOWN_VIOLATIONS, PAGES, urlsFor } from './budgets';
import { REPORTS } from './harness';
import { seededAccount } from './seed';

/** One rule one page breaks. */
interface Violation {
    page: string;
    rule: string;
    impact: string;
    help: string;
    /** Whether the page already broke it when the baseline was taken. */
    known: boolean;
    /** Each element that breaks it, as axe names it, and why. */
    elements: { target: string; why: string }[];
}

/** What axe's contrast check says of an element: its colours, foreground then background. */
interface ContrastData {
    fgColor?: string;
    bgColor?: string;
}

/**
 * axe-core in full, on the pages Lighthouse audits (ADR 0068). Lighthouse's accessibility score runs a
 * subset of axe's rules and weighs them into one number; this runs every rule axe enables by default —
 * WCAG 2.0 and 2.1 at A and AA, and its best practices — and `target-size`, WCAG 2.2's one AA rule,
 * which axe leaves off and Lighthouse turns on. It names each element that breaks one.
 *
 * Held to the baseline exactly, as the scores are: a rule a page breaks that is not in its
 * `KNOWN_VIOLATIONS` fails, and so does one in it that the page no longer breaks. Contrast, which every
 * page breaks today, is held by colour pair (`KNOWN_CONTRAST`), so that a new pair does not hide behind
 * the old ones.
 *
 * One test rather than one a page, so that every page is scanned and the summary written whichever
 * fails: Playwright starts a new worker after a failed test, and what the old one had collected would
 * go with it. Desktop-sized, Playwright's default; Lighthouse's own subset covers the phone.
 */
test('every audited page breaks the axe rules of its baseline and no others', async ({ page }) => {
    // Five pages, each loaded until its network is quiet and then scanned: twenty-odd seconds here.
    test.setTimeout(3 * 60_000);

    const account = seededAccount();
    const urls = urlsFor(account);
    const violations: Violation[] = [];
    const failures: string[] = [];

    for (const audited of PAGES) {
        await test.step(audited.name, async () => {
            await page.context().clearCookies();
            if ('signedIn' in audited) {
                // As the sign-in dialog does, with the header every write carries (ADR 0033).
                const signedIn = await page.request.post('/api/auth/login', {
                    headers: { 'X-MVGL-Request': '1' },
                    data: { email: account.email, password: account.password },
                });
                expect(signedIn.status(), 'signing in').toBe(200);
            }

            await page.goto(urls.get(audited.key)!);
            // Until what loads after hydration has: the lists above all, which are fetched then.
            await page.waitForLoadState('networkidle');

            const found = (await new AxeBuilder({ page })
                .options({ rules: { 'target-size': { enabled: true } } })
                .analyze()).violations;
            const known: readonly string[] = KNOWN_VIOLATIONS[audited.key];
            const pairs = new Set<string>();

            for (const violation of found) {
                violations.push({
                    page: audited.name,
                    rule: violation.id,
                    impact: violation.impact ?? 'unknown',
                    help: violation.help,
                    known: known.includes(violation.id),
                    elements: violation.nodes.map(node => ({
                        target: node.target.join(' '),
                        why: node.failureSummary ?? '',
                    })),
                });
                if (violation.id !== 'color-contrast') continue;
                for (const node of violation.nodes) {
                    const data = [...node.any, ...node.all, ...node.none]
                        .map(check => check.data as ContrastData | undefined)
                        .find(data => data?.fgColor !== undefined && data.bgColor !== undefined);
                    if (data) pairs.add(`${data.fgColor} on ${data.bgColor}`);
                }
            }

            const broken = found.map(violation => violation.id);
            for (const rule of broken.filter(rule => !known.includes(rule))) {
                failures.push(`${audited.name} breaks \`${rule}\``);
            }
            for (const rule of known.filter(rule => !broken.includes(rule))) {
                failures.push(`${audited.name} no longer breaks \`${rule}\`: take it off its KNOWN_VIOLATIONS`);
            }
            const knownPairs: readonly string[] = KNOWN_CONTRAST[audited.key];
            for (const pair of [...pairs].filter(pair => !knownPairs.includes(pair))) {
                failures.push(`${audited.name} has text in ${pair} under the contrast WCAG AA asks for`);
            }
            for (const pair of knownPairs.filter(pair => !pairs.has(pair))) {
                failures.push(`${audited.name} no longer has ${pair} under that contrast: take it off its KNOWN_CONTRAST`);
            }
        });
    }

    const lines = [
        '## axe',
        '',
        `Every rule axe-core enables by default, and WCAG 2.2's \`target-size\`, on the ${PAGES.length} pages `
            + "above, at a desktop's width. ⚠️ was there when the baseline was taken; ❌ fails the job. Every "
            + "element is in this run's `lighthouse-reports` artifact, in `axe/violations.json`.",
        '',
    ];
    if (violations.length === 0) {
        lines.push('No violations.');
    } else {
        lines.push('| Page | Rule | Impact | Elements | |', '|---|---|---|--:|---|');
        for (const { page: name, rule, impact, help, known, elements } of violations) {
            lines.push(`| ${name} | \`${rule}\`: ${help} | ${impact} | ${elements.length} | ${known ? '⚠️' : '❌'} |`);
        }
    }
    if (failures.length > 0) lines.push('', '**What fails the job:**', '', ...failures.map(failure => `- ${failure}`));

    const markdown = `${lines.join('\n')}\n`;
    mkdirSync(`${REPORTS}axe`, { recursive: true });
    writeFileSync(`${REPORTS}axe/violations.json`, JSON.stringify(violations, null, 2));
    writeFileSync(`${REPORTS}axe/summary.md`, markdown);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    console.log(`\n${markdown}`);
    if (process.env.GITHUB_ACTIONS) {
        for (const failure of failures) console.log(`::error title=axe::${failure}`);
    }

    expect(failures, 'axe, against the baseline').toEqual([]);
});
