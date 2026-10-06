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
import { existsSync, realpathSync } from 'node:fs';
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

/**
 * The one repository the deploy role trusts (infra/src/Infra/Site.cs), and so the only one whose
 * gate means anything. Pinned rather than inferred from the checkout, so a fork or another clone
 * cannot set a same-named variable somewhere else and carry on as though it had gated the pipeline.
 */
const REPOSITORY = 'ChronosSF/myvideogamelist';

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
// Running things. `aws` and `gh` are executables and run directly; `cdk` is run as the Node
// program it is. No shell is involved anywhere, on any platform.
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

/**
 * The CDK CLI is a Node program behind an npm shim - on Windows a .cmd that only a shell can
 * start. Rather than build a command line for a shell out of arguments, which is a thing nobody
 * should have to trust, find the program the shim points at and run it with this Node directly.
 */
function cdkEntry() {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        for (const shim of ['cdk', 'cdk.cmd']) {
            if (!existsSync(path.join(dir, shim))) continue;
            // npm's global layout: the shim beside node_modules/aws-cdk.
            const entry = path.join(dir, 'node_modules', 'aws-cdk', 'bin', 'cdk');
            if (existsSync(entry)) return entry;
            // Elsewhere the shim is a symlink to the program itself. A .cmd never is.
            if (shim === 'cdk') {
                try { return realpathSync(path.join(dir, shim)); } catch { /* keep looking */ }
            }
        }
    }
    fail('The CDK CLI is not on the PATH: npm install -g aws-cdk');
}

function cdk(args) {
    const full = ['--profile', PROFILE, '-c', `env=${ENV}`, ...args];
    show('cdk', full);
    const r = spawnSync(process.execPath, [cdkEntry(), ...full], { cwd: INFRA, stdio: 'inherit' });
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

/** Every tagged image in a repository, newest push first. */
function taggedImages(repository) {
    const r = aws(['ecr', 'describe-images', '--repository-name', repository,
        '--query', 'reverse(sort_by(imageDetails[?imageTags], &imagePushedAt))[].{tags:imageTags,pushed:imagePushedAt}'],
        { allowFailure: true });
    if (!r.ok) {
        // Before the Data stack exists there is no repository, and that is "no tags", not an error.
        if (/RepositoryNotFoundException/.test(r.error)) return [];
        fail(r.error);
    }
    return Array.isArray(r.value) ? r.value : [];
}

/**
 * The newest tag present in both repositories, or null. A release is one tag pushed to both;
 * one that is half-pushed, or whose second push failed, must not be the one chosen - and must
 * not stop an older complete one from being.
 */
function newestCommonTag() {
    const ssrTags = new Set(taggedImages(NAMES.ssrRepository).flatMap((image) => image.tags));
    for (const image of taggedImages(NAMES.apiRepository)) {
        const tag = image.tags.find((t) => ssrTags.has(t));
        if (tag) return tag;
    }
    return null;
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
    const r = gh(['variable', 'set', NAMES.gateVariable, '--repo', REPOSITORY, '--env', NAMES.gitHubEnvironment, '--body', String(value)]);
    if (r.ok) {
        note(`${NAMES.gateVariable} = ${value} on the GitHub environment "${NAMES.gitHubEnvironment}"`);
        return;
    }
    // Only a missing environment is the "no pipeline yet" case. Anything else - an expired gh
    // login, a wrong repository, no permission - would leave the gate saying the opposite of
    // what the environment is, which is the one thing this script exists to prevent.
    if (/HTTP 404/.test(r.error)) {
        note(`The GitHub environment "${NAMES.gitHubEnvironment}" does not exist yet, so there is no pipeline to gate.`);
        return;
    }
    fail(`Could not set ${NAMES.gateVariable} on the GitHub environment "${NAMES.gitHubEnvironment}": ${r.error || r.out}\n`
        + 'Is gh signed in, and run from a checkout of the repository? Fix that, then run this command again.');
}

function gateValue() {
    const r = gh(['variable', 'get', NAMES.gateVariable, '--repo', REPOSITORY, '--env', NAMES.gitHubEnvironment]);
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
    const tag = newestCommonTag();
    const gateNow = gateValue();

    console.log(`Environment: ${ENV} (profile ${PROFILE})`);
    console.log(`  ${NAMES.dataStack}: ${data ?? 'absent'}`);
    console.log(`  ${NAMES.appStack}:  ${app ?? 'absent'}`);
    console.log(`  database ${NAMES.database}: ${db ?? 'absent'}`);
    console.log(`  services: ${running.length === 0 ? 'none' : running.map((s) => `${s.name} ${s.running}/${s.desired}`).join(', ')}`);
    console.log(`  newest tag in both repositories: ${tag ?? 'none pushed yet'}`);
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
    // The gate first: a merge that lands while the stack is being destroyed must not redeploy
    // it, and if the gate cannot be set at all, nothing is torn down.
    gate(false);

    const app = stackStatus(NAMES.appStack);
    if (app === null) {
        note(`${NAMES.appStack} is already gone.`);
    } else {
        // Synthesised without an imageTag the application stack carries an error, and whether the
        // CLI acts on a destroy over one is not something to find out while parking; for a destroy
        // any value names it (the walkthrough's lever 3). Nothing in the data stack is touched.
        cdk(['destroy', NAMES.appStack, '-c', 'imageTag=parked', '--force']);
    }

    // Only now the database: /healthz checks no dependency, so with the database stopped first
    // ECS would keep both tasks running, and billing, while every page failed.
    const db = databaseStatus();
    if (db === null) {
        note(`Database ${NAMES.database}: absent.`);
    } else if (db === 'stopped' || db === 'stopping') {
        note(`Database ${NAMES.database}: already ${db}.`);
    } else {
        // Starting, backing up, modifying: a stop is refused until it is available, and a park
        // that quietly skipped it would leave the instance billing while reporting the idle floor.
        if (db !== 'available') {
            note(`Database ${NAMES.database} is "${db}". Waiting for it to be available so it can be stopped…`);
            aws(['rds', 'wait', 'db-instance-available', '--db-instance-identifier', NAMES.database]);
        }
        aws(['rds', 'stop-db-instance', '--db-instance-identifier', NAMES.database, '--query', 'DBInstance.DBInstanceStatus']);
        note(`Database ${NAMES.database}: stopping. Instance hours stop; storage and backups keep billing.`);
    }

    console.log('');
    status();
}

/**
 * A stopped instance is pinned to its availability zone, and a small class can be out of
 * capacity there for a while - the first resume of this environment was refused with
 * InsufficientDBInstanceCapacity. That is AWS's problem, not a mistake, and the answer is to ask
 * again: once a minute, for up to twenty minutes, saying so each time.
 */
async function startDatabase(attempts = 20) {
    for (let i = 1; i <= attempts; i++) {
        const r = aws(['rds', 'start-db-instance', '--db-instance-identifier', NAMES.database,
            '--query', 'DBInstance.DBInstanceStatus'], { allowFailure: true });
        if (r.ok) return;
        if (!/InsufficientDBInstanceCapacity/.test(r.error)) fail(r.error);
        note(`  No capacity for the database's instance class in its availability zone right now `
            + `(attempt ${i} of ${attempts}). Asking again in a minute…`);
        if (i < attempts) await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
    fail('AWS had no capacity for the database for twenty minutes. Try again later, or change the instance class in DataStack.');
}

async function resume() {
    const db = databaseStatus();
    if (db === null) fail(`Database ${NAMES.database} does not exist. Deploy ${NAMES.dataStack} first.`);
    if (db === 'stopped') {
        await startDatabase();
        note('Database starting — AWS says this can take from minutes to hours. Waiting…');
    } else if (db === 'stopping') {
        fail('The database is still stopping. Wait until it reports "stopped", then run this again.');
    } else if (db !== 'available') {
        note(`Database is "${db}". Waiting for it to become available…`);
    }
    if (db !== 'available') {
        aws(['rds', 'wait', 'db-instance-available', '--db-instance-identifier', NAMES.database]);
    }

    const chosen = option('--tag', null);
    if (chosen && (!hasTag(NAMES.apiRepository, chosen) || !hasTag(NAMES.ssrRepository, chosen))) {
        fail(`Tag ${chosen} is not in both ${NAMES.apiRepository} and ${NAMES.ssrRepository}.`);
    }
    const tag = chosen ?? newestCommonTag();
    if (!tag) fail(`No tag is present in both ${NAMES.apiRepository} and ${NAMES.ssrRepository}. Build and push a release first (ADR 0044, Phase 7).`);
    note(`Deploying ${NAMES.appStack} at image tag ${tag}.`);

    // --exclusively: the Data stack is not redeployed as a dependency, so the balancer's allow
    // rule stays what `allow` last set it to.
    cdk(['deploy', NAMES.appStack, '--exclusively', '-c', `imageTag=${tag}`, '--require-approval', 'never']);

    note('Waiting for both services to be stable…');
    aws(['ecs', 'wait', 'services-stable', '--cluster', NAMES.cluster, '--services', 'api', 'ssr']);

    note(`Checking https://${NAMES.host}/healthz — a new alias can take a moment to resolve.`);
    if (!(await healthy())) {
        // The gate stays off: an environment that cannot be shown to answer is not one a merge
        // should deploy to. This command is safe to repeat once the cause is fixed.
        fail(`https://${NAMES.host}/healthz did not answer Healthy, so the gate stays off. Until the CloudFront phase `
            + 'the balancer admits one address: if yours changed, run `node scripts/dev-env.mjs allow`, then `resume` again.');
    }
    note('Healthy.');

    gate(true);
    console.log('');
    status();
}

async function allow() {
    const cidr = option('--cidr', null) ?? `${await publicAddress()}/32`;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr);
    if (!m || m.slice(1, 5).some((octet) => Number(octet) > 255) || Number(m[5]) > 32) fail(`Not an IPv4 CIDR: ${cidr}`);
    note(`Redeploying ${NAMES.dataStack} with the balancer admitting ${cidr}. Until the CloudFront phase this is the only way in.`);
    cdk(['deploy', NAMES.dataStack, '--exclusively', '-c', `allowedCidr=${cidr}`, '--require-approval', 'never']);
}

const COMMANDS = { status, park, resume, allow };

if (!COMMANDS[COMMAND]) {
    console.error('Usage: node scripts/dev-env.mjs <status|park|resume|allow> [--env dev] [--profile mvgl-dev] [--tag <sha>] [--cidr x.x.x.x/32]');
    process.exit(1);
}

await COMMANDS[COMMAND]();
