# 0048. One theme, dark, and palettes are variations of it

**Status:** Implemented — the first step of #209; the palettes are #208

## Context

There were two themes: dark by default, and light for an account that switched it on at `/user`
(`ApplicationUser.Theme`). Each was written out in every component. A component set its dark
colours and then overrode them for light, with a `light:` Tailwind variant or a
`[data-theme='light']` rule. On 9 October 2026 that was 345 `light:` classes and 206 light rules,
about two in five of the client's colour declarations.

The light half was not one design applied consistently. The same dark grey had different light
partners from one component to the next: `text-slate-400` was paired with `light:text-slate-600`
37 times and with `light:text-slate-500` 19 times, and the stylesheets split the same way. Across
the classes there were 87 different dark-and-light pairs, and across the stylesheets 97. #209 moves
every colour onto a small set of role-named tokens. Each role would have had to settle on one light
value, a quiet redesign of light in every pull request of the migration. And the site's owner did
not think it looked good in light.

Light was also the one source of a style flash on load. The server renders dark, and the account's
theme was applied only once `/api/auth/me` had answered, so a light account saw the dark page
first on every load.

## Decision

- **One theme, dark.** Every `light:` class, every `[data-theme='light']` rule, the `light` variant
  and the switch on `/user` are removed. `PUT /api/user/theme`, which only the switch called, goes
  with them.
- **`npm run lint` refuses light styling** in either form (`scripts/check-colours.mjs`), so that it
  cannot come back one component at a time. Written today it would do nothing at all.
- **`ApplicationUser.Theme` stays,** in the profile the API returns and in the export, because the
  palettes of #208 store their choice there. Nothing sets it now. An account that chose light before
  this still says `light`, so whatever reads the column again must take a value it does not know as
  dark.
- **Palettes (#208) are variations of dark**: a background, a primary and a secondary colour on a
  dark page, never a light theme under another name. Text stays light on a dark background, so the
  check a custom palette needs is narrow. Is the background dark enough for the text, and does the
  primary stand out against it?

## Alternatives

- **Keep light and tokenise both themes.** Every role would carry two values, each chosen use by use
  from the 184 pairs above, for a theme nobody wanted to keep.
- **Light as one of the palettes later.** Once colours are tokens, a palette is just a set of values,
  so light could return that way. It would break the assumption the palettes rest on, that text is
  light on a dark page. Worth reopening only with a reason.

## Consequences

- #209 tokenises one theme: about 950 colour declarations, each role with one value.
- Nothing flashes on load for now. Everybody gets dark, and dark is what the server renders.
  Palettes bring the question back; #208 records the answer, an inline script in `<head>` that
  applies the stored palette before the first paint.
- Accounts that chose light now see dark. The site is not live yet, so nobody outside development
  is affected.
