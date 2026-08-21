# MyVideoGameList — Project Guidelines

## Overview

A full-stack video game tracking app (similar to MyAnimeList / Trakt.tv for games). Users can track games across lists (Playing, Completed, On Hold, Dropped, Backlog), manage a Wishlist, and browse upcoming releases across platforms.

## Repository Layout

```
MyVideoGameList.Server/         # ASP.NET Core (.NET 10) REST API
MyVideoGameList.Server.Tests/   # xUnit unit tests for the server
myvideogamelist.client/         # React 19 + TypeScript + React Router 7 (SSR)
.github/                        # CI workflows and Copilot customisation
```

## Build & Dev Commands

The front end is server-rendered and runs its own Node process. Both must be running.

```bash
# API (terminal 1)
cd MyVideoGameList.Server && dotnet run

# SSR front end (terminal 2) - this is the URL you open
cd myvideogamelist.client && npm run dev

# Client checks
cd myvideogamelist.client && npm run lint
cd myvideogamelist.client && npm run typecheck
cd myvideogamelist.client && npm run build

# Server build and tests
dotnet build MyVideoGameList.Server/MyVideoGameList.Server.csproj
dotnet test MyVideoGameList.Server.Tests/MyVideoGameList.Server.Tests.csproj
```

## Architecture

- The front end uses **React Router 7 in framework mode** with SSR enabled. It runs as a separate Node process and proxies `/api/*` to the ASP.NET backend. ASP.NET serves the API only — it no longer hosts the SPA, and the SpaProxy package has been removed.
- Route modules live in `src/pages/` and are registered in `src/routes.ts`. A route module exports a default component plus optional `loader`, `meta`, `links` and `ErrorBoundary`.
- `src/root.tsx` owns the HTML document, the context providers and the global error boundary.
- Route types are generated into `.react-router/types` by `react-router typegen`; run `npm run typecheck` rather than bare `tsc`, or the `./+types/*` imports will not resolve.
- Server-side loaders cannot use relative URLs. Use `apiUrl()` from `@/lib/api` for any fetch that may run during SSR.

## Conventions

- All new source files in the client must be `.tsx` (components) or `.ts` (logic/utilities). No `.js`/`.jsx`.
- API controllers live in `MyVideoGameList.Server/Controllers/`.
- Keep build scripts consistent: `react-router build` for the client build, `react-router typegen && tsc -b` for type-checking.
- Never read `localStorage`, `window` or `document` during render or in a state initializer — it breaks SSR. Use `@/lib/useStoredNumberSet` as the pattern for browser-only state.
- Secrets belong in user secrets or environment variables, never in `appsettings.json`.
- This is a **proprietary** project — do not suggest open-source licences or add licence headers to new files.
