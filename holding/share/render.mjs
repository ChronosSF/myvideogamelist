/**
 * Draws share.html, beside this file, into ../site/share.png: the holding page's share image, at the
 * 1200 by 630 Open Graph and the large card are drawn at (ADR 0066).
 *
 * Playwright is the client's dev dependency, so install the client first and run this from anywhere:
 *
 *     npm ci --prefix myvideogamelist.client
 *     node holding/share/render.mjs
 *
 * The text is set in the machine's own interface font, as the page's is, so a render on another
 * system differs from the committed image in its letterforms. Look at the result before committing it.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const client = createRequire(new URL('../../myvideogamelist.client/package.json', import.meta.url));
const { chromium } = client('@playwright/test');

const template = new URL('./share.html', import.meta.url);
const output = fileURLToPath(new URL('../site/share.png', import.meta.url));

const browser = await chromium.launch();
try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.goto(template.href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: output, type: 'png' });
    console.log(`Wrote ${output}`);
} finally {
    await browser.close();
}
