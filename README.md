# MyVideoGameList

A personal video game tracking app — think [MyAnimeList](https://myanimelist.net/), [IMDb](https://www.imdb.com/), or [Trakt.tv](https://trakt.tv/), but for video games.

Keep track of every game you've played, build your wishlist, manage your backlog, and discover what's coming next across all major platforms.

---

## Features

- **Game Lists** — Organise your games into lists: *Playing*, *Completed*, *On Hold*, *Dropped*, and *Plan to Play (Backlog)*
- **Wishlist** — Save games you want to buy or try
- **Upcoming Releases** — Browse upcoming titles across PC, PlayStation, Xbox, Nintendo Switch, and more
- **Game Details** — View release dates, platforms, genres, and descriptions
- **User Profiles** — Track your own stats and history

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| [React 19](https://react.dev/) | UI framework |
| [TypeScript](https://www.typescriptlang.org/) | Type-safe JavaScript |
| [Vite](https://vitejs.dev/) | Build tool & dev server |
| [React Router 7](https://reactrouter.com/) (framework mode) | Routing & server-side rendering |

### Backend
| Technology | Purpose |
|---|---|
| [ASP.NET Core](https://dotnet.microsoft.com/en-us/apps/aspnet) (.NET 10) | REST API & server |
| C# | Server-side language |

---

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/en-us/download)
- [Node.js 24+](https://nodejs.org/)

### Configure secrets

IGDB credentials are never committed. Set them once per machine:

```bash
cd MyVideoGameList.Server
dotnet user-secrets set "Igdb:ClientId" "<your client id>"
dotnet user-secrets set "Igdb:ClientSecret" "<your client secret>"
```

Get them from the [Twitch developer console](https://dev.twitch.tv/console/apps). Deployed
environments supply the same values as `Igdb__ClientId` / `Igdb__ClientSecret` environment
variables instead.

### Run locally

The client is server-rendered, so it runs its own Node server rather than being served by
ASP.NET. **Two processes, two terminals:**

```bash
# Terminal 1 - the API
cd MyVideoGameList.Server
dotnet run

# Terminal 2 - the SSR front end
cd myvideogamelist.client
npm install
npm run dev
```

Open the URL printed by `npm run dev` (https://localhost:58546 by default) — **not** the
backend's URL. The dev server renders pages and forwards `/api/*` to ASP.NET on
`http://localhost:5039`. Override that with `API_BASE_URL` if the backend runs elsewhere.

`dotnet run` alone will start the API only; it no longer serves the front end.

> **Use `npm run dev`, not `npm start`.**
> `npm start` serves the production build, which has no `/api` proxy — pages render but
> every client-side request 404s. In a real deployment a reverse proxy (CloudFront, nginx)
> routes `/api/*` to the API and everything else to the SSR server; `npm run dev` stands in
> for that locally. See [Serving the production build](#serving-the-production-build).

### Other commands

```bash
cd myvideogamelist.client
npm run lint         # ESLint
npm run typecheck    # generate route types, then tsc
npm run build        # production build

dotnet test          # server unit tests
```

### Serving the production build

`npm start` runs `react-router-serve` on port 3000. It renders pages correctly — server-side
loaders call the API directly via `API_BASE_URL` — but it does **not** proxy `/api`, so any
request the browser makes will 404.

That is the correct production shape: the SSR server is not meant to be the API gateway. To
exercise the built app end to end locally you need something in front of both, for example
nginx routing `/api/*` to `http://localhost:5039` and `/*` to `http://localhost:3000`.

Health endpoints: `/healthz` (liveness) and `/readyz` (database + IGDB reachability).

---

## Project docs

| File | What it is |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Working instructions: commands, layout, gotchas |
| [`.claude/rules/`](.claude/rules/) | Backend and frontend conventions, scoped by path |
| [`docs/decisions/`](docs/decisions/) | Architecture decision records — why the code is like this |
| [`ROADMAP.md`](ROADMAP.md) | Forward-looking plan |

---

## CI

Pull requests and pushes to `master` are validated by GitHub Actions: the client is linted,
type-checked and built; the server is built and unit-tested; CodeQL analyses both languages.

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
