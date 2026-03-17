# MyVideoGameList — Project Guidelines

## Overview

A full-stack video game tracking app (similar to MyAnimeList / Trakt.tv for games). Users can track games across lists (Playing, Completed, On Hold, Dropped, Backlog), manage a Wishlist, and browse upcoming releases across platforms.

## Repository Layout

```
MyVideoGameList.Server/   # ASP.NET Core (.NET 10) REST API
myvideogamelist.client/   # React 19 + TypeScript + Vite SPA
.github/                  # CI workflows and Copilot customisation
```

## Build & Dev Commands

```bash
# Full stack (server starts Vite dev proxy automatically)
cd MyVideoGameList.Server && dotnet run

# Client only
cd myvideogamelist.client && npm run dev

# Client build (type-checks first)
cd myvideogamelist.client && npm run build

# Server build
dotnet build MyVideoGameList.Server/MyVideoGameList.Server.csproj
```

## Architecture

- The SPA is served via the **ASP.NET SPA proxy** (`Microsoft.AspNetCore.SpaProxy`) in development; in production it is built and served as static files.
- The server project references the client `.esproj` — use `--no-dependencies` when building the server in CI to skip triggering an npm build.

## Conventions

- All new source files in the client must be `.tsx` (components) or `.ts` (logic/utilities). No `.js`/`.jsx`.
- API controllers live in `MyVideoGameList.Server/Controllers/`.
- Keep build scripts consistent: always `tsc -b && vite build` for the client build.
- This is a **proprietary** project — do not suggest open-source licences or add licence headers to new files.
