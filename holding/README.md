# holding

The page at `https://myvideogamelist.net` until production takes the domain (#98). Why it exists,
what it tells a crawler and when it goes are ADR 0066; the stack that serves it is
`infra/src/Infra/HoldingStack.cs`, and `infra/README.md` says how to deploy it.

- **`site/`** is what is served, exactly as it is: the page, its 404, the stylesheet, the favicon,
  the share image, `robots.txt` and `sitemap.xml`. Every link in it starts from the root, because the
  404 is served at whatever address was asked for.
- **`share/`** is the share image's source: `share.html`, drawn at 1200 by 630 into
  `site/share.png` by `node holding/share/render.mjs`. It needs the client's Playwright and a
  Chromium for it: `npm ci` in `myvideogamelist.client`, then, on a machine that has never run
  Playwright, `npx playwright install chromium` there too.

Three things are copies, because a static file cannot import anything:

- the colour tokens in `site/style.css`, from `myvideogamelist.client/src/theme.css`;
- the Discord invite, from `DISCORD_INVITE_URL` in `myvideogamelist.client/src/lib/links.ts`;
- `site/favicon.svg`, from `myvideogamelist.client/public/favicon.svg`.

Nothing here is linted or tested by CI. Look at a change in a browser before deploying it; the
distribution sends a content policy that refuses any script and anything from another origin.
