# 0085. The pixel matrix in the accent is the default look

**Status:** Implemented. It amends
[0082](0082-a-look-is-a-palette-a-pattern-and-a-tint-kept-on-the-account.md) by choosing the default that
record left open, and is part of #208.

## Context

0082 shipped six palettes and a custom one, four patterns and none, and two tints. It kept the default the
honeycomb in grey, "as #208 left it, until somebody chooses otherwise". Only an admin may choose a look (0082
§8), so that the default could be chosen by trying every look on the site itself.

That has now been done. The honeycomb's grey had a reason of its own, given in `PagePattern.css`: "a vivid
green glowing in hexagons over black is another brand's look". The pixel matrix, the dot-matrix panel of #399,
has no such likeness.

Tried in the accent, the pixel matrix's glow stood too bright behind text. The worst place was the foot of
every page, where the glow sits at the bottom left with the footer's name and its line.

## Decision

### 1. The pixel matrix in the palette's accent

`LookPolicy.DefaultPattern` is `pixels` and `DefaultTint` is `accent`. The palette stays ink, so somebody who
has chosen nothing sees the dot matrix in the logo's lime. That covers every visitor, every new account, and
every account that may not choose.

`DEFAULT_LOOK` on the client says the same, and `serverMirrors.test.ts` still holds the two together.

### 2. Every pattern's glow a fifth fainter at its brightest

Each layer of a pattern is drawn at a flat strength, with a glow at one corner drawn over it. The two add up
there. Each pattern's two glow strengths are lowered until the brightest point of each layer is a fifth
fainter, and the flat strengths stay as they were.

Where the flat strength is high, the glow's own number has to fall by more than a fifth for the sum to fall by
one. That is why the pixel matrix's lit cells, at 40% flat, go from 55% to 31%:

| Pattern | Lines: flat, glow | Lit cells: flat, glow |
|---|---|---|
| Pixel matrix | 9%, 42% → 32% | 40%, 55% → 31% |
| Honeycomb, and the perspective, which shares its strengths | 10%, 47% → 35% | 3.5%, 19% → 14.5% |
| Isometric | 8%, 40% → 30% | 5%, 24% → 18% |

### 3. The default first, everywhere a default is read

- **Both lists start with the default**, as the comments on them always said: `LookPolicy.Patterns` and
  `PATTERN_IDS` start with `pixels`, and `Tints` and `TINT_IDS` with `accent`. So the card shows the Pixel
  matrix first and Accent before Grey. The check constraints list the names in that order.
- **The head script reads a tint it does not know as the default**, as it already did a palette or a pattern.
  It used to read one as grey. The script's text changed, so its hash did too.
- **The stylesheet draws the default when `<html>` names nothing.** It names nothing for a visitor with no
  look stored. So the pixel matrix's rule also matches `:root:not([data-pattern])`, and the ink is the accent
  unless `grey` is named.
- **The variables on `.page-pattern` itself stay the honeycomb's**, because the perspective shares them.

### 4. Accounts still on the old default move to the new one

The columns' defaults follow the policy. The migration also moves every row still holding the honeycomb in
grey to the pixel matrix in the accent.

Only an admin could ever choose, so every other account holds the old default because the column gave it, not
because anybody chose it. Left alone, those accounts would be drawn in a default nobody picked on the day
everybody may choose, while new accounts got the new one.

The migration cannot tell an admin who chose the honeycomb in grey from the column's default, so such an admin
moves too. That is one person deciding the default, who can choose again. Its `Down` leaves the moved rows
where they are, because by then they cannot be told from a choice either, and the release before draws them as
they are.

## Consequences

- **Every page changes for somebody who has chosen nothing.** So `npm run visual` reports a difference
  everywhere, and the Lighthouse pages draw the dot matrix's two masks, about 3.8 KB, in place of the
  honeycomb's, about 0.7 KB.
- **A browser keeps its copy of the look until something replaces it**
  ([0082](0082-a-look-is-a-palette-a-pattern-and-a-tint-kept-on-the-account.md)). It goes on drawing the
  honeycomb in grey until its account answers with the new default. A browser that is signed out keeps it
  until somebody signs in there.
- **The favicon, the share image and the holding page are unchanged.** They are drawn in the brand's colours
  with no pattern, and 0082 redraws them once #208 settles.
- **Choosing a look stays for admins only.** The settings card still shows everybody else the choices as
  Coming soon, with Pixel matrix and Accent now the ones marked.
