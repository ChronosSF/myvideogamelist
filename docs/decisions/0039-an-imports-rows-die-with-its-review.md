# 0039. An import's rows die with its review

**Status:** Implemented

Amends [0038](0038-where-scheduled-work-lives.md), which swept a closed job's rows seven days after
it closed, and `specs/csv-list-import.md` §S9, which assumed a job and its rows have one lifetime.
Both tables come from [0037](0037-a-tracker-import-carries-history.md).

## Context

0038 exists because import jobs accumulated. `ImportService.MaxPendingJobs` stops counting once a
job closes, so nothing bounded how many an account could leave behind, and each one could hold up to
`MaxRows` — five thousand — `ImportRow`s of `jsonb`.

The mechanism it built is sound and is still here: an hourly `BackgroundService`, an advisory lock,
a batched delete, two windows. What that record never asked is **why a closed job had rows at all.**

An `ImportRow` is the review's working state. It holds the parsed title, the IGDB id the source
named or its owner picked, the shelf, the dates, and the decision made about it. By the time the job
closes, every one of those has gone somewhere else:

- a row that imported is now a `UserGameEntry`, with whatever playthrough, score and axis rows it
  implied;
- a row that did not is counted into `ImportJob.SkippedCount`;
- `RowCount` and `ImportedCount` account for the rest.

And nothing reads them again:

- `/import` renders a finished import as two integers, and does not link it;
- the per-row failure report §C5 promises is built inside `CommitAsync` and returned in **that
  response**. It was never persisted, so it is gone when the tab closes — seven-day window or no;
- `GetReviewAsync` had no state filter, so a bookmarked `/import/{doneJobId}` rendered a review
  screen headed "nothing is saved until you finish" over an import that had already finished. The
  one path that still reached these rows showed a screen that lied about them.

So the largest thing this feature stored was kept for a week after the last screen that could render
it, carried into its owner's data export, and deleted an hour at a time by the application's first
hosted service.

## Decision

### 1. A commit or a cancel deletes the job's rows

Inside the `SaveChangesAsync` that closes the job, not after it. §S8 already requires a commit to be
one transaction, and putting the deletion in it is what stops "the library is written" and "the rows
are gone" from becoming two states that can come apart — a failure between them would leave rows
whose decisions had already been applied.

`RemoveRange` over the rows the commit has already read, not `ExecuteDeleteAsync`. The deletion has
to join the existing `SaveChanges`, which `ExecuteDelete` cannot do: it issues its own statement
outside the change tracker. It also cannot run on the in-memory provider at all, which would have
cost every `CommitAsync` test in the suite — the same limitation 0038 records for the sweep.

`CommitAsync` therefore reads its rows **tracked**, where it used to read them `AsNoTracking`.
Attaching no-tracking copies in order to delete them throws the moment anything in the same scope
already holds those rows, which is exactly what a caller that creates a job and commits it through
one context does. `CancelAsync` reads its rows for the first time in order to delete them: a query
it did not make before, on the rarest of the three paths, for the same invariant.

### 2. A review is something you do to a pending job

`GetReviewAsync` now scopes to `State == pending` rather than to ownership alone. Without it,
deleting the rows would take the stale-bookmark screen from misleading to empty *and* misleading.
With it, `/import/{closedJobId}` is a 404 — what that screen already knows how to say, and a state
only a bookmark reaches, since nothing in the client links a closed job.

### 3. Retention keeps the receipt, and only the receipt

0038's two windows stand. The seven-day one now means something simpler: a closed job is one small
row naming the file, when it ran, how many games went in and how many were passed over, which is
exactly what `/import` lists. The fourteen-day window is untouched, and is where the volume now
lives — a pending job is the only kind that still has rows.

## Consequences

**The sweep shrank; it did not become unnecessary.** It is tempting to conclude that retention can
go now. It cannot: an abandoned *pending* job still holds up to five thousand rows and one of the
three `MaxPendingJobs` slots, and losing the slot is the harder of the two failures 0038 names. What
changed is that the seven-day window now deletes a few hundred bytes rather than several megabytes,
so the batch size 0038 §4 chose is bounded by abandoned reviews alone.

**A commit issues one `DELETE` per row.** `RemoveRange` deletes by primary key, so a five-thousand
row import adds five thousand statements to a `SaveChanges` that was already inserting that many
entries — batched by EF into a handful of round trips, each a primary-key delete PostgreSQL does not
have to think about. `ExecuteDeleteAsync` would make it one statement and is the obvious temptation;
it cannot join the `SaveChanges`, which is the whole point. Verified against the container: a
three-row commit emits **one** batched command carrying the job's `UPDATE`, the three `DELETE`s and
the three entry `INSERT`s, with the playthroughs in a second batch inside the same transaction.

**A data export no longer carries a finished import's rows.** `ImportRow` stays registered in
`UserDataExporter.Manifest` — the table is still user-owned and [0024](0024-the-ownership-contract.md)'s
guard still requires the registration — but in practice it now exports only reviews in progress.
That is the right document: an export carries what an account has, and a closed job's rows are not
something it has.

**Committing a closed job is refused twice over.** `CommitAsync` still checks the state, and that is
still the check that answers; there are now also no rows to commit. The second is why the first can
never be quietly dropped.

**Nothing about the event-log exemption changes.** [0026](0026-a-library-import-records-ownership-not-history.md) and
0037 let the import write a status with no `UserGameEvent`, and `UserGameEntry.Origin` is what
records that it did. `Origin` lives on the entry, not on the row, so deleting rows takes nothing
from the trail those records describe.
