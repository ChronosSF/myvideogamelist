/**
 * The client's dependency audits, run by `npm run audit` and `npm run audit:lighthouse` and by CI's
 * Dependency audit job (ADR 0061).
 *
 * `npm audit` over everything a lock file installs, devDependencies included, since those run on every
 * developer's machine and in CI. An advisory rated high or critical fails. A lower one is printed and
 * passes; Dependabot's security updates propose the fix for it anyway. Two lock files are audited, each
 * on its own: the client's, by default, and Lighthouse CI's (`lighthouse`, ADR 0068 §9).
 *
 * npm has no list of advisories to set aside, so this is that list, one for each lock file. An advisory
 * goes in `ACCEPTED` only when nothing fixes it. When a fixed version exists the answer is to take it: in
 * the client, through `overrides` in package.json if the package that depends on it has not caught up;
 * in Lighthouse CI's tree only where its dependents' ranges allow, since 0068 §9 does not override a
 * tool's dependencies under it, so there an advisory whose fix is out of range is listed. An entry says
 * why the advisory does not apply here and the day it is looked at again. An entry past its day fails,
 * and so does one that matches nothing the audit found, so the list cannot outlive its reasons.
 *
 * Reads the lock file only, so it needs no `npm ci` first. Prints every advisory it finds, and exits
 * non-zero if one at high or above is not accepted, or if npm could not produce a report at all.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {Record<string, { advisory: string, reason: string, until: string }[]>} */
const ACCEPTED = {
    // The client's own lock file.
    '.': [
        // {
        //     advisory: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx',
        //     reason: 'Why it cannot reach anything here, and the issue that removes this entry.',
        //     until: '2026-12-31',
        // },
    ],
    // Lighthouse CI's. The audit runs `lhci collect`, `assert` and `upload` to the filesystem, in
    // Playwright's Chromium, launched by its path; nothing else of LHCI's runs, here or in CI.
    lighthouse: [
        {
            advisory: 'https://github.com/advisories/GHSA-c475-qrg2-pj4r',
            reason: "basic-ftp, under proxy-agent's support for proxy auto-config through get-uri: the audit "
                + 'configures no proxy, so no FTP connection is made and Client.list() never runs. The fix is '
                + "after 6.2.0, outside get-uri's ^5.0.2.",
            until: '2027-01-24',
        },
        {
            advisory: 'https://github.com/advisories/GHSA-jmr9-qjv8-65gv',
            reason: "extract-zip, under @puppeteer/browsers, which unpacks a browser puppeteer downloads: this "
                + 'tree has puppeteer-core, which runs no install script and downloads nothing, and the audit '
                + 'launches Chromium by its path, so no archive is ever extracted. No version fixes it.',
            until: '2027-01-24',
        },
        {
            advisory: 'https://github.com/advisories/GHSA-7pqw-9j4j-h8q3',
            reason: 'extract-zip, as above: no archive is ever extracted, and no version fixes it.',
            until: '2027-01-24',
        },
        {
            advisory: 'https://github.com/advisories/GHSA-ph9p-34f9-6g65',
            reason: "tmp, under LHCI for `lhci open`, whose one call passes a fixed postfix, and under "
                + "inquirer's editor prompt for `lhci wizard`: the audit runs neither. The fix is 0.2.6, outside "
                + "LHCI's ^0.1.0 and external-editor's ^0.0.33.",
            until: '2027-01-24',
        },
        {
            advisory: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5',
            reason: 'zod 3, under chromium-bidi, which puppeteer-core loads only for the WebDriver BiDi protocol: '
                + "LHCI launches Chromium with puppeteer's default, CDP, and the only messages are the local "
                + "browser's. The fix is zod 4.6.6, outside chromium-bidi's ^3.24.1.",
            until: '2027-01-24',
        },
    ],
};

const folder = process.argv[2] ?? '.';
if (!Object.hasOwn(ACCEPTED, folder)) {
    console.error(`No lock file is audited as '${folder}': name one of ${Object.keys(ACCEPTED).join(', ')}.`);
    process.exit(1);
}
const accepted = ACCEPTED[folder];

const FAILS = new Set(['high', 'critical']);

// The npm running this script when it is run through `npm run`; any npm on the path otherwise. Told
// the folder by --prefix, which a non-global command takes as the project to work in, rather than by
// the working directory, which the npm running this script may have recorded in the environment.
const prefix = resolve(fileURLToPath(new URL('..', import.meta.url)), folder);
const options = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
const run = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json', '--prefix', prefix], options)
    : spawnSync(`npm audit --json --prefix "${prefix}"`, { ...options, shell: true });

let report;
try {
    report = JSON.parse(run.stdout);
} catch {
    report = undefined;
}
// An audit that could not ask the registry is not a clean one.
if (!report || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    console.error('npm audit produced no report, so nothing was checked.');
    console.error(report?.error?.summary ?? run.error?.message ?? run.stderr ?? run.stdout);
    process.exit(1);
}

// Each advisory once, however many packages it reaches. A package listed only because it depends on
// another vulnerable one names that package in `via` rather than an advisory.
const found = new Map();
for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const via of vulnerability.via) {
        if (typeof via === 'object' && via.url && !found.has(via.url)) found.set(via.url, via);
    }
}

const today = new Date().toISOString().slice(0, 10);
const problems = [];

for (const advisory of found.values()) {
    const entry = accepted.find(candidate => candidate.advisory === advisory.url);
    const note = entry ? `, accepted until ${entry.until}` : '';
    console.log(`${advisory.severity}: ${advisory.name} ${advisory.range}, ${advisory.title} (${advisory.url}${note})`);
    if (FAILS.has(advisory.severity) && !entry) {
        problems.push(`${advisory.name}: ${advisory.title} is rated ${advisory.severity} (${advisory.url}).`);
    }
}

for (const entry of accepted) {
    // Days are compared as text, which is right only for a day written in full: '2026-9-30' would sort
    // after today and a missing day would never expire, so either is refused.
    const day = typeof entry.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.until)
        && !Number.isNaN(Date.parse(entry.until));
    if (!day || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
        problems.push(`${entry.advisory} is accepted without a reason and a day written YYYY-MM-DD.`);
    } else if (!found.has(entry.advisory)) {
        problems.push(`${entry.advisory} is accepted but the audit no longer finds it; remove the entry.`);
    } else if (entry.until < today) {
        problems.push(`${entry.advisory} was accepted until ${entry.until}; look at it again.`);
    }
}

const packages = report.metadata?.dependencies?.total ?? 'the';
if (found.size === 0) console.log(`No known vulnerabilities in ${packages} packages.`);

if (problems.length > 0) {
    console.error(`\n${problems.length} to fix before this passes:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
}
