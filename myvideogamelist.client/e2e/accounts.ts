import { randomBytes } from 'node:crypto';

/**
 * The header `apiFetch` adds to every write, for a harness that writes to the API itself. The API refuses a
 * write without it (ADR 0033).
 */
export const WRITE = { 'X-MVGL-Request': '1' } as const;

/**
 * A username no earlier run has taken, since the harnesses' databases keep every account a run registers:
 * `prefix`, the time in base 36 and four random hex digits, sixteen characters with a four-character
 * prefix, of the twenty allowed. From `node:crypto` rather than `Math.random`, which CodeQL flags wherever
 * its value meets a sign-up form.
 */
export function newUserName(prefix: string): string {
    return `${prefix}${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
}
