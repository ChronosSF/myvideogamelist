# holding

The page at `https://myvideogamelist.net` until production takes the domain (#98). Why it exists,
what it tells a crawler and when it goes are ADR 0066; why it points at dev's test run, in the site's
own look and fonts, is ADR 0100. The stack that serves it is `infra/src/Infra/HoldingStack.cs`, and
`infra/README.md` says how to deploy it.

- **`site/`** is what is served, exactly as it is: the page, its 404, the stylesheet, the favicon,
  the share image, `robots.txt`, `sitemap.xml`, the fonts in `fonts/` with their licences, and the
  two drawings of the pixel matrix in `pattern/`. Every link in the HTML starts from the root,
  because the 404 is served at whatever address was asked for; every URL in the stylesheet is
  relative, so it resolves against `/style.css` wherever the page is.
- **`share/`** is the share image's source: `share.html`, drawn at 1200 by 630 into
  `site/share.png` by `node holding/share/render.mjs`, in the page's own stylesheet and fonts. It
  needs the client's Playwright and a Chromium for it: `npm ci` in `myvideogamelist.client`, then,
  on a machine that has never run Playwright, `npx playwright install chromium` there too.

## What is copied

A static file cannot import anything, so these are copies, each under the app's own name so the two
can be compared side by side. A change to the original does not reach the page by itself.

- the colour tokens in `site/style.css`, from `myvideogamelist.client/src/theme.css`, the default
  palette's, and the corner tokens, from `myvideogamelist.client/src/index.css`;
- the type roles (`type-display`, `type-title`, `type-kicker`, `type-meta`) and the shapes
  (`rule-heavy`, `text-link`, `btn-primary`, `btn-outline`), as classes, from
  `myvideogamelist.client/src/type.css` and `index.css`;
- the four `@font-face` rules, from `type.css`, and their files in `site/fonts/`: Archivo's two
  faces from `myvideogamelist.client/src/assets/fonts/` (`npm run fonts` cuts them), Schibsted
  Grotesk's and DM Mono's Latin files from the client's `@fontsource` packages. Each family's
  licence, the SIL Open Font License, is beside its files and goes with them;
- the pixel matrix, from `myvideogamelist.client/src/components/PagePattern.css`, and its two
  drawings in `site/pattern/`, from `myvideogamelist.client/src/assets/`;
- the logo, from `myvideogamelist.client/src/components/Logo.tsx`: its mask, tile, triangle, badge
  and tick, drawn inline in `site/index.html` (twice), `site/404.html` and `share/share.html`, with
  its colours as classes in `site/style.css`;
- the Discord invite, from `DISCORD_INVITE_URL` in `myvideogamelist.client/src/lib/links.ts`, and
  the support address, from `SUPPORT_EMAIL` beside it;
- `site/favicon.svg`, from `myvideogamelist.client/public/favicon.svg`.

## Looking at a change

Nothing here is linted or tested by CI. Look at a change in a browser before deploying it, and serve
`site/` with the headers the distribution sends (`HoldingStack.cs`) rather than opening the file from
disk: the content policy refuses any script and anything from another origin, and a font it did not
admit looks fine from disk. A page opened from disk also cannot draw the pixel matrix, whose drawings
Chromium fetches in CORS mode.

A new share image takes a new address: `og:image` in `site/index.html` names it with a version,
`share.png?v=2`, and the next one is `v=3`. The distribution serves the same file whatever the query.

## When the test run ends

The way into dev's test run comes off when the test does, and no later than dev closes to the public
again: once basic auth is back the button leads to a 401, and once dev is parked, to nothing (ADR
0100 §5). Each piece is opened by a `TEST RUN … from here` comment and closed by a `TEST RUN … to
here` one, so `TEST RUN` finds both ends.

1. In `site/index.html`, delete the two blocks: the way in, in the welcome, and the section "The
   test run", which takes the support address with it.
2. In the same file, give the Discord link `btn-primary` in place of `btn-outline`: it is the one
   way in again. The comment that closes the way in, which says so, goes with it.
3. In its head, take ", open for testing" out of the title and `og:title`, the last sentence out of
   the two descriptions, "Open for testing." out of `og:image:alt`, and the paragraph about the two
   blocks out of the head's comment.
4. In `share/share.html`, delete the flag and its two rules (`.flag`, `.flag::before`) and the
   comment's paragraph about it, run `node holding/share/render.mjs`, and look at `site/share.png`
   before committing it. Give `og:image` the next version.
5. In `site/style.css`, the `.trial-*` rules can go, and the sentence about the test run's block in
   the comment over `.ways-in`.
6. Say in ADR 0100's status, and in its row of `docs/decisions/README.md`, that the call to action is
   off.
7. Deploy as any change to the page is deployed.

The 404 says nothing about the test run and does not change.
