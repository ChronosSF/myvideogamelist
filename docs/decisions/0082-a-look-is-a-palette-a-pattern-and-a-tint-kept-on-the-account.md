# 0082. A look is a palette, a pattern and a tint, kept on the account

**Status:** Implemented — part of #208.

## Context

#208 asked for palettes and background patterns a member chooses for the whole site, on the one theme,
dark ([0048](0048-one-theme-dark.md)), over the tokens of [0049](0049-every-colour-is-a-token.md). Its
"Already decided" settled where the choice lives (the account, in the `Theme` column the dark theme left),
how a page shows it without a flash (a script in `<head>`, admitted by its hash), and that the colours
which mean something stay fixed. The redesign's honeycomb ([0075](0075-the-editorial-redesign.md)) and
three explorations beside it, #397 (isometric tiles), #398 (a perspective grid) and #399 (a pixel matrix),
were the patterns to choose between. A mockup on the settings page settled the rest: five presets and a
custom palette of two colours, the four patterns and none, the pattern drawn in grey or in the accent, the
page itself as the preview, every change saved at once, and a way back to the default.

## Decision

### 1. Names on the account, never colours

`ApplicationUser.Theme` holds the palette by name — `ink`, the default, `slate`, `dusk`, `plum`,
`graphite` or `custom` — and `BackgroundPattern` and `PatternTint` the pattern (`honeycomb`, `isometric`,
`perspective`, `pixels`, `none`) and what it is drawn in (`grey`, `accent`). Only a custom palette stores
colours, its background and accent in `ThemeBackground` and `ThemeAccent`, as `#rrggbb` in lower case.
The lists are `LookPolicy`'s, and the database's check constraints are built from them: a name it does not
know, colours on a preset, a custom palette missing one, or a colour in capitals is refused by the table.

Names, because a stored set of forty values would keep everybody who chose a preset on it as it was the
day they chose it; a name reaches the preset as it is now. The migration rewrote the `dark` and the old
`light` every account held to `ink`. A reader still goes through `LookPolicy.PaletteOf`, and `LookDto.For`
reads any pattern or tint it does not know as the default, so a name a later release retires reads as the
default rather than as nothing. The export carries all five columns.

### 2. The profile carries the look, and one endpoint writes all of it

`UserProfileDto.Look` is the look, so every page knows it from `/api/auth/me`, the request it already
makes, and the sign-in and the registration answer with it. `PUT /api/user/look` replaces all five fields
at once and answers the profile. It checks the shape only — names it knows, a colour as six hex digits, a
custom palette with both — and keeps the colours only for a custom palette, so choosing a preset clears the
last custom one's. Nothing about a look reaches anybody else, so nothing is taken off the edge.

What the profile carries is the look the account is drawn in, which is not always the one it chose:
`LookDto.For` answers the default for an account that may not choose one (§8), and `CanChooseLook` says
which it is. The choice stays stored either way.

### 3. Before the first paint, from the browser's copy

`LOOK_SCRIPT` (`@/lib/look`) is rendered at the top of `<head>`, before the stylesheets, because a script
after a stylesheet waits for it. It reads the copy kept in `localStorage` under `mvgl-look` and sets
`data-palette`, `data-pattern` and `data-pattern-tint` on `<html>`, and for a custom palette its two
colours as `--look-page` and `--look-accent`. It knows the lists and reads anything else as the default,
and runs in a `try`, so no copy, a stale one or a hand-edited one can stop the page. `<html>` carries
`suppressHydrationWarning`, which covers that element's own attributes and nothing below it.

Its text never changes between renders, so `documentPolicy` admits it by its SHA-256, `LOOK_SCRIPT_HASH`,
rather than by the render's nonce: the nonce is handed to React Router's own scripts, and a browser blanks
a nonce attribute once read, which the hydrating client would then disagree with. `look.test.ts` fails
until the hash is the text's, and the document tests check every page has the script once, with no nonce,
under a policy naming its hash. The pages shared at the edge stay byte-identical, since the script is.

`LookProvider`, under `AuthProvider`, keeps the page and the copy in step once auth answers: the look the
account is drawn in, written to the copy. For nobody, and until auth answers, it does nothing, which leaves
the head script's drawing alone. So the copy outlives a sign-out, and a browser stays in its last reader's
look until somebody signs in; only deleting the account forgets it (`forgetLook`). A visitor who has never
signed in on a browser has no copy there and is drawn in the default; every page after a sign-in is right
from its first paint. On a shared computer the next visitor sees the last reader's look, which says
nothing about them but their taste, and the next account to sign in replaces it with its own.

The copy is a cache of the server's answer, never a grant: what an account may choose is decided by the
answer, and the copy follows it on the account's next page.

### 4. A palette is two colours, and the rest is worked out in CSS

Every palette, the presets included, is a page colour and an accent (`theme.css`). The surfaces, the
lines, the six text tokens and the primary's nine steps are worked out from those two with relative colour
syntax, by the default's own steps: the surfaces in lightness from the page, with a little more of its
chroma; the text and the lines at the default's lightnesses in the page's own hue, at a chroma of at most
0.02; the primary in lightness and chroma from the accent. The words on a filled button are dark on an
accent lighter than 0.6 and light on a darker one. So a preset is two decisions, and a custom palette is
drawn by exactly the rules the presets are.

The default keeps the tokens written in the `@theme` block rather than their working out, so nothing about
the site as it was moves, and a browser without relative colour syntax draws every palette as the default.
The colours that carry meaning, the score bands, the statuses, the kinds of event, the favourite, the
wishlist, the tags, and the brand's, are not touched by any palette.

The presets are the mockup's: **Ink and lime**, the default; **Slate and ice**, a cool grey and sky-300;
**Dusk and periwinkle**, a violet-grey and indigo-300; **Plum and orchid**, a red-violet grey and
fuchsia-300; and **Graphite and chalk**, a grey with no hue and the paper itself as the accent.

### 5. A custom palette is checked on the page, and saved only once it reads

The server cannot judge readability without a second copy of the formulas, so the settings page does,
measuring the palette as the browser draws it (`@/lib/lookChecks`): the computed colours of the tokens
are read back off a probe and compared. Five checks, the mockup's: body text and faint text on the
background at 4.5:1, the accent against the background at 3:1 (a part of the page, not text, WCAG 1.4.11),
the button's words on the accent at 4.5:1, and the accent's hue at least 14° from each colour with a
meaning — the wishlist's pink, the favourite's violet, ownership's teal, the tags' orange, the stars, an
error's red and Playing's blue — once it has enough colour to have a hue. The success green is not on that
list, because the default's lime sits beside it.

A custom palette that fails a check is still drawn, so its owner can see why, and is not saved; leaving the
page brings the account's look back. A request that skips the checks spoils only its sender's screen.

### 6. One pattern element, four drawings

`PagePattern` replaces `Honeycomb`: the same element at the top and the foot of every page, with the
honeycomb's layout (the top a screen tall, the bottom spanning the page and drawing at its foot, so a switch
moves no box), and `PagePattern.css` choosing the drawing by `data-pattern`. Each pattern sets the same
variables, its two masks, their sizes and how strongly each layer is drawn, and the explorations' drawings
and strengths came over unchanged. A browser fetches a mask only once something is drawn with it, so a
pattern nobody chose costs its lines of CSS. `none` hides both elements. The tint is `--page-pattern-ink`,
the palette's paper by default and `primary-500` for the accent.

### 7. The card

`LookCard` is the first card of the preferences on `/user`: the palettes as tiles, each a swatch of its two
colours; under Custom, two colour pickers and the checks; the patterns as tiles, each its own drawing; the
tint as two segments, disabled with no pattern; a status line; and Reset to default. Every choice is a
radio button, so arrow keys and names come with them. Each is drawn at once and saved at once — a colour
picker after it rests for half a second, since it reports every colour it passes — and saves go one at a
time, the latest after the one in flight, so the account ends on the last choice. A failed save puts the
account's look back and says why. For an account that may not choose (§8) the card says Coming soon, its
choices disabled, with no status and no reset.

### 8. Admins only, for now

Whether a look is free or paid is still open on #208, and the default is still to be chosen by trying the
looks on the site itself. So only an admin may choose one (`LookPolicy.CanChoose`), and `PUT
/api/user/look` sits behind the admin policy, which guards the admin's own preference here rather than
anybody else's data. Everybody else is answered with the default and shown the card as **Coming soon**, its
choices drawn and disabled: it promises the choices, and nothing about their price, so it stays true
whichever way #208 goes.

The rule is one function and one policy, and a paywall replaces both: the function asks for the
entitlement, and the endpoint's policy requires it. Because the profile carries the look the account is
drawn in, an account that stops being entitled is drawn in the default on its next page on every device,
and its copy with it, while its choice stays stored for the day it is entitled again. A browser it is
signed out on keeps the copy until somebody signs in there; nothing could stop that anyway, since every
palette's styles reach every visitor, and the copy is only a name in storage.

## Consequences

- A palette is two values in `theme.css` and a name in `LookPolicy`, `PALETTE_IDS` and the check
  constraint, whose migration carries it; a pattern is a rule in `PagePattern.css` and the same three.
  `serverMirrors.test.ts` fails while the client's lists differ from the server's, and the hash test while
  the script's text and its hash differ, which a new name changes.
- Only admins choose for now (§8). A visitor who has never signed in sees the default; one who has keeps
  the last look on that browser after signing out. Whether looks are free or paid is open on #208
  ([0010](0010-monetization-model.md) has no row for them yet), as is the logo's lime following the
  palette: the logo is `brand-lime`, the same in every palette for now, and the favicon, the share image
  and the holding page never see a palette at all.
- The look is per account, so two devices signed in to one account share it, and a change on one reaches
  the other on its next page.
- The default pattern stays the honeycomb, as #208 left it, until somebody chooses otherwise.
