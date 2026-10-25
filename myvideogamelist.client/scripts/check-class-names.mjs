/**
 * A class name glued to an interpolation, run by `npm run lint` and so by CI.
 *
 * Tailwind writes a rule only for the classes it finds by reading the source, and in
 * `` className={`… utility${extra}`} `` it reads `utility${extra}`, which is no class, so the build has
 * no rule for that utility unless something else spells it out. The development server hides this: it
 * adds a class whenever any module it has served names one and never drops it, so the page can look
 * right there and wrong when built. A score badge lost its corner that way, in #383. (No real utility is
 * named here: if Tailwind reads this file, naming one would write its rule and hide the next loss.) So in a
 * `className` written as a template literal, an interpolation comes after a space, a quote or the
 * start of the string, never straight after a utility's last character; an interpolated value that adds
 * a class carries no leading space of its own.
 *
 * A component's own class, one a stylesheet under `src/` defines, is exempt: Tailwind writes no rule for
 * it, so there is nothing to lose. That is `game-card-list-btn${active ? ' active' : ''}`, and a name
 * built from a prefix a stylesheet defines classes under, `score-stars-${size}`.
 *
 * Prints `file:line: problem` for each, and exits non-zero if there is any.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');

function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}

const name = file => relative(root, file).split(sep).join('/');

/** A `className` given as a template literal: the literal's text, nested backticks aside. */
const CLASS_TEMPLATE = /className=\{`((?:[^`\\]|\\.)*)`\}/g;

/** An interpolation straight after what can end a class: a letter, a digit, `]`, `)`, `%` or `-`. */
const GLUED = /[\w\])%-]\$\{/g;

/** Every class a stylesheet under `src/` defines. */
const ownClasses = new Set(walk(src)
    .filter(file => file.endsWith('.css'))
    .flatMap(file => [...readFileSync(file, 'utf8').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(match => match[1])));

/** Whether the class ending where an interpolation starts is a component's own, or a prefix of one. */
function isOwnClass(template, end) {
    const token = template.slice(0, end + 1).split(/[\s'"`}]/).pop();
    return token.endsWith('-')
        ? [...ownClasses].some(own => own.startsWith(token))
        : ownClasses.has(token);
}

const problems = [];

for (const file of walk(src)) {
    if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const template of text.matchAll(CLASS_TEMPLATE)) {
        for (const glued of template[1].matchAll(GLUED)) {
            if (isOwnClass(template[1], glued.index)) continue;
            const offset = template.index + 'className={`'.length + glued.index;
            const line = text.slice(0, offset).split(/\r?\n/).length;
            problems.push(`${name(file)}:${line}: an interpolation straight after a class hides that class from Tailwind; put a space before \`\${\`.`);
        }
    }
}

for (const problem of problems) console.error(problem);
if (problems.length > 0) {
    console.error(`\n${problems.length} class name problem${problems.length === 1 ? '' : 's'}.`);
    process.exit(1);
}
