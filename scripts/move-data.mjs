/*
 * move-data.mjs — move dev's accounts and lists into production's database at launch, and rehearse it
 * inside dev's account first (ADR 0109, #465).
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------------------------
 * Dev's database holds the testers' real accounts and lists, promised to production at launch. The two
 * are in different accounts, and a snapshot of dev's cannot be shared with production's, since it is
 * encrypted with the account's AWS-managed key. So the move is a dump and a restore: a task in dev's VPC
 * dumps the database in a session that cannot write and puts the dump in a bucket in production's
 * account; a task in production's VPC fetches it and restores it into production's database, which has
 * to be empty, in one transaction. Each task counts what it read, and this compares the counts. The
 * stacks that hold the two tasks and the bucket are infra/src/Infra/MoveStack.cs.
 *
 * ---------------------------------------------------------------------------------------------
 * HOW TO RUN IT
 * ---------------------------------------------------------------------------------------------
 *   node scripts/move-data.mjs rehearse        the whole move inside dev's account, into a stand-in
 *                                              made for it, and then everything it made removed
 *   node scripts/move-data.mjs rehearse --keep the same, stopping before the removal
 *   node scripts/move-data.mjs clean --rehearsal
 *                                              removes what a rehearsal left
 *   node scripts/move-data.mjs status [--prod] which of the move's stacks exist, in dev's account and,
 *                                              with --prod, in production's
 *
 * On the day (infra/README.md, "Moving dev's data to production", says the order):
 *   node scripts/move-data.mjs dump            dev's database into production's bucket. Refuses while
 *                                              dev's API is running: nothing may write after the dump
 *   node scripts/move-data.mjs restore         the dump into production's empty database, then the
 *                                              comparison with what the dump counted
 *   node scripts/move-data.mjs clean           deletes the dump and both halves' stacks
 *
 * Options: --dev-profile (default mvgl-dev), --prod-profile (default mvgl-prod). Everything goes through
 * `aws --profile` and the pinned `cdk --profile` (`npm ci --prefix infra` installs it), so it does nothing
 * unless the SSO sessions behind those profiles are signed in. The rehearsal needs only dev's. Every
 * command is printed before it runs.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------------------------
 * It never writes to dev's database: the dump's session is read-only, and the one task the rehearsal
 * points elsewhere, the migration, is checked to name the stand-in before it is run. It never prints a
 * row: what it reads from the tasks' logs is table names, counts, sizes and timings. It never downloads
 * the dump, which goes from one task to the other inside AWS. It never deploys or destroys any stack but
 * the move's own, each with --exclusively. And it never stops dev's API: that is the owner's to do on the
 * day, and `dump` only checks that it was done.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAws } from './aws-cli.mjs';

const ARGS = process.argv.slice(2);
const COMMAND = ARGS[0];

function option(name, fallback) {
    const i = ARGS.indexOf(name);
    return i >= 0 && ARGS[i + 1] !== undefined ? ARGS[i + 1] : fallback;
}

const DEV = { env: 'dev', profile: option('--dev-profile', 'mvgl-dev') };
const PROD = { env: 'prod', profile: option('--prod-profile', 'mvgl-prod') };

/** The stack names infra/src/Infra/Program.cs gives the move's halves. Everything else is read from their outputs. */
const STACKS = {
    out: 'Mvgl-dev-MoveOut',
    in: 'Mvgl-prod-MoveIn',
    rehearsal: 'Mvgl-dev-MoveRehearsal',
};

/** The one object the bucket holds (Move.Key). */
const KEY = 'myvideogamelist.dump';

/**
 * What the rehearsal's stack makes, by name (Move.Rehearsal), for the one reading that has to find them
 * after the stack and its outputs are gone: that nothing of the rehearsal is left.
 */
const REHEARSAL = {
    standIn: 'mvgl-dev-move-rehearsal-db',
    bucket: 'mvgl-dev-move-rehearsal-334393515036',
    // The task roles are named for their families.
    families: ['mvgl-dev-move-rehearsal-dump', 'mvgl-dev-move-rehearsal-restore'],
    logGroup: '/mvgl/dev/move-rehearsal',
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INFRA = path.join(REPO_ROOT, 'infra');

// ---------------------------------------------------------------------------------------------
// Running things. A failure throws, so that the rehearsal can remove what it made on the way out.
// ---------------------------------------------------------------------------------------------

class Stop extends Error {}

function fail(message) {
    throw new Stop(message);
}

function note(message) {
    console.error(message);
}

function clock(date = new Date()) {
    return date.toISOString().slice(11, 19);
}

function aws(side, args, { allowFailure = false, raw = false } = {}) {
    console.error(`> aws --profile ${side.profile} --output json ${args.join(' ')}`);
    const r = runAws(side.profile, args, { raw });
    if (!r.ok && !allowFailure) fail(`aws ${args.slice(0, 2).join(' ')} failed:\n${r.error}`);
    return r;
}

/** The CDK CLI infra/package-lock.json pins, run as the Node program it is, with no shell. */
function cdk(side, args) {
    const entry = path.join(INFRA, 'node_modules', 'aws-cdk', 'bin', 'cdk');
    if (!existsSync(entry)) fail('The pinned CDK CLI is not installed: npm ci --prefix infra');
    const full = ['--profile', side.profile, '-c', `env=${side.env}`, ...args];
    console.error(`> cdk ${full.join(' ')}`);
    const r = spawnSync(process.execPath, [entry, ...full], { cwd: INFRA, stdio: 'inherit' });
    if (r.status !== 0) fail(`cdk ${args[0]} ${args[1]} failed with exit code ${r.status}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// Reading an account.
// ---------------------------------------------------------------------------------------------

function stackStatus(side, name) {
    const r = aws(side, ['cloudformation', 'describe-stacks', '--stack-name', name, '--query', 'Stacks[0].StackStatus'],
        { allowFailure: true });
    if (!r.ok) {
        if (/does not exist/.test(r.error)) return null;
        fail(r.error);
    }
    return r.value;
}

function outputs(side, stack) {
    const list = aws(side, ['cloudformation', 'describe-stacks', '--stack-name', stack, '--query', 'Stacks[0].Outputs']).value ?? [];
    return (key) => list.find((o) => o.OutputKey === key)?.OutputValue ?? fail(`${stack} has no ${key} output.`);
}

function requireDeployed(side, stack) {
    const status = stackStatus(side, stack);
    if (!status || !/^(CREATE|UPDATE)_COMPLETE$/.test(status)) {
        fail(`${stack} is ${status ?? 'not deployed'} in ${side.env}'s account. Deploy it first:\n`
            + `  cdk deploy ${stack} --exclusively --profile ${side.profile} -c env=${side.env}`);
    }
}

/** The network a task of the environment runs in: the Data stack's task subnets and the API's security group. */
function network(side) {
    const output = outputs(side, `Mvgl-${side.env}-Data`);
    return `awsvpcConfiguration={subnets=[${output('TaskSubnetIds')}],`
        + `securityGroups=[${output('ApiSecurityGroupId')}],assignPublicIp=ENABLED}`;
}

function database(side, identifier) {
    const r = aws(side, ['rds', 'describe-db-instances', '--db-instance-identifier', identifier, '--query',
        'DBInstances[0].{status: DBInstanceStatus, version: EngineVersion, address: Endpoint.Address, '
        + 'subnetGroup: DBSubnetGroup.DBSubnetGroupName, securityGroups: VpcSecurityGroups[].VpcSecurityGroupId}'],
    { allowFailure: true });
    if (!r.ok) {
        if (/DBInstanceNotFound/.test(r.error)) return null;
        fail(r.error);
    }
    return r.value;
}

/** The image tag a service's running task definition names for its first container. */
function serviceTag(side, service) {
    const definition = aws(side, ['ecs', 'describe-services', '--cluster', `mvgl-${side.env}`, '--services', service,
        '--query', 'services[0].taskDefinition']).value;
    return imageTag(side, definition);
}

function imageTag(side, definition) {
    const image = aws(side, ['ecs', 'describe-task-definition', '--task-definition', definition,
        '--query', 'taskDefinition.containerDefinitions[0].image']).value;
    return image?.split(':').pop() ?? null;
}

function runningMigrations(side) {
    return aws(side, ['ecs', 'list-tasks', '--cluster', `mvgl-${side.env}`, '--family', `mvgl-${side.env}-migrate`,
        '--desired-status', 'RUNNING', '--query', 'taskArns']).value ?? [];
}

// ---------------------------------------------------------------------------------------------
// Running a task and reading what it said.
// ---------------------------------------------------------------------------------------------

function runTask(side, family, net, overrides = null) {
    const args = ['ecs', 'run-task', '--cluster', `mvgl-${side.env}`, '--task-definition', family,
        '--launch-type', 'FARGATE', '--network-configuration', net, '--started-by', 'mvgl-move',
        '--query', '{task: tasks[0].taskArn, failures: failures}'];
    if (overrides) args.push('--overrides', JSON.stringify(overrides));
    const started = aws(side, args).value;
    if (!started?.task) fail(`${family} did not start: ${JSON.stringify(started?.failures ?? [])}`);
    return started.task;
}

/**
 * Waits for a task to stop and answers how each of its containers ended. Its own loop, as dev-env.mjs's
 * is, because `aws ecs wait tasks-stopped` gives up at ten minutes.
 */
async function stopped(side, task, minutes = 30) {
    const deadline = Date.now() + minutes * 60_000;
    let last = null;
    for (;;) {
        const now = aws(side, ['ecs', 'describe-tasks', '--cluster', `mvgl-${side.env}`, '--tasks', task, '--query',
            'tasks[0].{status: lastStatus, reason: stoppedReason, containers: containers[].{name: name, exit: exitCode, reason: reason}}']).value;
        if (now?.status === 'STOPPED') return now;
        if (now?.status !== last) note(`  ${clock()} ${now?.status ?? 'not found yet'}…`);
        last = now?.status;
        if (Date.now() >= deadline) fail(`${task} has not stopped after ${minutes} minutes. Look at it before running anything else.`);
        await sleep(10_000);
    }
}

function exitOf(task, container) {
    return task.containers?.find((c) => c.name === container)?.exit ?? null;
}

/**
 * A container's log, once its last line has arrived: CloudWatch can hold a line back for a few seconds
 * after the task has stopped.
 */
async function logOf(side, group, stream, last, attempts = 12) {
    let lines = [];
    for (let i = 1; i <= attempts; i++) {
        const r = aws(side, ['logs', 'get-log-events', '--log-group-name', group, '--log-stream-name', stream,
            '--start-from-head', '--query', 'events[].message'], { allowFailure: true });
        lines = r.ok && Array.isArray(r.value) ? r.value : [];
        if (lines.some((line) => line.startsWith(last))) return lines;
        if (i < attempts) await sleep(5_000);
    }
    return lines;
}

const taskId = (arn) => arn.split('/').pop();

/** What a dump task said: its lines, the two counts and the dump's size and digest. */
async function readDump(side, group, task) {
    const id = taskId(task.arn);
    const dump = await logOf(side, group, `move/dump/${id}`, 'dump: done');
    const upload = await logOf(side, group, `move/upload/${id}`, 'upload: done');
    for (const line of [...dump, ...upload]) note(`  | ${line}`);
    const dumped = dump.find((line) => line.startsWith('dumped '));
    return {
        before: tagged(dump, 'before'),
        after: tagged(dump, 'after'),
        sha256: dumped?.match(/sha256 ([0-9a-f]{64})/)?.[1] ?? null,
        bytes: Number(dumped?.match(/^dumped (\d+) bytes/)?.[1] ?? NaN),
        seconds: Number(dumped?.match(/in (\d+)s/)?.[1] ?? NaN),
        uploadSeconds: Number(upload.find((line) => line.startsWith('uploaded '))?.match(/in (\d+)s/)?.[1] ?? NaN),
        uploaded: upload.includes('upload: done'),
    };
}

/** What the restore container's exit code means: MoveStack.cs's RestoreScript gives each its own. */
const RESTORE_EXIT = {
    refusedNotEmpty: 3,
    restoredUncounted: 4,
    refusedOtherDump: 5,
};

/**
 * Runs the restore task for one dump, named by the digest its dump task printed. The restore container
 * refuses any other, so an older dump left in the bucket by a failed upload is never restored.
 */
function runRestore(side, family, net, sha256) {
    if (!/^[0-9a-f]{64}$/.test(sha256 ?? '')) fail('No dump\'s digest to restore by, so nothing was restored.');
    return runTask(side, family, net, {
        containerOverrides: [{ name: 'restore', environment: [{ name: 'EXPECTED_SHA256', value: sha256 }] }],
    });
}

async function readRestore(side, group, task) {
    const id = taskId(task.arn);
    const download = await logOf(side, group, `move/download/${id}`, 'download: done');
    const exit = exitOf(task, 'restore');
    const last = exit === RESTORE_EXIT.refusedNotEmpty || exit === RESTORE_EXIT.refusedOtherDump ? 'Refused'
        : exit === RESTORE_EXIT.restoredUncounted ? 'Restored, and committed' : 'restore: done';
    const restore = await logOf(side, group, `move/restore/${id}`, last);
    for (const line of [...download, ...restore]) note(`  | ${line}`);
    const downloaded = download.find((line) => line.startsWith('downloaded '));
    return {
        copy: tagged(restore, 'copy'),
        sha256: downloaded?.match(/sha256 ([0-9a-f]{64})/)?.[1] ?? null,
        seconds: Number(restore.find((line) => line.startsWith('restored in '))?.match(/in (\d+)s/)?.[1] ?? NaN),
        refused: restore.some((line) => line.startsWith('Refused')),
    };
}

/** The check's lines under one prefix, without the server's version, which may differ by a minor. */
function tagged(lines, prefix) {
    return lines.filter((line) => line.startsWith(`${prefix} `)).map((line) => line.slice(prefix.length + 1))
        .filter((line) => !line.startsWith('server '));
}

/** Names the lines two counts disagree on, and says whether they agree. Table names and numbers only. */
function compare(nameA, a, nameB, b) {
    const missing = a.filter((line) => !b.includes(line));
    const extra = b.filter((line) => !a.includes(line));
    if (a.length === 0 || b.length === 0) {
        note(`  ${nameA}: ${a.length} lines, ${nameB}: ${b.length} lines. One of them said nothing, so nothing was compared.`);
        return false;
    }
    if (missing.length === 0 && extra.length === 0) {
        note(`  ${nameA} and ${nameB}: the same ${a.length} lines (migrations, every table's rows, every sequence).`);
        return true;
    }
    note(`  ${nameA} and ${nameB} differ:`);
    for (const line of missing) note(`    only in ${nameA}: ${line}`);
    for (const line of extra) note(`    only in ${nameB}: ${line}`);
    return false;
}

// ---------------------------------------------------------------------------------------------
// Removing what a move made.
// ---------------------------------------------------------------------------------------------

function emptyBucket(side, bucket) {
    const exists = aws(side, ['s3api', 'head-bucket', '--bucket', bucket], { allowFailure: true });
    if (!exists.ok) {
        if (/404|Not Found|NoSuchBucket/i.test(exists.error)) return 'absent';
        fail(exists.error);
    }
    aws(side, ['s3api', 'delete-object', '--bucket', bucket, '--key', KEY]);
    const uploads = aws(side, ['s3api', 'list-multipart-uploads', '--bucket', bucket,
        '--query', 'Uploads[].{key: Key, id: UploadId}']).value ?? [];
    for (const upload of uploads) {
        aws(side, ['s3api', 'abort-multipart-upload', '--bucket', bucket, '--key', upload.key, '--upload-id', upload.id]);
    }
    // The objects themselves, counted: the CLI pages this call, and a field of one page, KeyCount, comes
    // back null once it has.
    const left = aws(side, ['s3api', 'list-objects-v2', '--bucket', bucket, '--query', 'length(Contents || `[]`)']).value;
    if (left !== 0) fail(`${bucket} still holds ${left} objects after the dump was deleted. Look before destroying anything.`);
    return 'emptied';
}

function deleteTaskDefinitions(side, family) {
    for (const status of ['ACTIVE', 'INACTIVE']) {
        const arns = aws(side, ['ecs', 'list-task-definitions', '--family-prefix', family, '--status', status,
            '--query', 'taskDefinitionArns']).value ?? [];
        // Only this family, not another whose name begins the same way.
        const own = arns.filter((arn) => arn.split('/').pop().replace(/:\d+$/, '') === family);
        if (status === 'ACTIVE' && own.length > 0) {
            for (const arn of own) aws(side, ['ecs', 'deregister-task-definition', '--task-definition', arn, '--query', 'taskDefinition.status']);
        }
        for (let i = 0; i < own.length; i += 10) {
            aws(side, ['ecs', 'delete-task-definitions', '--task-definitions', ...own.slice(i, i + 10), '--query', 'length(taskDefinitions)']);
        }
    }
}

/** Destroys one of the move's stacks, after emptying its bucket, and deletes its task definitions. */
function destroyHalf(side, stack) {
    const status = stackStatus(side, stack);
    if (status === null) {
        note(`${stack} is not there in ${side.env}'s account.`);
        return;
    }
    const output = outputs(side, stack);
    const families = ['DumpTaskFamily', 'RestoreTaskFamily'].map((key) => {
        try { return output(key); } catch { return null; }
    }).filter(Boolean);
    // The half that restores holds the bucket; the dump's half only names the other account's.
    if (families.some((family) => family.endsWith('-restore'))) {
        const bucket = output('BucketName');
        note(`The bucket ${bucket}: ${emptyBucket(side, bucket)}.`);
    }
    cdk(side, ['destroy', stack, '--exclusively', '--force']);
    for (const family of families) deleteTaskDefinitions(side, family);
}

// ---------------------------------------------------------------------------------------------
// The rehearsal, inside dev's account.
// ---------------------------------------------------------------------------------------------

const steps = [];

/** Runs a step and records when it started and ended, and whether it worked, whichever way it ends. */
async function step(name, work) {
    const started = new Date();
    note(`\n== ${clock(started)} ${name}`);
    let outcome = 'failed';
    try {
        const result = await work();
        outcome = 'done';
        return result;
    } finally {
        const ended = new Date();
        steps.push({ name, started, ended, outcome });
        note(`== ${clock(ended)} ${name}: ${outcome}, ${Math.round((ended - started) / 1000)}s`);
    }
}

function summary() {
    if (steps.length === 0) return;
    console.log('\nStep | Started (UTC) | Ended (UTC) | Took | Outcome');
    console.log('---|---|---|---|---');
    for (const s of steps) {
        const took = Math.round((s.ended - s.started) / 1000);
        console.log(`${s.name} | ${clock(s.started)} | ${clock(s.ended)} | ${Math.floor(took / 60)}m ${took % 60}s | ${s.outcome}`);
    }
}

async function rehearse() {
    const keep = ARGS.includes('--keep');
    const live = database(DEV, 'mvgl-dev-db');
    const findings = {};
    // Whether this run has begun to deploy the stack. Until it has, nothing in the account is its to
    // remove: a stack already there is another run's, or one kept on purpose with --keep.
    let deploying = false;
    try {
        await step('Preflight', () => {
            if (!live) fail('Dev\'s database mvgl-dev-db is not there.');
            // A parked database would have to be started, which is a change to it; the rehearsal does not make one.
            if (live.status !== 'available') fail(`Dev's database is "${live.status}". The rehearsal reads only an available one, and starts nothing.`);
            if (live.securityGroups?.length !== 1) fail(`Dev's database has ${live.securityGroups?.length} security groups; the stand-in expects one.`);
            if (stackStatus(DEV, STACKS.rehearsal) !== null) {
                fail(`${STACKS.rehearsal} is already there, from another rehearsal, and is left as it is. `
                    + 'Once nobody needs it: node scripts/move-data.mjs clean --rehearsal');
            }
            const migrations = runningMigrations(DEV);
            if (migrations.length > 0) fail(`A migration task is running (${migrations.join(', ')}). Wait for the release to finish.`);
            findings.apiTag = serviceTag(DEV, 'api');
            findings.migrateTag = imageTag(DEV, 'mvgl-dev-migrate');
            note(`Dev's database: PostgreSQL ${live.version}. Its API runs ${findings.apiTag}, its migration task ${findings.migrateTag}.`);
            if (findings.apiTag !== findings.migrateTag) note('  The two differ, so the migration on the stand-in is not the one the API was migrated with.');
        });

        deploying = true;
        await step(`Deploy ${STACKS.rehearsal}, the stand-in included`, () => cdk(DEV, ['deploy', STACKS.rehearsal, '--exclusively',
            '--require-approval', 'never',
            '--parameters', `LiveSubnetGroup=${live.subnetGroup}`, '--parameters', `LiveSecurityGroup=${live.securityGroups[0]}`]));

        const output = outputs(DEV, STACKS.rehearsal);
        const group = output('DumpLogGroup');
        const standIn = database(DEV, output('StandInIdentifier'));
        if (!standIn || standIn.address === live.address) fail('The stand-in is not a database of its own.');
        note(`The stand-in: PostgreSQL ${standIn.version} at ${standIn.address}.`);
        const net = network(DEV);

        const dump = await step('Dump the live database into the bucket', async () => {
            const arn = runTask(DEV, output('DumpTaskFamily'), net);
            const task = { arn, ...(await stopped(DEV, arn)) };
            const read = await readDump(DEV, group, task);
            if (exitOf(task, 'dump') !== 0 || exitOf(task, 'upload') !== 0) {
                fail(`The dump task failed: dump ${exitOf(task, 'dump')}, upload ${exitOf(task, 'upload')} (${task.reason}).`);
            }
            if (!read.uploaded) fail('The dump task did not say its upload finished.');
            return read;
        });

        // Named by a digest that is not the dump's, as an older dump left in the bucket would be. It must
        // refuse before it touches the stand-in, which the restore after it, into a database that has to
        // be empty, then shows.
        await step('Restore a dump it was not given, which must refuse', async () => {
            const arn = runRestore(DEV, output('RestoreTaskFamily'), net, '0'.repeat(64));
            const task = { arn, ...(await stopped(DEV, arn)) };
            const read = await readRestore(DEV, group, task);
            findings.refusedOther = exitOf(task, 'restore') === RESTORE_EXIT.refusedOtherDump && read.refused;
            if (!findings.refusedOther) fail(`A restore named by another digest was not refused: restore exited ${exitOf(task, 'restore')}.`);
        });

        const restore = await step('Restore the dump into the stand-in', async () => {
            const arn = runRestore(DEV, output('RestoreTaskFamily'), net, dump.sha256);
            const task = { arn, ...(await stopped(DEV, arn)) };
            const read = await readRestore(DEV, group, task);
            if (exitOf(task, 'download') !== 0 || exitOf(task, 'restore') !== 0) {
                fail(`The restore task failed: download ${exitOf(task, 'download')}, restore ${exitOf(task, 'restore')} (${task.reason}).`);
            }
            return read;
        });

        await step('Restore again, which must refuse', async () => {
            const arn = runRestore(DEV, output('RestoreTaskFamily'), net, dump.sha256);
            const task = { arn, ...(await stopped(DEV, arn)) };
            const read = await readRestore(DEV, group, task);
            findings.refused = exitOf(task, 'restore') === RESTORE_EXIT.refusedNotEmpty && read.refused;
            if (!findings.refused) fail(`The second restore was not refused: restore exited ${exitOf(task, 'restore')}.`);
        });

        await step('Migrate the stand-in at dev\'s tag', async () => {
            const definition = aws(DEV, ['ecs', 'describe-task-definition', '--task-definition', 'mvgl-dev-migrate',
                '--query', 'taskDefinition.containerDefinitions[0].{name: name, environment: environment}']).value;
            const current = definition.environment.find((e) => e.name === 'ConnectionStrings__DefaultConnection')?.value ?? '';
            const pointed = current.replace(`Host=${live.address};`, `Host=${standIn.address};`);
            // Never the live database: the string must have changed, and name the stand-in alone.
            if (pointed === current || !pointed.includes(`Host=${standIn.address};`) || pointed.includes(live.address)) {
                fail('Could not point the migration task at the stand-in, so it was not run.');
            }
            const overrides = { containerOverrides: [{ name: definition.name, environment: [{ name: 'ConnectionStrings__DefaultConnection', value: pointed }] }] };
            const arn = runTask(DEV, 'mvgl-dev-migrate', net, overrides);
            const sent = aws(DEV, ['ecs', 'describe-tasks', '--cluster', 'mvgl-dev', '--tasks', arn,
                '--query', 'tasks[0].overrides.containerOverrides[0].environment[0].value']).value;
            if (sent !== pointed) fail(`The migration task ${arn} started without the stand-in's host. Stop it now: aws ecs stop-task --cluster mvgl-dev --task ${arn}`);
            const task = await stopped(DEV, arn);
            const log = await logOf(DEV, '/mvgl/dev/migrate', `migrate/migrate/${taskId(arn)}`, 'Done');
            for (const line of log) note(`  | ${line}`);
            findings.migrationLog = log;
            findings.migrateExit = task.containers?.[0]?.exit ?? null;
            // The stream is the rehearsal's, in the live task's group: it goes with the rest.
            aws(DEV, ['logs', 'delete-log-stream', '--log-group-name', '/mvgl/dev/migrate', '--log-stream-name', `migrate/migrate/${taskId(arn)}`]);
            if (findings.migrateExit !== 0) fail(`The migration task exited ${findings.migrateExit} on the stand-in.`);
        });

        await step('Compare', async () => {
            findings.steady = compare('live before the dump', dump.before, 'live after it', dump.after);
            findings.same = compare('live after the dump', dump.after, 'the stand-in', restore.copy);
            findings.bytesIntact = dump.sha256 !== null && dump.sha256 === restore.sha256;
            note(`  The dump: ${dump.bytes} bytes, dumped in ${dump.seconds}s and uploaded in ${dump.uploadSeconds}s; restored in ${restore.seconds}s. `
                + `The digest the restore read ${findings.bytesIntact ? 'is' : 'is NOT'} the one the dump wrote.`);
        });
    } catch (error) {
        if (!(error instanceof Stop)) throw error;
        note(`\n${error.message}`);
        findings.failed = true;
    } finally {
        if (!deploying) {
            note('\nThis run made nothing, so it removes nothing.');
        } else if (keep) {
            note(`\n--keep: ${STACKS.rehearsal} and the stand-in are left as they are. Remove them today: node scripts/move-data.mjs clean --rehearsal`);
        } else {
            try {
                await step('Remove everything the rehearsal made', () => cleanRehearsal());
            } catch (error) {
                if (!(error instanceof Stop)) throw error;
                note(`\n${error.message}\nRemove what is left today: node scripts/move-data.mjs clean --rehearsal`);
                findings.failed = true;
            }
        }
        summary();
    }
    // A live database that moved while it was dumped makes the comparison prove nothing, whatever it says.
    if (findings.steady === false) note('\nDev\'s counts moved while it was dumped, so this rehearsal proves nothing. Run it again.');
    if (findings.failed || !findings.steady || !findings.same || !findings.bytesIntact) process.exitCode = 1;
}

async function cleanRehearsal() {
    destroyHalf(DEV, STACKS.rehearsal);
    // The families by their names, in case the stack went before its outputs could be read.
    for (const family of REHEARSAL.families) deleteTaskDefinitions(DEV, family);
    leftovers();
}

/** Reads dev's account for anything of the rehearsal's that is still there, and fails if it finds one. */
function leftovers() {
    const found = [];
    if (stackStatus(DEV, STACKS.rehearsal) !== null) found.push(`the stack ${STACKS.rehearsal}`);
    if (database(DEV, REHEARSAL.standIn) !== null) found.push('the stand-in database');
    const snapshots = aws(DEV, ['rds', 'describe-db-snapshots', '--db-instance-identifier', REHEARSAL.standIn, '--query', 'length(DBSnapshots)']).value;
    if (snapshots) found.push(`${snapshots} snapshots of the stand-in`);
    const backups = aws(DEV, ['rds', 'describe-db-instance-automated-backups', '--db-instance-identifier', REHEARSAL.standIn,
        '--query', 'length(DBInstanceAutomatedBackups)'], { allowFailure: true });
    if (backups.ok && backups.value) found.push('the stand-in\'s automated backups');
    if (aws(DEV, ['s3api', 'head-bucket', '--bucket', REHEARSAL.bucket], { allowFailure: true }).ok) found.push('the bucket');
    for (const role of REHEARSAL.families) {
        if (aws(DEV, ['iam', 'get-role', '--role-name', role, '--query', 'Role.RoleName'], { allowFailure: true }).ok) found.push(`the role ${role}`);
    }
    for (const family of REHEARSAL.families) {
        for (const status of ['ACTIVE', 'INACTIVE']) {
            const arns = aws(DEV, ['ecs', 'list-task-definitions', '--family-prefix', family, '--status', status, '--query', 'taskDefinitionArns']).value ?? [];
            if (arns.length > 0) found.push(`${arns.length} ${status.toLowerCase()} revisions of ${family}`);
        }
    }
    const groups = aws(DEV, ['logs', 'describe-log-groups', '--log-group-name-prefix', REHEARSAL.logGroup, '--query', 'length(logGroups)']).value;
    if (groups) found.push(`the log group ${REHEARSAL.logGroup}`);
    if (found.length > 0) fail(`Still there in dev's account: ${found.join('; ')}.`);
    note('Nothing of the rehearsal is left in dev\'s account: no stack, database, snapshot, backup, bucket, role, task definition or log group.');
}

// ---------------------------------------------------------------------------------------------
// The day.
// ---------------------------------------------------------------------------------------------

async function dump() {
    requireDeployed(DEV, STACKS.out);
    // Nothing may write to dev after the dump, or it is lost: the API is the only writer, its background
    // work included, so it has to be stopped, by the owner, before this runs. Read without allowing a
    // failure: an answer that cannot be read is not an answer that the API has stopped.
    const api = aws(DEV, ['ecs', 'describe-services', '--cluster', 'mvgl-dev', '--services', 'api', '--query',
        '{service: services[0].{status: status, desired: desiredCount, running: runningCount, pending: pendingCount}, missing: failures[].reason}']).value;
    if (api?.service) {
        if (api.service.desired !== 0 || api.service.running !== 0 || api.service.pending !== 0) {
            fail(`Dev's API is running (${api.service.running} of ${api.service.desired}), and anything it writes after the dump would be lost. Stop it first:\n`
                + `  aws ecs update-service --profile ${DEV.profile} --cluster mvgl-dev --service api --desired-count 0`);
        }
    } else if (!api?.missing?.includes('MISSING')) {
        fail(`ECS said neither that dev's API service exists nor that it is missing (${JSON.stringify(api)}), so whether it is stopped is not known.`);
    }
    const migrations = runningMigrations(DEV);
    if (migrations.length > 0) fail(`A migration task is running (${migrations.join(', ')}). Wait for it.`);
    // What migrated the database last is the migration task's newest revision, whether a release or a resume ran it.
    note(`Dev's database is at the migrations of ${imageTag(DEV, 'mvgl-dev-migrate')}, the tag its migration task last ran. `
        + 'Production\'s newest tag must be the same.');

    const output = outputs(DEV, STACKS.out);
    const arn = await step('Dump dev\'s database into production\'s bucket', async () => {
        const started = runTask(DEV, output('DumpTaskFamily'), network(DEV));
        const task = { arn: started, ...(await stopped(DEV, started)) };
        const read = await readDump(DEV, output('DumpLogGroup'), task);
        if (exitOf(task, 'dump') !== 0 || exitOf(task, 'upload') !== 0) {
            fail(`The dump task failed: dump ${exitOf(task, 'dump')}, upload ${exitOf(task, 'upload')} (${task.reason}). Nothing was restored; run it again.`);
        }
        // Counts that moved while the dump ran mean something wrote: the dump is not the last state, and
        // restoring it would lose what came after. Caught here, production is still untouched.
        if (!compare('dev before the dump', read.before, 'dev after it', read.after)) {
            fail('Dev\'s database changed while it was being dumped, so something still writes to it. Find it and stop it, '
                + 'then dump again: the dump in the bucket is replaced by the next one.');
        }
        return started;
    });
    summary();
    note(`\nDumped (${taskId(arn)}). Next, with production's profile signed in: node scripts/move-data.mjs restore`);
}

async function restore() {
    requireDeployed(PROD, STACKS.in);
    requireDeployed(DEV, STACKS.out);
    const output = outputs(PROD, STACKS.in);

    // The newest dump, from its task's log in dev's account, judged before production is touched: one whose
    // upload did not finish, or whose counts moved while it ran, is not one to restore. The restore is then
    // given its digest, and refuses whatever else the bucket holds.
    const devOutput = outputs(DEV, STACKS.out);
    const group = devOutput('DumpLogGroup');
    const streams = aws(DEV, ['logs', 'describe-log-streams', '--log-group-name', group, '--log-stream-name-prefix', 'move/dump/',
        '--query', 'logStreams[].{name: logStreamName, last: lastEventTimestamp}']).value ?? [];
    const newest = streams.sort((a, b) => (b.last ?? 0) - (a.last ?? 0))[0];
    if (!newest) fail(`No dump's log in ${group}, so there is nothing to restore.`);
    const dumped = await readDump(DEV, group, { arn: newest.name.replace('move/dump/', '') });
    if (!dumped.uploaded) fail('The newest dump\'s upload did not finish, so the bucket does not hold it. Nothing was restored; dump again.');
    if (!compare('dev before the dump', dumped.before, 'dev after it', dumped.after)) {
        fail('Dev\'s counts moved while the newest dump ran. Nothing was restored; stop what writes, and dump again.');
    }

    const read = await step('Restore the dump into production\'s database', async () => {
        const started = runRestore(PROD, output('RestoreTaskFamily'), network(PROD), dumped.sha256);
        const task = { arn: started, ...(await stopped(PROD, started)) };
        const result = await readRestore(PROD, output('RestoreLogGroup'), task);
        const exit = exitOf(task, 'restore');
        if (exit === RESTORE_EXIT.refusedOtherDump) {
            fail('Refused: the bucket holds another dump than the newest one dev wrote. Nothing was written; dump again.');
        }
        if (exit === RESTORE_EXIT.refusedNotEmpty) {
            fail('Refused: production\'s database is not empty. Nothing was written. Infra/README.md says what to do.');
        }
        // Exit 4, or any failure after the line that says pg_restore finished, as a task stopped from outside
        // would be: the copy is committed either way.
        if (exit === RESTORE_EXIT.restoredUncounted || (exit !== 0 && Number.isFinite(result.seconds))) {
            fail('Restored and committed, but what followed it failed, so the copy was not counted. Production\'s database now '
                + 'holds the copy and refuses another restore. Do not open the door; infra/README.md says what to do.');
        }
        if (exitOf(task, 'download') !== 0 || exit !== 0) {
            fail(`The restore task failed: download ${exitOf(task, 'download')}, restore ${exit} (${task.reason}). `
                + 'Nothing was committed, so production\'s database is as empty as it was; run it again once the cause is known.');
        }
        return result;
    });

    const same = compare('dev after the dump', dumped.after, 'production', read.copy);
    const intact = dumped.sha256 !== null && dumped.sha256 === read.sha256;
    note(`  The digest the restore read ${intact ? 'is' : 'is NOT'} the one the dump wrote.`);
    summary();
    if (!same || !intact) fail('The copy is not what was dumped. Do not open the door; infra/README.md says how to go back.');
    note('\nRestored, and the same. Next: node scripts/move-data.mjs clean, then the first resume of production.');
}

async function clean() {
    if (ARGS.includes('--rehearsal')) {
        await cleanRehearsal();
        return;
    }
    destroyHalf(PROD, STACKS.in);
    destroyHalf(DEV, STACKS.out);
    note('The dump is deleted and both halves are gone.');
}

function status() {
    console.log(`${STACKS.rehearsal} (dev): ${stackStatus(DEV, STACKS.rehearsal) ?? 'absent'}`);
    console.log(`${STACKS.out} (dev): ${stackStatus(DEV, STACKS.out) ?? 'absent'}`);
    // Production's account only when asked: until the day, nothing of the move's is there, and a rehearsal
    // has no business reading it.
    if (!ARGS.includes('--prod')) {
        console.log(`${STACKS.in} (prod): not asked; add --prod to read production's account`);
        return;
    }
    const prod = aws(PROD, ['cloudformation', 'describe-stacks', '--stack-name', STACKS.in, '--query', 'Stacks[0].StackStatus'], { allowFailure: true });
    console.log(`${STACKS.in} (prod): ${prod.ok ? prod.value : /does not exist/.test(prod.error) ? 'absent' : `unknown (${prod.error.split('\n')[0]})`}`);
}

const COMMANDS = { rehearse, clean, status, dump, restore };

if (!COMMANDS[COMMAND]) {
    console.error('Usage: node scripts/move-data.mjs <rehearse [--keep]|clean [--rehearsal]|status|dump|restore> [--dev-profile <p>] [--prod-profile <p>]');
    process.exit(1);
}

try {
    await COMMANDS[COMMAND]();
} catch (error) {
    if (!(error instanceof Stop)) throw error;
    console.error(`\n${error.message}`);
    process.exit(1);
}
