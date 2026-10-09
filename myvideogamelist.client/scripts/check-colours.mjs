/**
 * The client's colour rules, run by `npm run lint` and so by CI.
 *
 * One theme, dark (ADR 0048). A `light:` variant or a `[data-theme='light']` selector styles a theme
 * that no longer exists, so either is an error wherever it appears: written today it would do
 * nothing, and it would bring the second set of overrides back one component at a time.
 *
 * Prints `file:line: problem` for each, and exits non-zero if there is any.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/', import.meta.url));

function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}

/** A class with a `light` variant, starting where a class can: never inside a word like `spotlight:`. */
const LIGHT_VARIANT = /(?:^|[\s"'`])(?:[a-z0-9-]+:)*light:\S/;
const LIGHT_SELECTOR = /\[data-theme=['"]?light['"]?\]|@custom-variant\s+light\b/;

const problems = [];
for (const file of walk(src)) {
    const pattern = /\.(ts|tsx)$/.test(file) ? LIGHT_VARIANT : file.endsWith('.css') ? LIGHT_SELECTOR : null;
    if (pattern === null) continue;

    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
        if (pattern.test(line)) {
            problems.push(`${relative(src, file)}:${index + 1}: styles the light theme, which was removed (ADR 0048)`);
        }
    });
}

for (const problem of problems) console.error(problem);
if (problems.length > 0) {
    console.error(`\n${problems.length} colour problem${problems.length === 1 ? '' : 's'}.`);
    process.exit(1);
}
