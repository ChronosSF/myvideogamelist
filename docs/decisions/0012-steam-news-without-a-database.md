# 0012. Steam news is cached in memory, not stored in the database

**Status:** Implemented

> **Later note.** The Context below describes the PostgreSQL move as pending, which it was when
> this was written. PostgreSQL has since landed locally ([0008](0008-postgresql-over-sqlite.md),
> [0014](0014-rds-postgresql-over-aurora.md)), so the "one fewer migration to regenerate"
> argument has expired. The decision stands on its other reason, which was always the stronger
> one: this data is derived, regenerable and TTL'd — cache-shaped, not table-shaped.

## Context

ROADMAP §3.4 specified Steam news with two storage assumptions: N1 would "store the mapping on
the local game-metadata cache table from §5", and N3 would run "a background refresh job
writing to cache". Both imply new EF Core entities.

That collides with [0008](0008-postgresql-over-sqlite.md), which is accepted but not built.
Moving to PostgreSQL requires **regenerating the whole migration set**, because the existing
migrations carry SQLite-specific column types — verified: they emit `type: "INTEGER"`,
`type: "TEXT"` and `Sqlite:Autoincrement` annotations. Every table added before that move is
another table whose migration has to be regenerated and re-verified against a database engine
nobody can run locally yet, since 0008 is blocked on Docker.

So the question was asked directly before any code was written: does this feature make the
PostgreSQL migration harder?

## Decision

**Build the feature with no database involvement at all.** `ApplicationDbContext` is untouched,
no entity is added and no migration is generated. Both the IGDB-to-AppID mapping and the news
feeds live in `IMemoryCache`, alongside the IGDB access token and game lookups already cached
there.

This is not only a scheduling convenience. The data is genuinely cache-shaped rather than
table-shaped: it is derived from two upstreams, regenerable at any time, owned by no user, and
only valid for a bounded window. Putting it in a relational table would mean rows nobody owns,
a hand-written eviction policy, and a second source of truth to reconcile against Steam.

Cache lifetimes: AppID mappings 24h (a game's storefront identity does not change), news feeds
30 minutes, empty feeds 10 minutes, the composed `/api/home` payload 15 minutes — dropping to 1
minute when IGDB failed, so a transient outage is not pinned to the front page for the full
window.

### Trending uses `popularity_type` 5, not the IGDB-native types

The rail needed a popularity source. The obvious existing option — sorting the catalogue by
`aggregated_rating`, which `GetGamesAsync` does — is a poor proxy: live output was dominated by
obscure DLC and re-releases carrying a single perfect review, none of them recognisable.

Comparing IGDB's `popularity_types` against live data:

| Type | Source | Verdict |
|---|---|---|
| 1 "Visits" | IGDB | Rejected. Returns zero-valued rows interleaved with junk and adult titles |
| 9 "Global Top Sellers" | Steam | Rejected. Values near-identical to 15 significant figures; ordering not meaningful |
| 3 "Playing" | IGDB | Viable and platform-neutral, but salted with junk entries |
| **5 "24hr Peak Players"** | **Steam** | **Chosen.** Well-separated values over uniformly recognisable titles |

Type 5 has a second property that decided it: being Steam-sourced, every game in it has a Steam
feed *by construction*, so the news rail is reliably non-empty. The rail is therefore labelled
"the most-played games on Steam today" rather than a platform-neutral claim it cannot support.

## Consequences

- **The PostgreSQL migration is exactly as hard as it was before this feature.** Same six
  migrations, same two tables, same regeneration.
- When the distributed cache in §5 lands, the swap is `IMemoryCache` for `IDistributedCache`
  behind `ISteamNewsService`. Nothing else moves.
- **N3 stays open.** Serving is cache-on-miss, so the first request after expiry pays the Steam
  round trip. A background refresh belongs with the distributed cache, not before it: a
  per-instance job would duplicate the same work across every ECS task from 0007.
- The trending rail is PC-biased. If a platform-neutral rail is wanted later, type 3 "Playing"
  is the candidate, but it needs junk filtering that type 5 did not.
- **`external_games.category` is gone.** Filtering `where category = 1` returns zero rows
  silently rather than erroring — the field is simply absent from responses. Steam is
  `external_game_source = 1`. This cost a debugging cycle: the feature built, deployed and
  returned an empty rail with no warning in the logs. ROADMAP §3.4 has been corrected.

## Result

`/api/home` composes the spotlight, trending rail and news rail in one server-rendered payload:
3.7s cold, 16ms warm. Games with no Steam presence answer 200 with an empty list and the panel
hides itself, verified against a console exclusive.
