# 0100. The holding page points at the test run while it lasts, in the site's own look and type

**Status:** Accepted; deployed by hand once dev is open (`infra/README.md`, "Production, until #98"). Amends
[0066](0066-a-holding-page-until-production-takes-the-domain.md) §1, §5 and §6, and its list of what is not
on the page, and [0085](0085-the-pixel-matrix-in-the-accent-is-the-default-look.md)'s note that the holding
page keeps no pattern. The call to action comes off when the test run ends (§5).

## Context

- **Dev is about to open to real testers for about two weeks.** Stamen resumes the environment and takes its
  basic auth off himself, and testers are recruited by link, on the Discord and elsewhere. Their accounts and
  lists are real data from the first sign-up, promised to move to production at launch
  ([#465](https://github.com/ChronosSF/myvideogamelist/issues/465)).
- **The domain's own page knows nothing of it.** `myvideogamelist.net` is 0066's holding page. It says
  "Coming soon", and its one button is the Discord, so somebody who types the name they were told arrives at
  a page with no way into the application they were asked to try.
- **The page is in the look the site no longer has.** It went up on 2026-10-23, before the redesign of
  [0075](0075-the-editorial-redesign.md): slate and navy, the reader's system font, a gradient
  hero and boxed cards. The site is now ink and paper with the lime as its one accent, in Archivo, Schibsted
  Grotesk and DM Mono, with its sections opened by a heavy rule, over the pixel matrix of
  [0085](0085-the-pixel-matrix-in-the-accent-is-the-default-look.md). Its "What is coming" was mostly
  shipped.
- **The page's content policy admits no font.** 0066 §6 sends `default-src 'none'` with the stylesheet and
  the images allowed and nothing else, so the site's type cannot be used there without a change to the stack.

## Decision

### 1. The page leads with the test run, and says only what is true of it

The welcome is the home page's headline, and its lead with the playthroughs added; beside them, where the
home page has its contents list, is the drawing of the lists (§2). Under the lead are two ways in, a lime **Try the test run** to `https://dev.myvideogamelist.net/` and the Discord,
outlined beside it. A section, **The test run**, then says five things and no more:

- what it is: the real application, at that address, open for about two weeks while it is tested;
- **that the account and the lists a tester makes there move to the real site when it launches**, which is
  the one promise on the page, and Stamen's (#465);
- that it is a test and things may break, and that the Discord and the support address are where to say so;
- that one reason for it is to collect exports from other trackers to build the importer on
  ([#125](https://github.com/ChronosSF/myvideogamelist/issues/125)), that the importer reads Grouvee's today,
  and that an export goes to the support address or to the Discord. The address comes first, and the page
  says why: an export holds somebody's whole library, and a file posted to a public server is public;
- that signing up asks for an email address, confirmed by a link
  ([0089](0089-an-account-signs-in-once-its-address-is-confirmed.md)), with links to dev's privacy policy and
  terms.

**It names no date**, because the start is not fixed, and it promises nothing about what happens to the test
site afterwards. The wording is provisional and Stamen's to change; the pull request lists each sentence that
promises anything.

**The support address is on the page now**, which 0066 left off. That record had nothing to put there: the
mailbox has been read since 2026-11-09. A tester who will not join a Discord server needs another way to say
that something broke, and the same address is already the privacy policy's contact. It is in the test run's
section, so it comes off with it.

### 2. The product is drawn, never photographed

The page shows what the tracker keeps in its own markup and stylesheet: the lists' tabs, three games in
Playing with their hours, two of them with the reader's own score in half stars, and one game's two
playthroughs, each with its type's colour. The tabs are in the app's order, `LIST_IDS`'s. The games are made up
and their covers are tints of the page.

A screenshot would be quicker and would date the moment the app changed, but above all it would carry game
covers, and the holding page's bucket holds nothing of anybody else's (0066 §1). Drawn, the picture is in the
page's tokens and type by construction. Stars mean the reader's own score here as everywhere
([0021](0021-one-control-for-a-score.md)). To assistive technology it is one image with a label, and the
section under it says the same in words, a numbered list of what the site keeps.

### 3. The site's fonts are the page's own files, and the policy admits them

The fonts are copied into `holding/site/fonts`, beside each family's licence, and served from the
distribution like everything else on the page. Four files, Latin only, 85.5 KiB:

| File | What it draws | Bytes |
|---|---|---|
| `archivo-display-latin.woff2` | Archivo at 125% and 800: the headline, the section titles, the numbers | 13,028 |
| `archivo-title-latin.woff2` | Archivo at 100% and 700: the wordmark and the name of a thing | 12,928 |
| `schibsted-grotesk-latin-wght-normal.woff2` | Schibsted Grotesk, every weight: everything read | 46,752 |
| `dm-mono-latin-400-normal.woff2` | DM Mono 400: the kickers and the metadata | 14,820 |

- **Not a font host.** Google Fonts was turned down for the app by 0075 for sending every reader's address to
  Google, and this page has a stronger rule against it: nothing from another origin (0066 §1).
- **The same files as the app**, so the page is set exactly as the site is: Archivo's two faces as `npm run
  fonts` cuts them into `myvideogamelist.client/src/assets/fonts`, and the Latin files of the two
  `@fontsource` packages. The Latin Extended files the app also serves are left out, because the page's text
  is English and its `unicode-range` would never ask for them. No mono 500 and no italic: the page uses
  neither.
- **The licences go with them.** All three families are under the SIL Open Font License 1.1, whose second
  condition lets a font be redistributed with software provided each copy carries its copyright notice and
  the licence, which may be a stand-alone text file. None of the three names a Reserved Font Name. Read in
  the three `LICENSE` files themselves; each is copied beside its font.
- **`font-display: swap`, and all four preloaded**, because each draws part of the first screen: the
  wordmark, the kicker, the headline and the lead. A preload carries `crossorigin`. Without it, seen in
  Chromium on 2026-11-15, every font was fetched twice, and Chromium warned that the preload was not used
  because its credentials mode did not match the stylesheet's request.
- **`font-src 'self'` joins the content policy** in `HoldingStack.cs`, and nothing else does: no `data:`, no
  host. The pixel matrix's two drawings, which the page masks with, are copied too, into
  `holding/site/pattern`, and are images, which `img-src 'self'` already admitted.

Checked behind a local stand-in sending the stack's exact headers with that policy: nothing refused in the
console, every face loaded, the 404 resolving everything from the root at any depth. The fonts were served as
`binary/octet-stream` under `nosniff`, as the worst an upload that guessed no type could do, and Chromium
used them; which type the deployment gives a `.woff2` is the deploy's to show, and other browsers were not
tried.

### 4. The share image says it is open for testing

The image is redrawn from the page's stylesheet: the lockup and the headline, a lime flag reading "Open for
testing" over the domain, and the same drawing of the lists. It is set in the page's own fonts, so it renders
the same on any machine. It leaves out the pixel matrix: Chromium fetches a mask image in CORS mode, which a
page opened from disk cannot satisfy (seen: "blocked by CORS policy" for both drawings), and the glow then
draws unmasked over the whole top.

Its address carries a version, `/share.png?v=2`, so that nothing that kept the "Coming soon" image under the
old address can serve it for the new one. The distribution keeps no query string in its cache key and sends
none to the bucket (`HoldingStack.cs`, 0066 §4), so every version is the same file. The next image is `v=3`.

### 5. The call to action comes off when the test run ends

The trial ends before production launches, and the page then goes back to having no way in. **The button and
the section are one block each in `index.html`, opened and closed by `TEST RUN` comments, and so is the share
image's flag**, so that taking them off is deleting them. `holding/README.md` lists the rest: the Discord
becomes the filled button, the head's title and descriptions lose "open for testing", the share image is drawn
again under the next version, and this record's status and its row in the index say the call to action is
off.

It has to come off **no later than dev closes to the public**: when its basic auth goes back on, the button
leads to a 401, and when dev is parked, to nothing. Until then, removing it is the same hand deploy as any
change to the page.

## Alternatives

- **Sending the apex to dev with a redirect.** A 301 is kept by a browser for good, and the apex would then
  say nothing of its own to a crawler or to Search Console, which 0066 §5 built it for. A link is undone by
  the next deploy.
- **A screenshot of the app**, for the reasons in §2.
- **The system font, as before**, keeping the policy as it was. The page would not look like the site it
  sends people to, which is the point of redrawing it.
- **Inlining the fonts as `data:` URLs** in the stylesheet, to leave `font-src` out. The policy would have to
  admit `data:` instead, which admits any font anybody can write into a URL, and the stylesheet would grow by
  the fonts' weight, base64'd, uncached apart from it.
- **The Latin Extended files too.** Never fetched by an English page, so only weight in the bucket.

## Consequences

- **More copies.** The fonts and their licences, the corner tokens, the type roles and shapes, and the pattern's
  two drawings join the colour tokens, the Discord invite and the favicon on `holding/README.md`'s list. A
  change to any of them in the app does not reach the page by itself.
- **The policy change waits for the deploy.** Merging changes nothing at the apex: no workflow deploys
  `Mvgl-prod-Holding`, which is deployed by hand with the command in `infra/README.md`. Deployed without the
  stack change, the page would draw in the fallback fonts, with a refusal for each in the console.
- **The page weighs more**: 133 KiB on a first visit, before the edge compresses the page and the stylesheet,
  where it was 21. The fonts are 85.5 KiB of it, the page 20, the stylesheet 23, the drawings and the favicon
  the rest. Every file keeps 0066 §4's cache.
- **The page names a promise.** Its section repeats #465's promise to the public at the domain, so the
  promise is now made where the real site will be, not only on dev and the Discord.
- **The holding page now has a contact address**, until the test run's section comes off with it.
