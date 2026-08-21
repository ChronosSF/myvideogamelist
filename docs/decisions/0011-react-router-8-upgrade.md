# 0011. Upgrade to React Router 8

**Status:** Implemented — supersedes the version pin in [0002](0002-server-side-rendering.md)

## Context

[0002](0002-server-side-rendering.md) deliberately pinned the SSR migration to the React
Router v7 line, so that a major upgrade and an architecture migration would not land
together and make failures hard to attribute. That migration is done and stable, so the pin
had served its purpose.

React Router 8 also moves the project to an **annual** major release cycle, making 8.x the
stable target for roughly a year rather than something that churns again shortly.

## Decision

Upgrade to React Router 8.3.0, React 19.2.8, and drop `react-router-dom`.

The migration surface turned out to be small, because 0002 had already done most of the
work incidentally: v8's largest breaking change is the removal of `react-router-dom`, and
every import had already been switched to `react-router` during the SSR migration.

Sequenced deliberately: enable all five `v8_*` future flags on v7 first and verify, then
bump the major. That way any behavioural fallout surfaces while it is still one revertible
flag rather than a major version rollback.

## What actually changed

| Change | Scope |
|---|---|
| Five `v8_*` future flags enabled, verified, then removed | They are default behaviour in v8, so the `future` block is gone entirely |
| `splitRouteModules` | Moved from a future flag to a top-level config field, default `true` |
| `meta({ data })` → `meta({ loaderData })` | One usage, in `GamePage`. `data` was deprecated in v7 and removed in v8 |
| `react-router-dom` dependency | Removed. Zero imports referenced it |
| React 19.2.4 → 19.2.8 | v8 requires ≥ 19.2.7 |

Requirements already met and needing no work: Node ≥ 22.22.0 (on 24), Vite ≥ 7 (on 8),
ESM-only packages, no `isSsrBuild` in the Vite config, no custom server or `getLoadContext`,
no loaders reading `request.url`, and no `clientLoader`/`HydrateFallback` routes.

## Consequences

- **Middleware is now available and on by default.** Worth reaching for when auth,
  logging or request-scoped context is next needed, rather than hand-rolling it.
- **`v8_trailingSlashAwareDataRequests` changes `.data` URL formats** — trailing-slash
  routes now request `/path/_.data`, and the root is `/_.data` rather than `/_root.data`.
  Nothing consumes those today, but **CloudFront cache behaviours (0007) must be written
  against the v8 format.** Doing the upgrade before that work avoids configuring cache rules
  that would then need invalidating and rewriting.
- A clean reinstall was required — npm could not resolve the major incrementally and got
  stuck on a stale `@react-router/dev`. Deleting `node_modules` and `package-lock.json`
  and resolving in one pass fixed it, and regenerating the lock is correct for a major bump
  anyway.
- The reinstall also pulled a newer `eslint-plugin-react-hooks`, which flagged a
  pre-existing `set-state-in-effect` violation in `useHiddenPlatforms`. Fixed by adjusting
  state during render, the same pattern already used in `GamesPage`.
- The reinstall cleared the outstanding `@babel/core` advisory as a side effect: `npm audit`
  now reports zero vulnerabilities.
