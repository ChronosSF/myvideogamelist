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

### Backend
| Technology | Purpose |
|---|---|
| [ASP.NET Core](https://dotnet.microsoft.com/en-us/apps/aspnet) (.NET 10) | REST API & server |
| C# | Server-side language |

---

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/en-us/download)
- [Node.js 22+](https://nodejs.org/)

### Run locally

```bash
# Install client dependencies
cd myvideogamelist.client
npm install

# Run the full stack (server + client dev server)
cd ../MyVideoGameList.Server
dotnet run
```

The ASP.NET backend will start and automatically launch the Vite dev server via the SPA proxy. Navigate to the HTTPS URL shown in your terminal.

---

## CI

Pull requests are validated by a GitHub Actions workflow that builds both the client and server independently.

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
