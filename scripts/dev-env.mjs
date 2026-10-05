/*
 * dev-env.mjs — park, resume and inspect the AWS dev environment.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------------------------
 * An idle dev environment pays for its load balancer, not its containers (ADR 0044): awake it is
 * about $74 a month in Frankfurt, with the application stack destroyed and the database stopped
 * it is about $4.64. Parking is four commands in a fixed order with a wait in the middle, and the
 * order is load-bearing — stop the database only once the application stack is gone, or
 * /healthz keeps both tasks running and billing while every page fails. Resuming is the reverse
 * plus two lookups done by hand otherwise: the newest image tag in ECR, and whether the database
 * is back yet. That is exactly the sequence that goes wrong at the one step skipped from memory,
 * so it lives here, with the pipeline's gate (D-6) toggled alongside: parking sets the
 * DEV_DEPLOY_ENABLED variable to false so that a merge to master cannot silently un-park the
 * environment, and resuming sets it back.
 *
 * ---------------------------------------------------------------------------------------------
 * HOW TO RUN IT
 * ---------------------------------------------------------------------------------------------
 *   node scripts/dev-env.mjs status             what exists, and which cost row that is
 *   node scripts/dev-env.mjs park               destroy the App stack, stop the database, gate off
 *   node scripts/dev-env.mjs resume             start the database, deploy App at the newest tag,
 *                                               wait for both services, check /healthz, gate on
 *   node scripts/dev-env.mjs resume --tag <sha> the same, at a tag of your choosing
 *   node scripts/dev-env.mjs allow [--cidr x/32] redeploy the Data stack admitting this address
 *                                               (or the one given) at the balancer; until the
 *                                               CloudFront phase, the only way in
 *
 * Options on every command: --env <name> (default dev), --profile <aws profile> (default
 * mvgl-<env>). Everything goes through `aws --profile`, `cdk --profile` and `gh`, so it does
 * nothing unless the SSO session behind that profile is signed in: `aws sso login --profile
 * mvgl-dev` first. Unlike the other tools in this directory, which only print SQL, this one acts
 * on AWS — every command it runs is printed before it runs.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------------------------
 * It never touches the long-lived stacks by accident. `cdk deploy` deploys a stack's
 * dependencies too, and the Data stack synthesised without `allowedCidr` admits CloudFront only —
 * so an App deploy without `--exclusively` silently replaces the balancer's allow rule. Every
 * deploy here is `--exclusively`, and the Data stack is redeployed only by `allow`, which always
 * passes the address. It never deletes the database, the zone, a secret or an image: parking
 * leaves everything a resume needs. And it never chooses a tag that is not already in ECR.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARGS = process.argv.slice(2);
const COMMAND = ARGS[0];

function option(name, fallback) {
    const i = ARGS.indexOf(name);
    return i >= 0 && ARGS[i + 1] !== undefined ? ARGS[i + 1] : fallback;
}

const ENV = option('--env', 'dev');
const PROFILE = option('--profile', `mvgl-${ENV}`);

/** Every name the stacks agree on, as infra/src/Infra/Site.cs derives them. */
const NAMES = {
    cluster: `mvgl-${ENV}`,
    database: `mvgl-${ENV}-db`,
    appStack: `Mvgl-${ENV}-App`,
    dataStack: `Mvgl-${ENV}-Data`,
    host: `${ENV}.myvideogamelist.net`,
    apiRepository: 'mvgl/api',
    ssrRepository: 'mvgl/ssr',
    gateVariable: `${ENV.toUpperCase()}_DEPLOY_ENABLED`,
    gitHubEnvironment: ENV,
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INFRA = path.join(REPO_ROOT, 'infra');

// Cost rows from ADR 0044's table for Frankfurt, always-on dollars a month. Approximate on
// purpose: the balancer and the database bill started hours in full.
const COST = {
    awake: '≈ $74 a month: everything is running',
    appOnly: '≈ $19 a month: the database runs, the application stack is gone',
    parked: '≈ $4.64 a month: the idle floor — storage, secrets, zones, images',
    broken: 'the application stack is up but the database is not: every page fails and the balancer bills anyway',
};

// ---------------------------------------------------------------------------------------------
// Running things. `aws` and `gh` are executables and run directly; `cdk` is an npm shim, which
// on Windows is a .cmd and needs a shell. Nothing here passes user input into a shell string.
// ---------------------------------------------------------------------------------------------

function show(cmd, args) {
    console.error(`> ${cmd} ${args.join(' ')}`);
}

function aws(args, { allowFailure = false } = {}) {
    const full = ['--profile', PROFILE, '--output', 'json', ...args];
    show('aws', full);
    const r = spawnSync('aws', full, { encoding: 'utf8' });
    if (r.status !== 0) {
        if (allowFailure) return { ok: false, error: (r.stderr || '').trim() };
        fail(`aws ${args.slice(0, 2).join(' ')} failed:\n${(r.stderr || '').trim()}`);
    }
    const text = (r.stdout || '').trim();
    return { ok: true, value: text === '' ? null : JSON.parse(text) };
}

function cdk(args) {
    const full = ['--profile', PROFILE, '-c', `env=${ENV}`, ...args];
    show('cdk', full);
    const r = spawnSync('cdk', full, { cwd: INFRA, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) fail(`cdk ${args[0]} ${args[1]} failed with exit code ${r.status}`);
}

function gh(args) {
    show('gh', args);
    const r = spawnSync('gh', args, { cwd: REPO_ROOT, encoding: 'utf8' });
    return { ok: r.status === 0, out: (r.stdout || '').trim(), error: (r.stderr || '').trim() };
}

function fail(message) {
    console.error(`\n${message}`);
    process.exit(1);
}

function note(message) {
    console.error(message);
}

// ---------------------------------------------------------------------------------------------
// Reading the environment.
// ---------------------------------------------------------------------------------------------

function stackStatus(name) {
    const r = aws(['cloudformation', 'describe-stacks', '--stack-name', name, '--query', 'Stacks[0].StackStatus'],
        { allowFailure: true });
    if (!r.ok) {
        if (/does not exist/.test(r.error)) return null;
        fail(r.error);
    }
    return r.value;
}

function databaseStatus() {
    const r = aws(['rds', 'describe-db-instances', '--db-instance-identifier', NAMES.database,
        '--query', 'DBInstances[0].DBInstanceStatus'], { allowFailure: true });
    if (!r.ok) {
        if (/DBInstanceNotFound/.test(r.error)) return null;
        fail(r.error);
    }
    return r.value;
}

function services() {
    const r = aws(['ecs', 'describe-services', '--cluster', NAMES.cluster, '--services', 'api', 'ssr',
        '--query', 'services[?status==`ACTIVE`].{name:serviceName,running:runningCount,desired:desiredCount}'],
        { allowFailure: true });
    return r.ok && Array.isArray(r.value) ? r.value : [];
}

/** The tag of the most recently pushed tagged image in a repository, or null. */
function newestTag(repository) {
    const r = aws(['ecr', 'describe-images', '--repository-name', repository,
        '--query', 'sort_by(imageDetails[?imageTags], &imagePushedAt)[-1].imageTags[0]']);
    return r.value;
}

function hasTag(repository, tag) {
    const r = aws(['ecr', 'describe-images', '--repository-name', repository, '--image-ids', `imageTag=${tag}`,
        '--query', 'length(imageDetails)'], { allowFailure: true });
    return r.ok && r.value === 1;
}

async function publicAddress() {
    const response = await fetch('https://checkip.amazonaws.com', { signal: AbortSignal.timeout(10_000) });
    return (await response.text()).trim();
}

async function healthy(attempts = 8) {
    const url = `https://${NAMES.host}/healthz`;
    for (let i = 1; i <= attempts; i++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
            const body = (await response.text()).trim();
            if (response.status === 200 && body === 'Healthy') return true;
            note(`  ${url}: ${response.status} ${body}`);
        } catch (error) {
            note(`  ${url}: ${error.cause?.code ?? error.name} (attempt ${i} of ${attempts})`);
        }
        if (i < attempts) await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    return false;
}

// ---------------------------------------------------------------------------------------------
// The pipeline's gate. The variable lives on the GitHub environment the deploy job declares
// (ADR 0044, D-6). Until that environment exists the pipeline does not either, so a missing
// environment is reported and is not a failure.
// ---------------------------------------------------------------------------------------------

function gate(value) {
    const r = gh(['variable', 'set', NAMES.gateVariable, '--env', NAMES.gitHubEnvironment, '--body', String(value)]);
    if (r.ok) {
        note(`${NAMES.gateVariable} = ${value} on the GitHub environment "${NAMES.gitHubEnvironment}"`);
    } else {
        note(`Could not set ${NAMES.gateVariable} on the GitHub environment "${NAMES.gitHubEnvironment}" — `
            + `fine if the pipeline does not exist yet. gh said: ${r.error || r.out}`);
    }
}

function gateValue() {
    const r = gh(['variable', 'get', NAMES.gateVariable, '--env', NAMES.gitHubEnvironment]);
    return r.ok ? r.out : null;
}

// ---------------------------------------------------------------------------------------------
// The commands.
// ---------------------------------------------------------------------------------------------

function status() {
    const app = stackStatus(NAMES.appStack);
    const data = stackStatus(NAMES.dataStack);
    const db = databaseStatus();
    const running = services();
    const tag = newestTag(NAMES.apiRepository);
    const gateNow = gateValue();

    console.log(`Environment: ${ENV} (profile ${PROFILE})`);
    console.log(`  ${NAMES.dataStack}: ${data ?? 'absent'}`);
    console.log(`  ${NAMES.appStack}:  ${app ?? 'absent'}`);
    console.log(`  database ${NAMES.database}: ${db ?? 'absent'}`);
    console.log(`  services: ${running.length === 0 ? 'none' : running.map((s) => `${s.name} ${s.running}/${s.desired}`).join(', ')}`);
    console.log(`  newest image tag: ${tag ?? 'none pushed yet'}`);
    console.log(`  ${NAMES.gateVariable}: ${gateNow ?? 'not set (no pipeline environment yet)'}`);

    const appUp = app !== null && !/DELETE/.test(app);
    const dbUp = db === 'available';
    const row = appUp && dbUp ? COST.awake : appUp ? COST.broken : dbUp ? COST.appOnly : COST.parked;
    console.log(`  cost row: ${row}`);
    if (db === 'stopped') {
        console.log('  note: RDS restarts a stopped instance by itself after seven days; park again or schedule a stop for longer.');
    }
}

function park() {
    const app = stackStatus(NAMES.appStack);
    if (app === null) {
        note(`${NAMES.appStack} is already gone.`);
    } else {
        // The application stack is instantiated only when an imageTag is supplied; for a destroy
        // any value names it (the walkthrough's lever 3). Nothing in the data stack is touched.
        cdk(['destroy', NAMES.appStack, '-c', 'imageTag=parked', '--force']);
    }

    // Only now the database: /healthz checks no dependency, so with the database stopped first
    // ECS would keep both tasks running, and billing, while every page failed.
    const db = databaseStatus();
    if (db === 'available') {
        aws(['rds', 'stop-db-instance', '--db-instance-identifier', NAMES.database, '--query', 'DBInstance.DBInstanceStatus']);
        note(`Database ${NAMES.database}: stopping. Instance hours stop; storage and backups keep billing.`);
    } else {
        note(`Database ${NAMES.database}: ${db ?? 'absent'} — not touched.`);
    }

    gate(false);
    console.log('');
    status();
}

async function resume() {
    const db = databaseStatus();
    if (db === null) fail(`Database ${NAMES.database} does not exist. Deploy ${NAMES.dataStack} first.`);
    if (db === 'stopped') {
        aws(['rds', 'start-db-instance', '--db-instance-identifier', NAMES.database, '--query', 'DBInstance.DBInstanceStatus']);
        note('Database starting — AWS says this can take from minutes to hours. Waiting…');
    } else if (db === 'stopping') {
        fail('The database is still stopping. Wait until it reports "stopped", then run this again.');
    } else if (db !== 'available') {
        note(`Database is "${db}". Waiting for it to become available…`);
    }
    if (db !== 'available') {
        aws(['rds', 'wait', 'db-instance-available', '--db-instance-identifier', NAMES.database]);
    }

    const tag = option('--tag', null) ?? newestTag(NAMES.apiRepository);
    if (!tag) fail(`No tagged image in ${NAMES.apiRepository}. Build and push a release first (ADR 0044, Phase 7).`);
    if (!hasTag(NAMES.apiRepository, tag) || !hasTag(NAMES.ssrRepository, tag)) {
        fail(`Tag ${tag} is not in both ${NAMES.apiRepository} and ${NAMES.ssrRepository}.`);
    }
    note(`Deploying ${NAMES.appStack} at image tag ${tag}.`);

    // --exclusively: the Data stack is not redeployed as a dependency, so the balancer's allow
    // rule stays what `allow` last set it to.
    cdk(['deploy', NAMES.appStack, '--exclusively', '-c', `imageTag=${tag}`, '--require-approval', 'never']);

    note('Waiting for both services to be stable…');
    aws(['ecs', 'wait', 'services-stable', '--cluster', NAMES.cluster, '--services', 'api', 'ssr']);

    note(`Checking https://${NAMES.host}/healthz — a new alias can take a moment to resolve.`);
    if (await healthy()) {
        note('Healthy.');
    } else {
        note(`Not reachable from here. Until the CloudFront phase the balancer admits one address; if yours `
            + `changed, run: node scripts/dev-env.mjs allow`);
    }

    gate(true);
    console.log('');
    status();
}

async function allow() {
    const cidr = option('--cidr', null) ?? `${await publicAddress()}/32`;
    if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr)) fail(`Not an IPv4 CIDR: ${cidr}`);
    note(`Redeploying ${NAMES.dataStack} with the balancer admitting ${cidr}. Until the CloudFront phase this is the only way in.`);
    cdk(['deploy', NAMES.dataStack, '--exclusively', '-c', `allowedCidr=${cidr}`, '--require-approval', 'never']);
}

const COMMANDS = { status, park, resume, allow };

if (!COMMANDS[COMMAND]) {
    console.error('Usage: node scripts/dev-env.mjs <status|park|resume|allow> [--env dev] [--profile mvgl-dev] [--tag <sha>] [--cidr x.x.x.x/32]');
    process.exit(1);
}

await COMMANDS[COMMAND]();
