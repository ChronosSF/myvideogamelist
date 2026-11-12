/*
 * check-decisions.mjs: every decision record has a number of its own, and the index lists each one.
 *
 *   node scripts/check-decisions.mjs
 *
 * A new record takes its pull request's number (docs/decisions/README.md, "Numbering"), which two
 * branches cannot share. Records before that rule took the next free number, and branches written at
 * the same time took the same one. This is what catches a clash that gets through anyway, on the pull
 * request rather than after the merge, along with a record left out of the index and an index row
 * whose file is gone. CI runs it in the Secret scan job. It reads the files and nothing else.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DECISIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'decisions');
const RECORD = /^(\d{4,})-[a-z0-9-]+\.md$/;

const records = readdirSync(DECISIONS).filter(name => RECORD.test(name)).sort();
const index = readFileSync(path.join(DECISIONS, 'README.md'), 'utf8');
const linked = new Set([...index.matchAll(/\]\((\d{4,}-[a-z0-9-]+\.md)\)/g)].map(match => match[1]));

const problems = [];

const byNumber = new Map();
for (const name of records) {
    const number = RECORD.exec(name)[1];
    byNumber.set(number, [...(byNumber.get(number) ?? []), name]);
}
for (const [number, names] of byNumber) {
    if (names.length > 1) {
        problems.push(`${number} is the number of ${names.length} records: ${names.join(', ')}. `
            + 'A new record takes its pull request\'s number; rename yours, and every reference to it.');
    }
}

for (const name of records) {
    if (!linked.has(name)) problems.push(`${name} is not in docs/decisions/README.md's index.`);
}
for (const name of linked) {
    if (!records.includes(name)) problems.push(`docs/decisions/README.md links ${name}, which does not exist.`);
}

if (problems.length > 0) {
    // As GitHub annotations in CI, and plain lines anywhere else: the prefix reads fine either way.
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
}

console.log(`${records.length} decision records, each with a number of its own and a row in the index.`);
