# 0002. Server-side rendering via React Router 7 framework mode

**Status:** Implemented

## Context

The client was a Vite SPA served as static files by ASP.NET via `MapFallbackToFile`.
Crawlers received an empty `<div id="root">`.

Public game pages and user profiles are the intended organic acquisition channel, and the
project owns `myvideogamelist.net`. Sitemaps and Open Graph tags are pointless while there
is no server-rendered content to index, so SSR gated the entire SEO workstream.

## Decision

Migrate the client to **React Router 7 framework mode** with `ssr: true`.

The project already depended on `react-router-dom` 7, so framework mode was a far smaller
step than migrating to Next.js. `appDirectory` is set to `src`, so existing imports and the
`@/` alias keep working rather than everything moving to `app/`.

**Pinned to the v7 line deliberately.** React Router 8 was current at the time, but taking a
major upgrade and an architecture migration together would have made any failure hard to
attribute. The v8 upgrade is a separate, later change.

## Consequences

- `index.html`, `src/main.tsx` and `src/App.tsx` are gone. `src/root.tsx` owns the HTML
  document, the providers and the global `ErrorBoundary`; `src/routes.ts` owns the routes.
- The `ErrorBoundary` renders outside the context providers — the error may have come from
  one of them — so it must not use `Navbar` or anything calling `useAuth`.
- Route modules export `loader`, `meta`, `links` and `ErrorBoundary` alongside the
  component, so ESLint's `react-refresh/only-export-components` needed `allowExportNames`.
- Route types are generated into `.react-router/`. Bare `tsc` fails; `npm run typecheck`
  runs `react-router typegen` first.
- SSR bans `window`/`document`/`localStorage` during render. This surfaced a real bug: the
  upcoming timeline read `localStorage` in a `useState` initializer, which would have
  produced a hydration mismatch. Replaced with `useSyncExternalStore`
  (`@/lib/useStoredNumberSet`).
- **Only the game route has a loader so far.** `GamesPage`, `ListsPage` and `UserPage` still
  fetch client-side — fine for authenticated views, but anything meant to be indexed needs
  a loader.
- ASP.NET no longer serves the front end at all. See 0003.

## Result

Game pages server-render real content with `title`, `description` and Open Graph tags, and
unknown routes return a genuine HTTP 404 rather than a 200 with an empty page.
