---
paths:
  - "MyVideoGameList.Server/**/*.cs"
  - "MyVideoGameList.Server.Tests/**/*.cs"
---

# Backend conventions

## Language & tooling

- Target **net10.0**. Nullable reference types are on: everything is explicitly `T?` or
  guaranteed non-null. Do not reach for `!` unless the compiler genuinely cannot infer it.
- Implicit usings are enabled — no redundant `using System;`.

## Controllers

- Live in `Controllers/`, inherit `ControllerBase` (no views), decorated `[ApiController]`.
- Return `ActionResult<T>` or `IActionResult` with typed results (`Ok`, `NotFound`,
  `BadRequest`), never naked values.
- Keep them thin — business logic belongs in a service.
- **Validate with attributes, not hand-rolled `if` guards.** Use `[Range]`, `[Required]`
  and friends and let `[ApiController]`'s automatic model validation return the 400. A
  hand-rolled `if (id <= 0) return BadRequest(...)` in front of a database write trips
  CodeQL's `cs/user-controlled-bypass` rule.
- **Every action takes a `CancellationToken`** and passes it down through services to the
  HTTP client and EF Core.

## Services & data

- Interfaces alongside implementations in `Services/`.
- `async`/`await` throughout. No `.Result`, no `.Wait()`.
- Every user-scoped query filters on `userId` in the predicate itself — that scoping *is*
  the authorization boundary, so never rely on a route value to enforce it.
- Use `AsNoTracking()` for read-only queries.

## IGDB

- All calls funnel through `IgdbService.QueryAsync`, which owns auth headers, content type
  and cancellation. Do not hand-roll `HttpRequestMessage` for a new endpoint.
- Escape any user input interpolated into an Apicalypse query (see `BuildQuery`) —
  backslashes and double quotes both need escaping.
- IGDB caps responses at 500 rows. Chunk id lookups and bound every pagination loop; an
  unbounded `while (true)` against a rate-limited API is a production incident.
- Cache misses as well as hits, so a bad id cannot hammer the upstream on repeat requests.

## Configuration & secrets

- `appsettings.json` holds defaults and documentation only. Secrets come from user secrets
  locally and environment variables when deployed. Never commit a credential.

## Tests

- xUnit in `MyVideoGameList.Server.Tests/`, EF Core InMemory for the database, NSubstitute
  for collaborators.
- Pure functions worth testing directly are `internal` and exposed via `InternalsVisibleTo`
  rather than made public.
- Name tests `Method_Scenario_ExpectedResult`.
