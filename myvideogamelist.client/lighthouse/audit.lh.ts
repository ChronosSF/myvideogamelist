import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import { FORM_FACTORS, PAGES, lhciConfig, urlsFor } from './budgets';
import { REPORTS } from './harness';
import { seededAccount } from './seed';
import { readOutcome, summarise, type Outcome } from './summary';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const LHCI = fileURLToPath(new URL('./node_modules/@lhci/cli/src/cli.js', import.meta.url));

/**
 * Runs Lighthouse CI's command `command` from this directory, where it keeps its `.lighthouseci`, and
 * passes its output through. Resolves with the exit code, which for `assert` is the verdict.
 */
function lhci(command: string, config: string, env: Record<string, string>): Promise<number> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [LHCI, command, `--config=${config}`], {
            cwd: HERE,
            env: { ...process.env, ...env },
            stdio: ['ignore', 'inherit', 'inherit'],
        });
        child.on('error', reject);
        child.on('close', code => resolve(code ?? 1));
    });
}

test('every audited page keeps its Lighthouse scores', async () => {
    // Five pages, two form factors, three runs each: thirty audits at ten to twenty seconds apiece.
    test.setTimeout(30 * 60_000);

    expect(existsSync(LHCI), 'Lighthouse CI is installed: npm ci --prefix lighthouse').toBe(true);
    const chromePath = chromium.executablePath();
    expect(existsSync(chromePath), "Playwright's Chromium is installed: npx playwright install chromium").toBe(true);

    const account = seededAccount();
    const urls = urlsFor(account);

    const outcomes: Outcome[] = [];
    const verdicts: Record<string, boolean> = {};

    for (const formFactor of FORM_FACTORS) {
        await test.step(`audit on ${formFactor}`, async () => {
            const directory = `${REPORTS}${formFactor}/`;
            mkdirSync(directory, { recursive: true });
            const config = `${directory}lighthouserc.json`;
            writeFileSync(config, JSON.stringify(lhciConfig(formFactor, urls, chromePath), null, 2));

            // What the puppeteer script reads: who to sign in as, and before which pages.
            const env = {
                LIGHTHOUSE_EMAIL: account.email,
                LIGHTHOUSE_PASSWORD: account.password,
                LIGHTHOUSE_SIGNED_IN: JSON.stringify(
                    PAGES.filter(page => 'signedIn' in page).map(page => urls.get(page.key))),
            };

            expect(await lhci('collect', config, env), `lhci collect on ${formFactor}`).toBe(0);
            // The verdict, kept rather than asserted here, so that the other form factor is still
            // audited and the summary still written when this one fails.
            verdicts[formFactor] = await lhci('assert', config, env) === 0;
            expect(await lhci('upload', config, env), `lhci upload on ${formFactor}`).toBe(0);

            outcomes.push(readOutcome(formFactor, urls, directory, `${HERE}.lighthouseci/assertion-results.json`));
        });
    }

    const { markdown, failures } = summarise(outcomes);
    writeFileSync(`${REPORTS}summary.md`, markdown);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    console.log(`\n${markdown}`);

    expect(failures, 'Lighthouse assertions at the error level').toEqual([]);
    // LHCI's own verdict, should the table above ever read its results differently.
    expect(verdicts, 'lhci assert').toEqual(Object.fromEntries(FORM_FACTORS.map(formFactor => [formFactor, true])));
});
