/*
 * aws-cli.mjs — the AWS CLI, run through a profile and read as JSON, for the two dev scripts that ask AWS
 * anything: dev-env.mjs, which acts and fails loudly, and dev-check.mjs, which only reads. One place for
 * what a failed call is, so the two cannot disagree about it. No shell is involved, on any platform.
 */

import { spawnSync } from 'node:child_process';

/**
 * Runs `aws --profile <profile> --output json <args>`. Answers `{ ok: true, value }`, the answer parsed as
 * JSON (null for none), or its text with `raw`; or `{ ok: false, error, missing }` when the CLI is not
 * installed (`missing`), the call failed, or what it printed was not JSON.
 */
export function runAws(profile, args, { raw = false } = {}) {
    const r = spawnSync('aws', ['--profile', profile, '--output', 'json', ...args], { encoding: 'utf8' });
    if (r.error) {
        const missing = r.error.code === 'ENOENT';
        return { ok: false, missing, error: missing ? 'The AWS CLI is not on the PATH.' : r.error.message };
    }
    if (r.status !== 0) return { ok: false, missing: false, error: (r.stderr || '').trim() };
    const text = (r.stdout || '').trim();
    if (raw) return { ok: true, value: text };
    try {
        return { ok: true, value: text === '' ? null : JSON.parse(text) };
    } catch {
        return { ok: false, missing: false, error: `aws ${args.slice(0, 2).join(' ')} printed something that is not JSON: ${text.slice(0, 120)}` };
    }
}
