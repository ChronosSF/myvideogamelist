/**
 * Draws default.html, beside this file, into src/assets/share.png: the image a page is shared with
 * when it has none of its own (#139), at the 1200 by 630 Open Graph and the large card are drawn at.
 *
 * The colours are the app's own. `src/theme.css` states them inside Tailwind's `@theme`, which a plain
 * page cannot read, so the `--color-*` declarations are lifted out of it and put on :root before the
 * page is drawn: the palette stays the one place a colour is written (ADR 0049), and a change to it
 * reaches the image at its next render. Only the `@theme` block's own declarations, read by a CSS
 * parser rather than a pattern: the palettes of #208 will set the same names again under selectors of
 * their own, and taking those too would draw the default image in whichever palette came last.
 *
 * Run it from the client, with Playwright's Chromium installed (`npx playwright install chromium`):
 *
 *     node share/render.mjs
 *
 * The text is set in the app's own fonts, which the page loads from the @fontsource packages in
 * node_modules, so a render on any machine has the same letterforms. Look at the result before committing
 * it. The file's name never changes: the build gives it a hashed address, so a new image is a new URL to
 * every crawler that cached the old one.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import postcss from 'postcss';

const theme = postcss.parse(readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8'));
const tokens = [];
theme.walkAtRules('theme', block => {
    for (const node of block.nodes ?? []) {
        if (node.type === 'decl' && node.prop.startsWith('--color-')) tokens.push(`${node.prop}: ${node.value};`);
    }
});
if (tokens.length === 0) throw new Error('No --color-* tokens found in the @theme block of src/theme.css.');

const template = new URL('./default.html', import.meta.url);
const output = fileURLToPath(new URL('../src/assets/share.png', import.meta.url));

const browser = await chromium.launch();
try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.goto(template.href);
    await page.addStyleTag({ content: `:root {\n${tokens.join('\n')}\n}` });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: output, type: 'png' });
    console.log(`Wrote ${output} from ${tokens.length} colour tokens`);
} finally {
    await browser.close();
}
