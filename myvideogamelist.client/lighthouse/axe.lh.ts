import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { KNOWN_VIOLATIONS, PAGES, urlsFor } from './budgets';
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

/**
 * axe-core in full, on the pages Lighthouse audits (ADR 0068). Lighthouse's accessibility score runs a
 * subset of axe's rules and weighs them into one number; this runs every rule axe enables by default —
 * WCAG 2.0 to 2.2 at A and AA, and its best practices — and names each element that breaks one. A rule a
 * page already broke when the baseline was taken is in `KNOWN_VIOLATIONS` and only reported; any other
 * fails.
 *
 * One test rather than one a page, so that every page is scanned and the summary written whichever
 * fails: Playwright starts a new worker after a failed test, and what the old one had collected would
 * go with it. Desktop-sized, Playwright's default; Lighthouse's own subset covers the phone.
 */
test('every audited page breaks no axe rule beyond its baseline', async ({ page }) => {
    // Five pages, each loaded until its network is quiet and then scanned: twenty-odd seconds here.
    test.setTimeout(3 * 60_000);

    const account = seededAccount();
    const urls = urlsFor(account);
    const violations: Violation[] = [];

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

            const known: readonly string[] = KNOWN_VIOLATIONS[audited.key];
            for (const violation of (await new AxeBuilder({ page }).analyze()).violations) {
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
            }
        });
    }

    const lines = [
        '## axe',
        '',
        `Every rule axe-core enables by default, on the ${PAGES.length} pages above, at a desktop's width. `
            + '❌ fails the job; ⚠️ was there when the baseline was taken. Every element is in this run\'s '
            + '`lighthouse-reports` artifact, in `axe/violations.json`.',
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

    const markdown = `${lines.join('\n')}\n`;
    mkdirSync(`${REPORTS}axe`, { recursive: true });
    writeFileSync(`${REPORTS}axe/violations.json`, JSON.stringify(violations, null, 2));
    writeFileSync(`${REPORTS}axe/summary.md`, markdown);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    console.log(`\n${markdown}`);

    expect(
        violations.filter(violation => !violation.known).map(({ page: name, rule }) => `${name}: ${rule}`),
        'axe rules broken beyond the baseline',
    ).toEqual([]);
});
