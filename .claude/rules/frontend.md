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
- For persisted browser-only state, follow `@/lib/useStoredNumberSet`: `useSyncExternalStore`
  with an empty server snapshot. Reading in an effect also works but commits a throwaway
  render first, and `getSnapshot` must return a stable reference or React loops.
- Server-side loaders have no origin to resolve a relative URL against. Use `apiUrl()` from
  `@/lib/api` for any fetch that can run during SSR.

## Route modules

Files in `src/pages/` registered in `src/routes.ts`. A route module exports a default
component plus optional `loader`, `meta`, `links`, `headers` and `ErrorBoundary`.

- Prefer a `loader` over `useEffect` fetching for anything that should be server-rendered
  or indexed. Authenticated, user-specific views can stay client-side.
- Throw a `Response` from a loader for not-found and upstream failures. The root
  `ErrorBoundary` renders it and the correct HTTP status reaches crawlers — a soft 404 that
  returns 200 is worse than useless for SEO.
- Give every indexable route a `meta` export with title, description and Open Graph tags.
- Route types come from `react-router typegen`; import them as `./+types/<RouteName>`.

## Optimistic updates

The providers apply a change locally, fire the request, and undo the change if it fails. Two rules
that are easy to get wrong and were got wrong once (`docs/decisions/0022-*`):

- **Roll back surgically, never by restoring a snapshot.** Mutations for different games overlap by
  design — the pending set is per game id — so putting back the list as it was before *this*
  request also undoes whichever other request succeeded meanwhile. The visible symptom is a removed
  game reappearing. Dispatch an action that touches only the affected item, computed from current
  state.
- **Keep the load error and the mutation error in separate fields.** A failed fetch means there is
  nothing trustworthy to show. A failed mutation has already been rolled back, so the data beside
  it is fine — sharing one field makes a failed toggle render as "failed to load" and hide a
  perfectly good list. Clear the mutation error on the next success.

## State & effects

- **Do not call `setState` synchronously inside an effect.** Adjust state during render
  (React's documented pattern for resetting on a prop change), or use `useSyncExternalStore`
  for external state. ESLint enforces this via `react-hooks/set-state-in-effect`.
- Always handle loading and error states explicitly. Never leave a silent broken UI.
- One component per file; filename matches the export.

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

## Tests

Vitest with jsdom and Testing Library, in `*.test.ts(x)` files beside the code they cover.
`npm run test` runs once; `npm run test:watch` iterates. `vitest.config.ts` is deliberately
separate from `vite.config.ts`, which exports the HTTPS dev certificate at module load.

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
