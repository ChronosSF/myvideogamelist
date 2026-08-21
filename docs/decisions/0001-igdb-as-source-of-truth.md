# 0001. IGDB is the source of truth for game data

**Status:** Implemented

## Context

The project began with a local relational catalog — `Game`, `Developer`, `Publisher`,
`Genre`, `Platform` and four join tables — seeded with five hardcoded games. That was
scaffolding to build the UI against before IGDB was wired up.

Once IGDB was integrated, `GamesController` read from it exclusively and the local tables
became dead weight. Only `DevelopersController` and `PublishersController` still read them,
returning the five stale seed rows, and no client code called those endpoints. Meanwhile
`UserGameList.GameId` stored an *IGDB* id with no foreign key to the local `Games` table.

Two sources of truth, one of which nothing consumed.

## Decision

IGDB is canonical for all game metadata. The local catalog is removed entirely: seed data,
entity classes, both controllers, and all nine tables (migrations `RemoveDeadSeedData` then
`DropLocalGameCatalog`). The database stores user-owned data only.

The DTOs (`PlatformDto`, `GenreDto`, `DeveloperDto`, `PublisherDto`) stay — they are the
shape IGDB responses map onto and were never tied to the tables.

## Consequences

- `ApplicationDbContext` is down to `UserGameLists` and `UserHiddenPlatforms`, plus Identity.
- Every list load fans out to IGDB (`GetGamesByIdsAsync`). If IGDB is down or rate-limits,
  users cannot see their own lists. A local metadata cache is planned (ROADMAP §5) and is
  the main open consequence of this decision.
- **That cache must be keyed on IGDB ids and designed fresh.** Do not resurrect the old
  schema: its `Platform` ids collided with IGDB's — local id 6 was Nintendo Switch, IGDB 6
  is PC — while `UserHiddenPlatform.IgdbPlatformId` already stored IGDB ids. Two
  incompatible id spaces in one database is exactly the bug not to re-introduce.
- A cache has different requirements from a catalog anyway: refresh timestamps, TTLs,
  tolerance for partial data, and no referential integrity to user rows.
