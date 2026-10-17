/**
 * The client's dependency audit, run by `npm run audit` and by CI's Dependency audit job (ADR 0061).
 *
 * `npm audit` over everything package-lock.json installs, devDependencies included, since those run on
 * every developer's machine and in CI. An advisory rated high or critical fails. A lower one is
 * printed and passes; Dependabot's security updates propose the fix for it anyway.
 *
 * npm has no list of advisories to set aside, so this is that list. An advisory goes in `ACCEPTED`
 * only when nothing fixes it. When a fixed version exists the answer is to take it, through `overrides`
 * in package.json if the package that depends on it has not caught up. An entry says why the advisory
 * does not apply here and the day it is looked at again. An entry past its day fails, and so does one
 * that matches nothing the audit found, so the list cannot outlive its reasons.
 *
 * Reads the lock file only, so it needs no `npm ci` first. Prints every advisory it finds, and exits
 * non-zero if one at high or above is not accepted, or if npm could not produce a report at all.
 */
import { spawnSync } from 'node:child_process';

/** @type {{ advisory: string, reason: string, until: string }[]} */
const ACCEPTED = [
    // {
    //     advisory: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx',
    //     reason: 'Why it cannot reach anything here, and the issue that removes this entry.',
    //     until: '2026-12-31',
    // },
];

const FAILS = new Set(['high', 'critical']);

// The npm running this script when it is run through `npm run`; any npm on the path otherwise.
const options = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
const run = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], options)
    : spawnSync('npm audit --json', { ...options, shell: true });

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
    const accepted = ACCEPTED.find(entry => entry.advisory === advisory.url);
    const note = accepted ? `, accepted until ${accepted.until}` : '';
    console.log(`${advisory.severity}: ${advisory.name} ${advisory.range}, ${advisory.title} (${advisory.url}${note})`);
    if (FAILS.has(advisory.severity) && !accepted) {
        problems.push(`${advisory.name}: ${advisory.title} is rated ${advisory.severity} (${advisory.url}).`);
    }
}

for (const entry of ACCEPTED) {
    if (!found.has(entry.advisory)) {
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
