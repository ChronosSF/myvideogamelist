/**
 * Cuts Archivo's two faces out of its variable font, `npm run fonts`, into `src/assets/fonts/` (ADR 0075).
 *
 * The site sets Archivo two ways and no other: expanded and extra-bold for display (`type-display`, 125%
 * and 800) and normal and bold for a thing's name (`type-title`, 100% and 700). The package's variable file
 * carries every width from 62% to 125% and every weight from 100 to 900, 88 KiB for its Latin alone, and on
 * a phone's connection those bytes are paid before the first paint. Each face pinned to its one width and
 * weight is about 12 KiB, so the two together are a quarter of the one.
 *
 * Each face is cut for the same two character sets the package splits Archivo into, Latin and Latin
 * Extended, read from its own stylesheet so that `type.css`'s `unicode-range`s and these files describe the
 * same characters. A third way of setting it — another weight, or another width — is another face here and
 * another rule in `type.css`, with its kilobytes on every page that uses it.
 *
 * The files are committed, so a build needs nothing from here; run it after changing a face or upgrading the
 * package, and commit what it writes. Archivo is under the SIL Open Font License, which names no reserved
 * font name and asks that the licence go with any copy, so it is written beside them.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve('@fontsource-variable/archivo/package.json'));
const out = join(root, 'src', 'assets', 'fonts');

/** The faces the site sets, by the name of the role that sets each. */
const FACES = {
    display: { wdth: 125, wght: 800 },
    title: { wdth: 100, wght: 700 },
};

/** The package's character sets, and the variable file each is in. */
const SUBSETS = ['latin', 'latin-ext'];

/** Every code point a `unicode-range` names, as one string. */
function charactersIn(range) {
    let text = '';
    for (const part of range.split(',')) {
        const [from, to = from] = part.trim().replace(/^U\+/i, '').split('-');
        for (let point = parseInt(from, 16); point <= parseInt(to, 16); point++) {
            text += String.fromCodePoint(point);
        }
    }
    return text;
}

/** A subset's `unicode-range`, from the package's stylesheet for the width axis. */
function rangeOf(subset) {
    const css = readFileSync(join(pkg, 'wdth.css'), 'utf8');
    const rule = css.split('@font-face').find(block => block.includes(`archivo-${subset}-wdth-normal.woff2`));
    const range = rule?.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (!range) throw new Error(`No unicode-range for Archivo's ${subset} subset in ${pkg}/wdth.css.`);
    return range;
}

mkdirSync(out, { recursive: true });

for (const subset of SUBSETS) {
    const variable = readFileSync(join(pkg, 'files', `archivo-${subset}-wdth-normal.woff2`));
    const text = charactersIn(rangeOf(subset));

    for (const [role, axes] of Object.entries(FACES)) {
        const face = await subsetFont(variable, text, { targetFormat: 'woff2', variationAxes: axes });
        const name = `archivo-${role}-${subset}.woff2`;
        writeFileSync(join(out, name), face);
        console.log(`${name}: ${(face.length / 1024).toFixed(1)} KiB, from ${(variable.length / 1024).toFixed(1)} KiB`);
    }
}

copyFileSync(join(pkg, 'LICENSE'), join(out, 'Archivo-OFL.txt'));
