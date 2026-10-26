---
paths:
  - "myvideogamelist.client/src/**"
  - "myvideogamelist.client/*.ts"
  - "myvideogamelist.client/*.tsx"
---

# Frontend conventions

## Language & tooling

- `.tsx` for components, `.ts` for logic. Never `.js` or `.jsx`.
- Strict TypeScript. Avoid `any`; prefer `unknown` and narrow.
- Import via the `@/` alias, not `../../` chains.

## SSR safety

This is the category of bug that is easy to introduce and annoying to diagnose.

- `window`, `document` and `localStorage` **do not exist on the server**. Never touch them
  during render or inside a `useState` initializer.
- For browser-only state, use `useSyncExternalStore` with a fixed server snapshot, as
  `@/lib/useHydrated` does. Reading in an effect also works but commits a throwaway render
  first, and `getSnapshot` must return a stable reference or React loops.
- Server-side loaders have no origin to resolve a relative URL against. A loader calls the API with
  `loaderFetch(context, path)` from `@/lib/trace.server`, which resolves the path as `apiUrl()` does
  and sends the render's trace as `traceparent`. The lint refuses an import of `apiUrl` anywhere else.
- **Never format in the runtime's default locale during render.** A bare `toLocaleString()`, or an
  `Intl` formatter given no locale, formats in Node's locale on the server and the reader's in the
  browser. Where those disagree so does the text — `5487` against `5,487` — and hydration fails.
  Counts go through `formatCount` from `@/lib/format`. A locale alone does not make an instant
  safe: without a `timeZone` each side formats a timestamp in its own zone. A release date is a day,
  not an instant: parse it with `parseReleaseDate` from `@/lib/releaseDate` and format it with no
  `timeZone`, and every runtime reads the day it names. `new Date('YYYY-MM-DD')` is UTC midnight,
  the day before west of Greenwich, and `timeZone: 'UTC'` on a parsed day is the same slip east of
  it. Anything that has to follow the reader's locale, timezone or clock waits for `useHydrated`.

## Route modules

Files in `src/pages/` registered in `src/routes.ts`. A route module exports a default
component plus optional `loader`, `meta`, `links`, `headers` and `ErrorBoundary`.

- Prefer a `loader` over `useEffect` fetching for anything that should be server-rendered
  or indexed. Authenticated, user-specific views can stay client-side.
- Throw a `Response` from a loader for not-found and upstream failures. The root
  `ErrorBoundary` renders it and the correct HTTP status reaches crawlers — a soft 404 that
  returns 200 is worse than useless for SEO. An upstream failure is `upstreamFailure(context,
  message)`, which carries the trace id the error page asks a reader to quote
  (`docs/decisions/0059-*`).
- Give every indexable route a `meta` export that returns `pageMeta(...)` from `@/lib/seo` — it is
  the whole set (title, description, canonical URL, Open Graph, the card), and a leaf's `meta`
  replaces the root's rather than merging with it, so a hand-written list states half of them. Build
  its `path` from loader data, never from the request, and return `site: siteConfig()` from the
  loader: `meta` also runs in the browser, where the environment does not exist. A per-user route
  adds `NOINDEX` instead, and a `noindex` page gets no canonical URL. See `docs/decisions/0036-*`.
- A resource route (`src/resources/`) returns its own `Response` and never reaches
  `entry.server.tsx`. Send it through `resourceResponse`, which adds the headers that file would
  have, with a content policy that loads nothing in place of a document's nonce, and state its
  `Cache-Control` like any other route.
- **Never render an inline `<script>` of our own without deciding how it is admitted.** A document's
  `script-src` names only its render's nonce and `'self'` (`docs/decisions/0053-*`). A script whose
  text never changes goes in by its hash in `documentPolicy`.
- Route types come from `react-router typegen`; import them as `./+types/<RouteName>`.

## Talking to the API

- **Every write goes through `apiFetch`** from `@/lib/api`. It adds the session cookie and the
  `X-MVGL-Request` header the API requires on anything that changes state; a write sent with bare
  `fetch` is refused with a 403 in development as well as deployed. Reads may use either — several
  deliberately send `credentials: 'omit'`, which `apiFetch` will not override.
- Read the error body before showing a message. The API answers `ProblemDetails` (`title`,
  `detail`, and `errors` keyed by field), and the sentence worth showing is usually inside it — a
  rate-limited login read as "Login failed" is the case that made this a rule.

## Optimistic updates

The providers apply a change locally, fire the request, and undo the change if it fails. Two rules
that are easy to get wrong and were got wrong once (`docs/decisions/0022-*`):

- **Roll back surgically, never by restoring a snapshot.** Mutations for different games overlap by
  design — the pending set is per game id — so putting back the list as it was before *this*
  request also undoes whichever other request succeeded meanwhile. The visible symptom is a removed
  game reappearing. Dispatch an action that touches only the affected item, computed from current
  state. Restore membership and the values, **not a position** — an index captured before the
  request is stale once another item leaves from in front of it, and the lists are rendered through
  `sortEntries` anyway. The wishlist keeps its order from `addedAt`: derive order from a value, or
  do not preserve it. A hand order's position (`docs/decisions/0054-*`) is such a value — a sparse
  number, not an index — so its undo puts back the number each game had, which the lock keeps true.
- **Take the per-game lock for every mutation that writes the entry**, scoring included. Two
  requests in flight for one game means the first to fail rolls back over what the second saved.
  The lock is also what makes the captured position safe to trust while the request is out.
- **Handle a rejected `fetch`, not only `!res.ok`.** An unreachable API makes `fetch` reject, so a
  `try`/`finally` with no `catch` leaves the optimistic change on screen as though it had been
  saved — and, because these are fired with `void`, the rejection escapes unhandled.
- **Keep the load error and the mutation error in separate fields.** A failed fetch means there is
  nothing trustworthy to show. A failed mutation has already been rolled back, so the data beside
  it is fine — sharing one field makes a failed toggle render as "failed to load" and hide a
  perfectly good list. Clear the mutation error on the next success: neither banner is dismissible,
  so nothing else ever takes it down.
- **A rollback belongs to the session that started it.** A mutation can still be in flight when one
  account signs out and another signs in, and the rollback closes over data captured from the
  first — so an unguarded one writes one user's games into another user's lists. Only local state
  is at risk; the request itself already carries whichever cookie was current when it was sent.

  Two things together, and neither is sufficient alone:

  1. **Hold the account in reducer state, not a ref**, stamp it on every action a mutation raises,
     and drop mismatched ones in the reducer. A ref has to be written somewhere and both places
     are wrong: from an effect it lags the commit, leaving a window where the new account is on
     screen while the marker still names the old one; during render it can be moved by a render
     React then throws away. State compared inside the reducer cannot drift from the data it
     guards.
  2. **Clear the state when the account changes**, on `FETCH_START`, not when the fetch succeeds.
     Otherwise a fetch that *fails* leaves the previous account's data on screen under the new
     account's error — which needs no mutation in flight at all to happen.

  **The pending set is part of that state**, so keep it in the reducer as well and stamp the
  actions that add to and remove from it. Left in its own `useState` it survives the account
  change, and a game the previous account had in flight stays locked for the new one — for good,
  if that request hangs. Both providers had this, found in neither review of the other: a guard
  added to one has to be applied to the other by hand, because review only reads the diff.

## State & effects

- **Do not call `setState` synchronously inside an effect.** Adjust state during render
  (React's documented pattern for resetting on a prop change), or use `useSyncExternalStore`
  for external state. ESLint enforces this via `react-hooks/set-state-in-effect`.
- **Every effect has to survive running twice.** React Router's client entry wraps the app in
  `<StrictMode>`, and since React 19.3 that runs a hydrated tree's effects, their cleanups and the
  effects again in development: the root providers on every page load, not only what a navigation
  mounts. A read aborts in its cleanup and drops whatever its aborted request settles with, as the
  providers do. Without the abort both answers land — `AuthProvider`'s second one had the lists, the
  wishlist and the favourites read twice on every page load, which is what made this a rule.
- Always handle loading and error states explicitly. Never leave a silent broken UI.
- One component per file; filename matches the export.

## Empty, failed and loading states, and covers

Nothing new shows as a blank or a bare spinner (`docs/decisions/0070-*`):

- **Something empty is an `EmptyState`** saying what is missing and what would put something there. On
  a page other people read, such as a public profile, it says what will fill it and never asks the
  reader to do anything.
- **A failure is an `ErrorState`** with "Try again" wherever retrying could help. A retry that removes
  the button moves focus somewhere that stays, as the member section moves it to its heading.
- **Something loading is a `LoadingState` around a skeleton** drawn in the content's own boxes: the
  card's classes from `@/lib/gameGrid`, text lines as `SkeletonLine`, which is one line of the type
  around it. It is not `aria-busy`, which belongs on a container updated in place.
- **A cover is a `CoverImage`** with the `sizes` its box is drawn at, worked out from that component's
  CSS. It is lazy unless it is in the first screen, and never lazy as a page's largest first paint.

The wishlist and news pages' empty and failed states predate these and keep their own markup.

## Showing a score

One control, one display, and they mean different things (`docs/decisions/0021-*`):

- **`ScoreInput`** — five stars at half-star steps — is the *only* way a user enters a score, and
  stars are used for nothing else. It is a radio group under a `<fieldset>`, so arrow keys,
  per-value accessible names and a propagating `disabled` come for free; keep it that way rather
  than reaching for a div with click handlers.
- **`ScoreBadge`** shows a score somebody else produced, always out of 100. Put IGDB's 0–10 player
  rating through `ratingPercent` first. Its three variants are `square` (over cover art, the only
  solid fill), `pill` (a metadata row) and `plain` (a table cell).
- **Colour bands come from `@/lib/score`.** Never inline a threshold — a score that is green on a
  card and amber in a table is worse than either colour alone.

## Styling

Tailwind utilities inline, plus a scoped `ComponentName.css` per component where needed.
Global styles in `src/index.css`, app shell in `src/App.css` — both imported from
`src/root.tsx`, since there is no `index.html` in framework mode.

**Every colour is a token from `src/theme.css`** (`docs/decisions/0049-*`). `npm run lint` fails on
any other, so build new styling on these from the start:

- **Surfaces:** `bg-page` for the page, `bg-surface` for what floats or needs a ground of its own — a
  menu, a dialog, a panel — `bg-raised` for what sits on a surface or is hovered, and `bg-sunken` for
  scrims. Not for a section of a page, which opens with a rule instead (below).
- **Lines:** `border-line` for borders and dividers, `border-line-strong` for the edge of an input or
  a floating panel.
- **Text, strongest first:** `text-fg-strong` for headings, `text-fg` for body text, then
  `text-fg-soft`, `text-fg-muted`, `text-fg-faint` and `text-fg-dim`.
- **The primary is a scale,** the logo's lime. `text-primary-400` for the active tab or a mark of
  what is the reader's own, `bg-primary-500` for a filled button with `text-on-primary` (the page's
  ink) and `bg-primary-600` for its other state, and `ring-focus` or `outline-focus` for keyboard
  focus. A link in running text is `text-fg-strong`, underlined in `decoration-line-strong`. One filled
  button to a place, for what the place is for; every other button is outlined, `border-line-strong`
  with `text-fg-strong`, and a red one is outlined in red.
- **Colours that carry meaning are scales named for the meaning,** such as `danger-300` for an
  error's words, and stay the same in every palette. Score colours still come from `@/lib/score`.
- **The brand's colours** (`brand-navy`, `brand-lime`, `brand-light`) are the logo's.

In a stylesheet the same tokens are `var(--color-surface)`. For a translucent colour, use the token
with an opacity: `bg-surface/60`, or `color-mix(in srgb, var(--color-surface) 60%, transparent)`.
When nothing fits, add a token, named for its job rather than its look. Don't write a hex, an
`rgb()`, a palette class like `text-slate-400`, or `var(--color-slate-400)` in its place.
Translucent black and white, for shadows and scrims, are the one exception.

There is one theme, dark: no `light:` variant and no `[data-theme='light']` rules (ADR 0048).

**Text is set by its role** (`docs/decisions/0075-*`), with the utilities in `src/type.css`, and the
size beside it:

- `type-display`: Archivo, wide and heavy — a page's title, a section's, a big figure.
- `type-title`: Archivo, normal width and bold — the name of a thing, a game in a list.
- `type-kicker`: DM Mono small capitals — the label over a heading or beside a figure.
- `type-meta`: DM Mono — a date, a list of platforms, a count on a line of its own.
- Everything else is the default, Schibsted Grotesk. Don't set `font-family` any other way.

**Corners are tokens:** `rounded-sm` to `rounded-4xl` are a pixel or two (`src/index.css`), and a
stylesheet writes `var(--radius-lg)`, never a size. `rounded-full` is for what is round: an avatar, a
toggle's thumb.

**A section opens with a rule, not a box:** `border-t-2 border-fg-strong` over its title, hairlines
(`border-line`) between the rows inside it. `PageHeader` and `HomeSectionHeading` are the two shapes;
use them rather than a copy of their classes.

## Images

- **An image loads only from a host the document policy names**: `IMAGE_SOURCES` in
  `@/lib/securityHeaders`, which is this origin, IGDB's CDN and the avatar hosts. Showing one from
  anywhere else means adding its host there, on purpose; it fails in development exactly as deployed.
- **A member's picture goes through `Avatar`**, never a bare `<img>`. It loads anonymously and with
  no referrer, and falls back to the handle's initial on any failure, one before hydration included
  (`docs/decisions/0056-*`).

## Tests

Vitest with jsdom and Testing Library, in `*.test.ts(x)` files beside the code they cover.
`npm run test` runs once; `npm run test:watch` iterates. `vitest.config.ts` is deliberately
separate from `vite.config.ts`, which exports the HTTPS dev certificate whenever Vite's command is
`serve` — and `serve` is the command Vitest runs under, so a shared config would make every test
run depend on the .NET SDK. A build resolves the same file as `build` and is spared it.

- **Query by role and accessible name**, not by class or test id. A test that finds a button by
  its label breaks when the label stops making sense, which is the point.
- **Build DTOs with the factories in `src/test/factories.ts`.** `GameDto` has eighteen fields;
  spelling it out inline turns a test about sort order into a test about DTO shape.
- **A hook mock must return a stable object.** `vi.mock('@/hooks/useAuth', () => ({ useAuth: () =>
  ({ ... }) }))` hands back a fresh object per render, and any effect depending on it re-runs
  forever — the symptom is a heap-exhaustion crash, not a failed assertion. Hoist the value.
- **Wait for a component's own fetch before asserting**, or React reports a state update outside
  `act(...)`. Those warnings mask real ones once there are a few.

## ESLint

`react-refresh/only-export-components` is configured with `allowExportNames` for the route
module exports. If you add a new React Router export convention, add it there rather than
disabling the rule inline.
