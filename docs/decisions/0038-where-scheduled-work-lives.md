# 0038. Where scheduled work lives, and what a sweep owes a fleet

**Status:** Implemented

Completes `specs/csv-list-import.md` §S9, which [0037](0037-a-tracker-import-carries-history.md)
shipped without. Extends [0012](0012-steam-news-without-a-database.md), which is the other record
about work that no request asks for.

## Context

Everything this application does is request-scoped. A user acts, a controller handles it, a scoped
service writes, and the `DbContext` lives and dies with the request. That is true of every service
in `Services/` without exception, and it is why there has never been an `IHostedService` in the
project.

Import retention does not fit. §S9 says jobs and their rows are deleted seven days after
completion, and nobody requests a deletion — the user whose rows they are has, by construction,
stopped interacting with them. So the feature needs a kind of component the codebase did not have,
and the first one sets the pattern the next will copy.

Two things made this urgent rather than tidy. The automated review on
[#93](https://github.com/ChronosSF/myvideogamelist/pull/93) pointed out that **`MaxPendingJobs`
stops counting once a job closes**, so the cap bounds concurrent reviews and not storage at all: an
account can import repeatedly and every job it ever ran stays, with up to 5,000 `jsonb` rows each,
in the table *and* in every `GetJobs` response and data export. And retention here is not only
about disk. The rows are somebody's parsed library; keeping them after the job they belong to is
finished is holding data for no reason anyone could state.

### §S9 has a hole

The spec says "seven days after completion". A job that is never committed or cancelled has no
completion, so under that rule alone it lives for ever — and it keeps one of the three
`MaxPendingJobs` slots with it. **Three abandoned uploads and that account cannot import again
until it finds and cancels one of them.** The review screen does offer that, so this is a dead end
rather than a locked door — but nobody returns to cancel a review they walked away from, which is
why it is still a harder failure than the storage growth the rule was written to prevent. Abandoning
a review is the single most likely thing to happen to an import that goes wrong.

## Decision

### 1. Scheduled work is a `BackgroundService`, and this is the first one

`ImportRetentionService`, registered with `AddHostedService` in `Program.cs`. Not a queue, not a
broker, not an external scheduler: the work is one `DELETE` an hour, and §S5's "a hosted service
plus a queue is enough at this scale; do not add a broker for this" applies with the queue removed
as well.

Three properties of hosted services are load-bearing and are commented at the class, because each
is easy to get wrong:

- A `BackgroundService` is a **singleton**, so it cannot take `ApplicationDbContext` by
  constructor injection. It takes `IServiceScopeFactory` and creates a scope per sweep. Capturing
  a scoped context for the process lifetime is how one ends up shared across threads with a change
  tracker that never empties.
- **An exception escaping `ExecuteAsync` stops the host.** Since .NET 6 the default
  `HostOptions.BackgroundServiceExceptionBehavior` is `StopHost`: the exception is logged and the
  process exits, so one failed sweep would take the whole API down and have ECS replace the task.
  (Before .NET 6 it was the opposite failure — the service died silently and the host carried on —
  and that stale description is what the first draft of this record shipped.) So the loop catches
  per tick and logs; a missed sweep costs nothing the next one does not fix. The default is pinned
  by `ImportRetentionTests`, so a runtime that changes it fails the build.
- It runs **once per ECS task**, so it must be safe to run N times at once.

### 2. Two windows, because a pending job means something different

| Job | Kept for | Why |
|---|---|---|
| `done` or `cancelled` | **7 days** from `CompletedAt` (§S9) | A closed job is a receipt — the result summary and the list of rows that did not import. Nothing here is anybody's only copy: the uploaded file was never stored |
| `pending` | **14 days** from `UpdatedAt` | Work somebody may still intend to come back to. Longer, because deleting it costs them the decisions they had already made, which re-uploading does not give back |

The second window is not in §S9 and is the fix for the hole above. Deleting an abandoned job also
frees its `MaxPendingJobs` slot, which is the more important of the two effects.

**`UpdatedAt`, not `CreatedAt`, and the column was added for this.** The first version of this
record measured the pending window from the upload, which makes the window a deadline to finish by
rather than a window of silence — so a 5,000-row export somebody resolved across three weekends was
deleted on day fourteen mid-review, with every decision they had made, and the justification in the
row above for choosing the *longer* window was false as written. Every write to a job stamps
`ImportJob.UpdatedAt`: saving decisions, committing, cancelling. Reading the review deliberately
does not, because a `GET` that writes is its own problem and a job left open in a background tab
would then never expire at all. The distinction is pinned by
`ImportRetentionTests.ExpiredAt_APendingJobUploadedLongAgoButWorkedOnRecently_IsKept`, which the
`CreatedAt` version fails.

The rule lives in `ImportRetention.ExpiredAt` as an **`Expression`**, not a delegate, so the sweep
translates it to SQL and the tests run *the identical expression* against the in-memory provider. A
test that restated the rule would agree with itself rather than with the thing that deletes rows.

### 3. One task sweeps, through a transaction-scoped advisory lock

`pg_try_advisory_xact_lock`. Correctness never depended on it — the delete is idempotent and every
task computes the same predicate — so what it buys is the work being done once rather than N times
against a predicate no index serves.

**Transaction-scoped, not session-scoped**, and that distinction is the trap — though not quite
the one first written here. `pg_advisory_lock` outlives the statement, so a pooled connection goes
back into the pool still holding it. The next borrower does *not* inherit it: Npgsql resets a reused
connection, and PostgreSQL's `DISCARD ALL` ends with `pg_advisory_unlock_all()` — verified by taking
a session lock, running `DISCARD ALL`, and watching `pg_locks` go from one advisory lock to none.

What does happen is that the server-side session keeps the lock while the connection sits idle in
the pool, until it is reused or pruned after Npgsql's connection idle lifetime. So every other
task's `pg_try_advisory_lock` fails for minutes rather than for ever — and every exit path of the
sweep would need its own unlock. The `_xact_` variant is released by the commit or the rollback
whatever happens, which is why it is the right choice regardless.

A task that does not get the lock returns immediately. There is nothing to wait for: the holder is
deleting exactly the rows this one would have.

### 4. No index for the predicate

It is an `OR` across two nullable columns, which needs two partial indexes to serve properly, and
the table it scans is kept small by this very sweep. Stated here so that its absence reads as a
decision. Revisit if it ever appears in a slow query log.

## Consequences

**`ExecuteDeleteAsync` needs a relational provider, so the deletion itself is not unit-tested.**
The suite runs on EF InMemory. This is the same line [0024](0024-the-ownership-contract.md)'s
`UserOwnedDataTests` already draws when it declines to assert cascade *behaviour* and asserts the
*model* instead: the predicate is tested, the execution is the provider's.

**What that left uncovered was found by running it.** The first version asked for the lock with
``SqlQuery<bool>($"SELECT pg_try_advisory_xact_lock({key})")``, which fails at runtime with
`column s.Value does not exist` — `SqlQuery<T>` wraps the statement as a subquery and projects
`s.Value`, so the scalar has to be aliased. It compiled, it passed every test, and because the loop
catches per tick it failed **into the log** rather than loudly. It was caught by seeding expired
rows into a real PostgreSQL and watching the sweep run, which was the only thing that could have
caught it. The verified behaviour: of four jobs, the two expired ones were deleted, their
`ImportRows` went with them through the cascade, and a ten-day-old *pending* job was correctly
left alone.

**The rows go through the foreign key's `ON DELETE CASCADE`.** The sweep deletes jobs and never
mentions `ImportRows`. That constraint is from [0037](0037-a-tracker-import-carries-history.md) and
a raw `DELETE` is exactly what it exists to handle.

**A deploy sweeps immediately.** The service runs once at startup before starting its timer, rather
than waiting an hour. A task that has just restarted is when a backlog is most likely, and the
advisory lock makes a whole fleet starting at once a non-event.

**The next background job copies this.** Whatever it is — CloudFront invalidation (ROADMAP D14), a
`CachedGames` refresh, scheduled exports — it inherits the scoping rule, the catch-per-tick rule and
the question of what it owes a fleet running N copies of it.
