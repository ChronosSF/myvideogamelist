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

## State & effects

- **Do not call `setState` synchronously inside an effect.** Adjust state during render
  (React's documented pattern for resetting on a prop change), or use `useSyncExternalStore`
  for external state. ESLint enforces this via `react-hooks/set-state-in-effect`.
- Always handle loading and error states explicitly. Never leave a silent broken UI.
- One component per file; filename matches the export.

## Styling

Tailwind utilities inline, plus a scoped `ComponentName.css` per component where needed.
Global styles in `src/index.css`, app shell in `src/App.css` — both imported from
`src/root.tsx`, since there is no `index.html` in framework mode.

## ESLint

`react-refresh/only-export-components` is configured with `allowExportNames` for the route
module exports. If you add a new React Router export convention, add it there rather than
disabling the rule inline.
