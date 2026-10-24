import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import { FORM_FACTORS, PAGES, lhciConfig, urlsFor, type FormFactor } from './budgets';
import { REPORTS } from './harness';
import { seededAccount } from './seed';
import { readOutcome, summarise, type Outcome } from './summary';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const LHCI = fileURLToPath(new URL('./node_modules/@lhci/cli/src/cli.js', import.meta.url));

/** Where `lhci assert` leaves its verdict on every figure, which `collect` does not clear. */
const ASSERTION_RESULTS = `${HERE}.lighthouseci/assertion-results.json`;

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
    // Five pages, two form factors, three runs each: thirty audits, which took under seven minutes on
    // GitHub's runner and eleven on a developer's machine. Inside the job's thirty, so that a hang ends
    // here, with the step named and the summary of whatever was audited written.
    test.setTimeout(20 * 60_000);

    expect(existsSync(LHCI), 'Lighthouse CI is installed: npm ci --prefix lighthouse').toBe(true);
    const chromePath = chromium.executablePath();
    expect(existsSync(chromePath), "Playwright's Chromium is installed: npx playwright install chromium").toBe(true);

    const account = seededAccount();
    const urls = urlsFor(account);

    const outcomes: Outcome[] = [];
    const verdicts: Record<string, boolean> = {};
    // A form factor Lighthouse CI could not get through: named in the summary, and failed at the end
    // rather than at once, so that the other is still audited and the summary still written.
    const unaudited: FormFactor[] = [];

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

            if (await lhci('collect', config, env) !== 0) {
                unaudited.push(formFactor);
                return;
            }
            // The verdict, kept rather than asserted here, for the same reason. The last form factor's
            // results go first, so that an `assert` that dies before writing cannot be read as this one's.
            rmSync(ASSERTION_RESULTS, { force: true });
            verdicts[formFactor] = await lhci('assert', config, env) === 0;
            if (await lhci('upload', config, env) !== 0) {
                unaudited.push(formFactor);
                return;
            }

            outcomes.push(readOutcome(formFactor, urls, directory, ASSERTION_RESULTS));
        });
    }

    const { markdown, failures } = summarise(outcomes, unaudited);
    writeFileSync(`${REPORTS}summary.md`, markdown);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    console.log(`\n${markdown}`);

    expect(unaudited, 'form factors Lighthouse CI could not audit, its output above saying why').toEqual([]);
    expect(failures, 'Lighthouse assertions at the error level').toEqual([]);
    // LHCI's own verdict, should the table above ever read its results differently.
    expect(Object.keys(verdicts).filter(formFactor => !verdicts[formFactor]), 'lhci assert').toEqual([]);
});
