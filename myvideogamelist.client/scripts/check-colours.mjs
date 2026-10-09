/**
 * The client's colour rules, run by `npm run lint` and so by CI.
 *
 * 1. One theme, dark (ADR 0048). A `light:` variant or a `[data-theme='light']` selector styles a
 *    theme that no longer exists, so either is an error wherever it appears.
 *
 * 2. Every colour is a token from `src/theme.css` (ADR 0049). A colour written anywhere else is an
 *    error: a hex, an `rgb()` or `hsl()`, a named colour, or a Tailwind palette class such as
 *    `text-slate-400` or `bg-[#123456]`. Translucent black and white are allowed, because they shade
 *    whatever is under them rather than colouring it: shadows, scrims, a hover's sheen. Tests style
 *    nothing and are not checked.
 *
 * Rule 2 is a ratchet while #209 moves the client onto the tokens. `scripts/colour-baseline.json` says
 * how many raw colours each file not yet moved still has. A file must have exactly that many: more is
 * a colour written by hand, and fewer means the list is out of date. A file not in the list may have
 * none, which is every new file. `node scripts/check-colours.mjs --update` rewrites the list from what
 * is there, and refuses to raise a count or add a file.
 *
 * Prints `file:line: problem` for each, and exits non-zero if there is any.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const baselineFile = join(root, 'scripts', 'colour-baseline.json');
const update = process.argv.includes('--update');

/** The one file where a colour may be written. */
const PALETTE = 'src/theme.css';

function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}

const name = file => relative(root, file).split(sep).join('/');

// ── Rule 1 ────────────────────────────────────────────────────────────────────

/** A class with a `light` variant, starting where a class can: never inside a word like `spotlight:`. */
const LIGHT_VARIANT = /(?:^|[\s"'`])(?:[a-z0-9-]+:)*light:\S/;
const LIGHT_SELECTOR = /\[data-theme=['"]?light['"]?\]|@custom-variant\s+light\b/;

// ── Rule 2 ────────────────────────────────────────────────────────────────────

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\)/g;
const NAMED = /\b(?:white|black|red|green|blue|gr[ae]y|yellow|orange|purple|pink|silver|navy|lime|teal)\b/g;
const COLOUR_PROPERTY = /^(?:--|color$|background|border|outline|fill$|stroke$|box-shadow$|text-shadow$|caret-color$|accent-color$|text-decoration|column-rule)/;
const HUES = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
// A hex or an rgb() in an arbitrary value, `bg-[#123456]`, is caught by HEX and FUNCTION.
const PALETTE_CLASS = new RegExp(
    '(?<![\\w-])(?:[a-z0-9-]+:)*'
    + '(?:text|bg|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|from|via|to|fill|stroke|shadow|placeholder|decoration|accent|caret)'
    + `-(?:(?:${HUES})-\\d{2,3}|white|black)`
    + '(?:\\/\\d{1,3})?(?![\\w-])',
    'g',
);
/** Tailwind's own palette read as a variable, which is the palette class by another route. */
const PALETTE_VARIABLE = new RegExp(`var\\(--color-(?:(?:${HUES})-\\d{2,3}|white|black)\\b`, 'g');

/** Black or white with an alpha under 1, written any of the ways the files write it. */
function isShade(colour) {
    const value = colour.toLowerCase().trim();
    // `rgba(0, 0, 0, 0.5)` and `rgb(0 0 0 / 50%)` alike: four numbers, whatever separates them.
    const fn = value.match(/^rgba?\(([^()]*)\)$/);
    if (fn) {
        const parts = fn[1].replace(/[,/]/g, ' ').trim().split(/\s+/);
        if (parts.length !== 4) return false;
        const [r, g, b] = parts.slice(0, 3).map(Number);
        const alpha = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
        return alpha < 1 && ((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255));
    }
    // Tailwind's own: `bg-black/50`, `hover:bg-white/10`.
    return /(?:^|:)[a-z-]+-(?:white|black)\/\d{1,2}$/.test(value);
}

/** The raw colours in a stylesheet, by line. The palette's own and the shades are not counted. */
function stylesheetColours(text) {
    const found = [];
    postcss.parse(text).walkDecls(decl => {
        const palette = decl.value.match(PALETTE_VARIABLE) ?? [];
        const value = decl.value.replace(/var\([^()]*\)/g, '');
        const colours = [...palette, ...value.match(HEX) ?? [], ...value.match(FUNCTION) ?? []];
        if (COLOUR_PROPERTY.test(decl.prop)) colours.push(...value.match(NAMED) ?? []);
        for (const colour of colours.filter(c => !isShade(c))) found.push({ line: decl.source.start.line, colour });
    });
    return found;
}

/** The raw colours in a component or a module, by line: palette classes, and hex or rgb() in strings. */
function scriptColours(text) {
    const found = [];
    text.split(/\r?\n/).forEach((line, index) => {
        const colours = [
            ...line.match(PALETTE_CLASS) ?? [],
            ...line.match(PALETTE_VARIABLE) ?? [],
            ...line.match(HEX) ?? [],
            ...line.match(FUNCTION) ?? [],
        ];
        for (const colour of colours.filter(c => !isShade(c))) found.push({ line: index + 1, colour });
    });
    return found;
}

// ── Checking ──────────────────────────────────────────────────────────────────

const problems = [];
const counts = {};
const first = {};

for (const file of walk(src)) {
    const isScript = /\.(ts|tsx)$/.test(file);
    const isStylesheet = file.endsWith('.css');
    if (!isScript && !isStylesheet) continue;

    const text = readFileSync(file, 'utf8');
    const light = isScript ? LIGHT_VARIANT : LIGHT_SELECTOR;
    text.split(/\r?\n/).forEach((line, index) => {
        if (light.test(line)) problems.push(`${name(file)}:${index + 1}: styles the light theme, which was removed (ADR 0048)`);
    });

    if (name(file) === PALETTE || /\.test\.tsx?$/.test(file)) continue;
    const colours = isScript ? scriptColours(text) : stylesheetColours(text);
    if (colours.length > 0) {
        counts[name(file)] = colours.length;
        first[name(file)] = colours[0];
    }
}

const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : {};

if (update) {
    const raised = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? 0));
    if (existsSync(baselineFile) && raised.length > 0) {
        for (const [file, n] of raised) {
            console.error(`${file}: ${n} raw colours, more than the ${baseline[file] ?? 0} allowed. Use the tokens in ${PALETTE}.`);
        }
        process.exit(1);
    }
    const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(baselineFile, JSON.stringify(sorted, null, 4) + '\n');
    console.log(`${baselineFile}: ${Object.keys(sorted).length} files, ${Object.values(sorted).reduce((t, n) => t + n, 0)} raw colours.`);
    process.exit(0);
}

for (const [file, n] of Object.entries(counts)) {
    const allowed = baseline[file] ?? 0;
    const { line, colour } = first[file];
    if (n > allowed) {
        problems.push(allowed === 0
            ? `${file}:${line}: ${colour} is a raw colour. Use a token from ${PALETTE} (ADR 0049).`
            : `${file}: ${n} raw colours where ${allowed} are allowed. Use a token from ${PALETTE} (ADR 0049).`);
    } else if (n < allowed) {
        problems.push(`${file}: ${n} raw colours where the baseline says ${allowed}. Run \`node scripts/check-colours.mjs --update\`.`);
    }
}
for (const file of Object.keys(baseline).filter(file => !(file in counts))) {
    problems.push(`${file}: no raw colours left, but still in the baseline. Run \`node scripts/check-colours.mjs --update\`.`);
}

for (const problem of problems) console.error(problem);
if (problems.length > 0) {
    console.error(`\n${problems.length} colour problem${problems.length === 1 ? '' : 's'}.`);
    process.exit(1);
}
