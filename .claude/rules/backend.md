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

## The pipeline and its failures

- Middleware lives in `Security/` and `Errors/`, and the order in `Program.cs` is load-bearing:
  forwarded headers first, then the exception handler, then security headers, the write guard and
  the rate limiter. Anything added above the exception handler will not be seen by a failed request,
  and anything cheap that can refuse a request belongs above the limiter — a request refused after
  taking a permit has spent somebody's budget to be told no.
- **Do not catch a third party's failure to return a 500.** `HttpRequestException`, a broken circuit
  and a timeout are turned into a 502 centrally by `UpstreamFailureHandler`; a service that swallows
  one is deciding on the caller's behalf that a degraded page is better than an honest error. The
  ones that do degrade deliberately — the home composite, the health check — say so in a comment.
- **A new endpoint that changes state needs no new guard**, but it does have to use a method that
  says so. The write guard exempts `GET`, `HEAD` and `OPTIONS`, so a state change behind a `GET` is
  both forgeable and cacheable.
- Only `/api/auth/login` and `/api/auth/register` are rate-limited, and adding a policy to anything
  a loader calls would throttle every visitor at once — see `docs/decisions/0033-*`.

## Configuration & secrets

- `appsettings.json` holds defaults and documentation only. Secrets come from user secrets
  locally and environment variables when deployed. Never commit a credential.

## Tests

- xUnit in `MyVideoGameList.Server.Tests/`, EF Core InMemory for the database, NSubstitute
  for collaborators.
- Pure functions worth testing directly are `internal` and exposed via `InternalsVisibleTo`
  rather than made public.
- Name tests `Method_Scenario_ExpectedResult`.
