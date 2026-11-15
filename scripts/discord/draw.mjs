#!/usr/bin/env node
/**
 * Draws what setup.mjs uploads, into assets/ beside it:
 *
 *   - emoji/*.png      the mark and the five lists, 128 by 128 on a clear ground;
 *   - welcome.jpg      the welcome card's picture, 2400 by 1800, from welcome.html. It is also the
 *                      picture the posts announcing the open test carry;
 *   - event-cover.jpg  the cover of the test's event, 1600 by 640, from event-cover.html.
 *
 *     node scripts/discord/draw.mjs            Everything.
 *     node scripts/discord/draw.mjs emoji      The emojis alone, which need no site.
 *     node scripts/discord/draw.mjs pictures   The two pictures alone.
 *
 * The colours are the app's own. `src/theme.css` states them inside Tailwind's `@theme`, which a plain
 * page cannot read, so the `--color-*` declarations are lifted out of it and put on :root before
 * anything is drawn, as the share image's are (share/render.mjs): the palette stays the one place a
 * colour is written (ADR 0049). The type is the app's, from the client's own font files.
 *
 * The two pictures are made of pages of the site, so they need what `npm run visual` needs: the dev
 * server up (DRAW_BASE_URL, or https://localhost:58546), the client's packages installed with
 * Playwright's Chromium, and the visual suite's account in myvideogamelist.client/visual/.env, a local
 * `@test.local` one with games in its lists, a score and a playthrough on God of War, and a public
 * profile or not. What they show is that account's library on the day they are drawn, and its handle,
 * on the phone. The screenshots go to the system's temp folder and are not kept. Look at the result
 * before committing it.
 *
 * A worktree has no visual/.env, which git ignores. Name the main checkout's from there, and its
 * values are read by Node and never shown: node --env-file=<main checkout>/myvideogamelist.client/visual/.env
 * scripts/discord/draw.mjs pictures
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const client = fileURLToPath(new URL('../../myvideogamelist.client/', import.meta.url));
const assets = join(here, 'assets');

// The client's own Playwright and PostCSS: this folder has no packages of its own.
const require = createRequire(join(client, 'package.json'));
const { chromium, request } = require('@playwright/test');
const postcss = require('postcss');

const parts = process.argv.slice(2);
const unknown = parts.filter(part => part !== 'emoji' && part !== 'pictures');
if (unknown.length > 0) {
    console.error(`Unknown: ${unknown.join(', ')}. Usage: node scripts/discord/draw.mjs [emoji] [pictures]`);
    process.exit(1);
}
const wants = part => parts.length === 0 || parts.includes(part);

// Only the `@theme` block's own declarations: the palettes set the same names again under selectors of
// their own, and taking those too would draw in whichever palette came last.
const declarations = [];
postcss.parse(readFileSync(join(client, 'src/theme.css'), 'utf8')).walkAtRules('theme', block => {
    for (const node of block.nodes ?? []) {
        if (node.type === 'decl' && node.prop.startsWith('--color-')) declarations.push(`${node.prop}: ${node.value};`);
    }
});
if (declarations.length === 0) throw new Error('No --color-* tokens found in the @theme block of src/theme.css.');
const tokens = `:root {\n${declarations.join('\n')}\n}`;

/** A list's emoji: the page's ink on the list's own colour, as the filled button sets ink on lime. */
const tile = (status, glyph) => `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
        <rect x="6" y="6" width="116" height="116" rx="20" fill="var(--color-status-${status})"/>
        <g fill="none" stroke="var(--color-page)" stroke-width="15" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
    </svg>`;

const EMOJIS = {
    // A stack of what is waiting, a play mark, a pause, a tick and a cross.
    backlog: tile('backlog', '<path d="M40 43h48M40 64h48M40 85h48"/>'),
    playing: tile('playing', '<path d="M50 40 90 64 50 88Z" fill="var(--color-page)" stroke-width="10"/>'),
    onhold: tile('on-hold', '<path d="M50 42v44M78 42v44"/>'),
    finished: tile('finished', '<path d="M38 66 56 84 92 44"/>'),
    dropped: tile('dropped', '<path d="M44 44 84 84M84 44 44 84"/>'),
    // The mark itself, as Logo.tsx draws it, with a little room for the badge's corner.
    mvgl: `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="-2 -2 68 68">
        <mask id="gap">
            <rect x="-2" y="-2" width="68" height="68" fill="white"/>
            <rect x="37" y="-3" width="30" height="30" rx="11" fill="black"/>
        </mask>
        <g mask="url(#gap)">
            <rect y="8" width="56" height="56" rx="15" fill="var(--color-brand-navy)"/>
            <path d="M21 26 40 36 21 46Z" fill="var(--color-brand-light)" stroke="var(--color-brand-light)" stroke-width="6" stroke-linejoin="round"/>
        </g>
        <rect x="40" width="24" height="24" rx="8" fill="var(--color-brand-lime)"/>
        <path d="M45.5 12 49.5 16 58 7" fill="none" stroke="var(--color-brand-navy)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
};

/** The pages the pictures are made of, signed in as the visual suite's account. */
async function capture(browser, folder) {
    const baseURL = process.env.DRAW_BASE_URL ?? 'https://localhost:58546';
    try {
        process.loadEnvFile(join(client, 'visual/.env'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const { VISUAL_EMAIL: email, VISUAL_PASSWORD: password } = process.env;
    if (!email || !password) {
        throw new Error('Set VISUAL_EMAIL and VISUAL_PASSWORD to a local @test.local account, in the shell or in myvideogamelist.client/visual/.env, as `npm run visual` asks.');
    }

    const api = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
    let storageState;
    try {
        // Every write carries the header, or the API refuses it (ADR 0033).
        const response = await api.post('/api/auth/login', { headers: { 'X-MVGL-Request': '1' }, data: { email, password, rememberMe: false } });
        if (!response.ok()) throw new Error(`Signing in at ${baseURL} answered ${response.status()}.`);
        storageState = await api.storageState();
    } finally {
        await api.dispose();
    }

    const settle = async page => {
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(700);
    };
    const open = async (viewport, deviceScaleFactor, phone = false) => {
        const context = await browser.newContext({
            baseURL, ignoreHTTPSErrors: true, storageState, viewport, deviceScaleFactor,
            reducedMotion: 'reduce', colorScheme: 'dark', ...(phone && { isMobile: true, hasTouch: true }),
        });
        const page = await context.newPage();
        // The home page's Play next picks a game at random. The same "random" every time picks the same game.
        await page.addInitScript(() => { Math.random = () => 0.42; });
        return page;
    };
    const shots = {};
    const shot = name => (shots[name] = join(folder, `${name}.png`));

    // Narrower than a desktop, so that a page's type reads larger once the picture is scaled down.
    const desktop = await open({ width: 1200, height: 750 }, 2);
    // God of War: a cover and a backdrop that carry a small picture, and the series under them.
    await desktop.goto('/games/19560');
    await settle(desktop);
    await desktop.screenshot({ path: shot('game') });

    await desktop.goto('/lists');
    await settle(desktop);
    await desktop.getByRole('tab', { name: /Finished/ }).click();
    await settle(desktop);
    await desktop.screenshot({ path: shot('lists') });

    // The profile from its figures down: a screen's worth of the page, starting a little above the heading.
    await desktop.goto('/user');
    await settle(desktop);
    const heading = await desktop.getByRole('heading', { name: 'Your tracking', exact: true }).first().boundingBox();
    const scrolled = await desktop.evaluate(() => window.scrollY);
    await desktop.screenshot({ path: shot('stats'), fullPage: true, clip: { x: 0, y: heading.y + scrolled - 48, width: 1200, height: 750 } });
    await desktop.context().close();

    const phone = await open({ width: 390, height: 800 }, 3, true);
    await phone.goto('/');
    await settle(phone);
    await phone.screenshot({ path: shot('phone') });
    await phone.context().close();
    return shots;
}

/** One of the two pages, with the tokens on :root and each `<img data-shot>` given its screenshot. */
async function compose(browser, source, output, viewport, shots) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(join(here, source)).href);
    await page.addStyleTag({ content: tokens });
    await page.evaluate(files => {
        for (const image of document.querySelectorAll('img[data-shot]')) image.src = files[image.dataset.shot];
    }, Object.fromEntries(Object.entries(shots).map(([name, file]) => [name, pathToFileURL(file).href])));
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const file = join(assets, output);
    // A JPEG: a page of covers and screenshots is a photograph, and as a PNG it is three times the size.
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    await page.close();
    console.log(`Wrote assets/${output}, ${Math.round(statSync(file).size / 1024)} KB`);
}

mkdirSync(join(assets, 'emoji'), { recursive: true });
// A mask image is fetched with CORS, which a page opened from a file fails without this.
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
try {
    if (wants('emoji')) {
        const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
        for (const [name, svg] of Object.entries(EMOJIS)) {
            await page.setContent(`<style>${tokens} body { margin: 0; background: transparent; }</style>${svg}`);
            const file = join(assets, 'emoji', `${name}.png`);
            await page.screenshot({ path: file, omitBackground: true });
            console.log(`Wrote assets/emoji/${name}.png, ${statSync(file).size} bytes`);
        }
        await page.close();
    }
    if (wants('pictures')) {
        const folder = mkdtempSync(join(tmpdir(), 'mvgl-discord-'));
        try {
            const shots = await capture(browser, folder);
            await compose(browser, 'welcome.html', 'welcome.jpg', { width: 1200, height: 900 }, shots);
            await compose(browser, 'event-cover.html', 'event-cover.jpg', { width: 800, height: 320 }, shots);
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
    }
} finally {
    await browser.close();
}
