# 0075. The editorial redesign: ink and paper, one accent, three typefaces, and rules for boxes

**Status:** Accepted — being built on `feat/editorial-redesign`.

## Context

Before launch the owner wanted the site to look less generic. On 2026-10-26 it drew every page in the
reader's system font, on Tailwind's slate greys with a stock blue, the standard dark-dashboard look; the
logo's navy and lime appeared nowhere but the logo. Every section was the same pattern, a heading, a grey
line under it and a row of rounded cards with thin slate borders, and the home page stacked four of them.
The signed-out hero was the usual template: a gradient wash, a checklist, two buttons and a mock-up card.
The covers did all the work; the frame around them had no character of its own.

Three directions were drawn on a design canvas against screenshots of the site as it was. The owner chose
the editorial one, a games magazine's front page, and then asked for its newspaper serif to be swapped
for something more modern. Two modern faces were set side by side on the same pages: Bricolage Grotesque,
which was turned down, and Archivo at its widest, which was kept. The owner was also worried that the
signed-in two-week line and the release calendar were heavy, fourteen tall columns and a month of tall
empty cells, and asked for both in the new language; the drawings were approved as they stood.

The client was ready for it. Every colour has been a token named for its job since #209
([0049](0049-every-colour-is-a-token.md)), so a new palette is new values in one file, and #208's palettes
will be the same again.

## Decision

### The palette: ink, paper and the logo's lime

- **The neutrals are warm, not slate:** a near-black ink for the page (`#121110`) and a paper white for
  the strongest text (`#f3efe6`), with the surfaces and the text tones between them on one hue, about
  85°, with almost no chroma, stepping only in lightness. A palette moves the hue and the chroma and keeps
  the steps.
- **The lines are the paper at an opacity**, 13% and 26%, rather than greys of their own, so a hairline
  reads the same on the page, on a surface and on a raised one.
- **The primary is the logo's lime**, Tailwind 4's lime scale one step lighter than its name at each role,
  because on a dark ground a link and a filled button both want the light end. `on-primary` is the page's
  ink: a filled button is lime with ink on it, 12:1.
- **Every text tone passes 4.5:1** on the page, a surface and a raised surface. `fg-faint`, the one that
  came closest, was lifted a step until it did.
- **The colours that carry meaning are unchanged**: scores, statuses, the event kinds, the favourite, the
  wishlist and the rest. Green still means a good score, and the stars are still the reader's own score
  and nothing else ([0021](0021-one-control-for-a-score.md)).

### The type: three families, three roles

- **Archivo**, for display: at 125% width and 800 weight for a page's title, a section's and the big
  figures, `type-display`; at normal width and bold for the name of a thing, a game in a list or a day in
  an agenda, `type-title`.
- **Schibsted Grotesk** for everything read: body text, controls, descriptions. It is `font-sans`, the
  default.
- **DM Mono** for metadata: the small capitals over a heading or beside a figure, `type-kicker`, and dates,
  platforms and counts on a line of their own, `type-meta`.
- **Self-hosted**, from the `@fontsource` packages, Latin and Latin Extended only, and no italic files:
  emphasis is the accent's colour. Nothing goes to a third party, nothing has to be admitted by the
  document policy, and the files are hashed and cached for a year with the build. The two that draw most
  of a page, Archivo's and Schibsted's Latin, are preloaded by the root; all of them are `swap`.

### The shape: rules, not boxes

- **Corners are a pixel or two.** Every Tailwind radius token is redefined small in `index.css`, and every
  radius a stylesheet wrote is now one of those tokens, so the shape is set in one place as the colour is.
  A circle stays a circle: an avatar, a toggle's thumb, the favourite's mark.
- **A section opens with a heavy rule**, two pixels of `fg-strong`, its title set large under it and the
  line about it across from the title. Rows inside a section are divided by hairlines. A box with a ground
  of its own is kept for what floats or is a control: a menu, a dialog, a panel.
- **A page's header is its title**, set large, with no band or tint behind it.

### The home page

- **The welcome** is the promise as a headline beside a numbered contents list of what the site keeps,
  in place of the drawing of a list.
- **Showcases and sales** is a strip between two rules under the welcome, not a section as large as the
  panels.
- **Coming soon** is a schedule: a column for each month, its games under it with their day as a figure,
  and what is known only to a quarter under the quarter.
- **Just out** is a grid of covers led by its newest game at twice the size, since it is already newest
  first.
- **The news** is a front page: the newest item as a lead, the rest as a column of briefs beside it.
- **Signed in**: the figures as one strip under a heavy rule; Continue playing as rows beside Play next.

### The two-week line: a ruler and a list

The line is fourteen equal days, a bar of each sale, fest and showcase across its days and a small cover
standing on each release's day (L1, L3). It is a picture, hidden from assistive technology; under it the
same things are a list in day order, each release with why it is there (L4) and its group (L5), and that
is where they are read and linked. A day with nothing on it is a column of the ruler and no line of the
list, so two quiet weeks cost one line of words rather than fourteen tall columns. The spec's §2.1 says
so.

## Alternatives

- **Google Fonts.** One `<link>`, and Archivo's widths by URL. But every reader's address goes to Google
  on every first visit, and a font host is one more thing the document policy would have to name once it
  says anything about fonts.
- **`font-display: optional`.** No layout shift at all, but a first visit that misses the short block
  period draws the whole session in the fallback, and on a phone that is most first visits.
- **Archivo's italic files** for emphasis, as the drawings had it: another 100 KB for one word in a
  headline. The accent's colour does the same job.
- **The newspaper serif (Newsreader) and Bricolage Grotesque**, both drawn and turned down by the owner.
- **Deriving the neutrals from a base colour with `color-mix()` now.** That is #208's custom palette, and
  it can be built when there is a second palette to test it against; until then explicit values on one hue
  are the same system written out, and every one of them is checked for contrast.
- **A visible hero image on the game page**, at full strength, as the drawings had it. The art IGDB lists
  first is a logo, an icon or a cover for about a quarter of games; until #395 chooses better, the hero
  keeps the art dimmed behind its title.

## Consequences

- `npm run visual`, which compares the pages before and after a change meant to look the same, has no
  baseline to compare the redesign against; its screenshots are in the pull request instead.
- The Lighthouse audit's baselines move where a page's audits do, and its page weight grows by the fonts:
  about 140 KB for the two preloaded files, and the rest as a page uses them.
- A component styles text by its role (`type-display`, `type-title`, `type-kicker`, `type-meta`) rather
  than by size and weight alone, and a new section opens with the heavy rule. `CLAUDE.md` and
  `.claude/rules/frontend.md` say so.
- #208's palettes set the same tokens again; they inherit the type and the shape unchanged.
