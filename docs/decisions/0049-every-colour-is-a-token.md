# 0049. Every colour is a token, named for its job, in one file

**Status:** Implemented — the token layer and the shell; the rest of the client moves area by area under #209

## Context

The client wrote its colours by hand, about 1,560 times on 9 October 2026: hex and `rgba()` in the
stylesheets, Tailwind palette classes such as `text-slate-400` in the components. Nothing said what a
colour was for, so the same job was done by neighbouring shades from one component to the next, and the
light theme repeated every one of them (ADR 0048). Two things made it worse than it looked:

- **Two palettes under one set of names.** Tailwind 4 defines its colours in OKLCH, so `text-slate-400`
  is not the `#94a3b8` the stylesheets write: that is Tailwind 3's value. The greys were a shade apart,
  the blues visibly so. The site drew two blues for one button style, depending on whether the button
  was written in a stylesheet or with classes.
- **Nothing a palette could hold on to.** #208 lets members choose a palette. A palette is a set of
  values for named colours, and there were no named colours to give values to.

## Decision

- **One file, `src/theme.css`, holds every colour,** as a token in Tailwind's `@theme`. Each
  `--color-x` is a Tailwind colour, so it is a class (`bg-surface`, `text-fg-muted`) and a variable
  (`var(--color-surface)`) at once. The block is `static`, so every token is on `:root` whether or not a
  class uses it, which is where a stylesheet reads it and where a palette will set it.
- **The neutrals are named for their job:**
  - surfaces, deepest first: `sunken`, `page`, `surface`, `raised`;
  - lines: `line` for borders and dividers, `line-strong` for the edge of a control or a floating
    panel;
  - text, strongest first: `fg-strong`, `fg`, `fg-soft`, `fg-muted`, `fg-faint`, `fg-dim`.

  They are the bulk of the colours, and the part where neighbouring shades had drifted.
- **The primary is a scale:** `primary-200` to `primary-950`, with `on-primary` for text on a filled
  primary and `focus` for the keyboard's ring. A palette's main colour shows in many shades: a link, a
  filled button, a tint behind a header. Named roles for each would have been as many names with less
  in them. A palette sets the scale.
- **Colours that carry meaning are scales named for the meaning, and stay the same in every palette.**
  `danger-*` today. Success, warning, the score tiers, the statuses and the calendar's event kinds join
  as #209 reaches the code that uses them. Green always means a good score. The brand's colours, the
  logo's navy, lime and near-white, are tokens too, and fixed.
- **The values are Tailwind 4's.** Where the stylesheets and the classes disagreed, the token is the
  framework's current value, and the stylesheets moved to it. The brand colours are the logo's own.
- **A translucent colour is the token with an opacity,** not a new colour: `bg-page/95` as a class,
  `color-mix(in srgb, var(--color-page) 95%, transparent)` in a stylesheet.
- **Translucent black and white are not tokens.** They shade whatever is under them rather than
  colouring it: shadows, scrims, the sheen of a hovered button.
- **`npm run lint` refuses a colour written anywhere else** (`scripts/check-colours.mjs`). That covers
  a hex, an `rgb()`, a named colour, a palette class, and Tailwind's palette read as a variable
  (`var(--color-slate-400)`).
  - While #209 moves the client over, the rule is a ratchet. `scripts/colour-baseline.json` lists the
    files not yet moved, with how many raw colours each still has.
  - A file must match its count. A new file must have none.
  - `--update` rewrites the list and refuses to raise a count.
- **A change meant to look the same is checked by screenshots,** before and after (`npm run visual`).
  Each pixel must be within about five levels of grey, tight enough to catch a text colour swapped for
  a neighbour. Playwright's default would let it move by fifty.

## Alternatives

- **Scales for the neutrals as well** (`neutral-100` to `neutral-950`). Exact and mechanical, but it
  keeps the question that caused the drift, which shade to use, in every component, where a role
  answers it once.
- **Role names for the primary:** `accent`, `accent-soft`, `accent-fill` and so on. Tried on paper.
  Tints of the primary's 500 had no honest name, and the scale says less that is wrong.
- **Keep Tailwind's palette, and lint which shades may be used.** That still writes `slate-400` for
  muted text in a hundred places, and a palette cannot change what `slate` means.
- **Tailwind 3's hex values for the tokens,** which would have kept the stylesheets exact and moved the
  classes instead. About as many colours either way. The framework's own values will not drift from its
  docs.

## Consequences

- A palette is one set of values in one file. For #208's custom palette, the surfaces and lines can be
  worked out from its background with `color-mix()`, in a block for that palette.
- Styling anything new means choosing a token. A colour no token fits becomes a new token, named for
  its job. `CLAUDE.md` and `.claude/rules/frontend.md` say so, and the lint enforces it.
- Moving a file onto the tokens changes what it draws only where it used Tailwind 3's value, or a
  near-neighbour of a token's. Each pull request of #209 lists those merges with its screenshots.
