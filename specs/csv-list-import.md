# Spec — Import lists from other game trackers (CSV)

Status: **partly superseded — being built, Grouvee first**
Relates to: `ROADMAP.md` Tier 2 "Import from Steam / PSN / Xbox / GOG" (line 57) and the
paid-tier table row "Import from Steam/PSN/Xbox" (line 187).

> **Read `docs/decisions/0037-a-tracker-import-carries-history.md` before this document.**
> This spec was written in August 2026 from public documentation, without a real export in hand. A
> genuine 608-row Grouvee export has since falsified three of its premises, and 0037 records what
> replaced them:
>
> - **§4 is wrong for Grouvee.** Their export carries `igdb_id` on 606 of 608 rows, so the fuzzy
>   matcher (M1–M4) is not on the critical path and is deferred to the first preset that needs it.
> - **§3's seam is wrong.** Grouvee's export is a nested document — `shelves` is an object, `dates`
>   is an array of runs — which no column map can express. The interface is `IImportSource`
>   (file → canonical rows); a flat CSV plus a column map is one implementation of it.
> - **§7's blockers are all resolved.** Per-entry fields, the five-status taxonomy, playthroughs,
>   reviews, the wishlist axis and the metadata cache have all shipped.
>
> §3.2's status vocabulary, §5's entities and §6's client work stand. §10's order does not.

---

## 1. Why this exists

Retyping 300 games is the single biggest reason people abandon a new tracker. The roadmap already
says this, but it scopes import to the *platform* stores (Steam, PSN, Xbox, GOG). Those give us a
library — what a user **owns**. They do not give us progression: status, score, when it was played,
hours, notes, reviews. That data only exists in the tracker the user is already using, and the
users most likely to move are exactly the ones who already keep it somewhere.

So there are two distinct importers, and they should not be conflated:

| | Platform import | Tracker import (this spec) |
|---|---|---|
| Source | Steam / PSN / Xbox / GOG APIs | CSV file the user uploads |
| Gives us | Owned titles, playtime | Status, score, dates, hours, notes, reviews |
| Cost model | Recurring background sync per user | One-off, user-initiated |
| Matching | Store ID → IGDB | Title + year → IGDB (fuzzy) |

This spec covers the second one.

## 2. The landscape — who can actually be imported from

Researched Aug 2026. "Official" means the service itself offers the download; scraper userscripts
are not something we can support.

| Service | Export | Carries progression? | Priority |
|---|---|---|---|
| **HowLongToBeat** | Official — all lists or selected games | Status, platform, main/extra/completionist times | **P1** — largest backlog userbase after Steam |
| **Grouvee** | Official CSV, in settings | Shelves, rating, review text, dates played | **P1** — best documented, the one users ask for |
| **Backloggery** | Official CSV since v1.1.0 (Jul 2024), Settings → Data | Status, platform, notes | **P2** — free-text titles, no database ids, matching is hardest |
| **Completionator** | Official Excel/CSV | Completion %, achievements, playtime | **P2** |
| **Darkadia** | Official CSV | Playtime, notes, reviews, status | **P2** — has no import of its own, so its users are export-curious |
| **VGCollect** | Official CSV "backup" | Physical collection only (UPC, variant) | **P3** — ownership, not progression |
| **Backloggd** | None — roadmap only; users rely on third-party scrapers | — | **watch** — biggest community, revisit when shipped |
| **Glitchwave** | None found | — | — |

Takeaway: no two of these agree on column names, status vocabulary, date format, or how a platform
is spelled. Writing six bespoke parsers is six things to maintain and still fails on the seventh
service. Build a mapper instead.

## 3. Design — one generic mapper, N presets

```
upload CSV --> parse & sniff --> column mapping UI --> match against IGDB --> review screen --> commit
                    |                  ^                       |                    |
                    +-- preset detected +              auto / ambiguous / none   user resolves
```

- **One code path.** A preset is data — a column map plus a status-vocabulary map — not a class.
  Adding Darkadia is a JSON file, not new parsing logic.
- **Preset detection** is a header fingerprint. If it matches a known set, pre-fill the mapping and
  tell the user which service we think it is; they can always override.
- **An unrecognised CSV still works.** The mapping UI is the product; presets just skip a step.
  This also covers the spreadsheets people keep by hand, which is a real segment.

### 3.1 Canonical import row

Everything maps into this shape before anything touches the database:

| Field | Required | Notes |
|---|---|---|
| `title` | yes | The only field Backloggery reliably gives us |
| `releaseYear` | | Disambiguates remakes and reboots — the single most valuable matching signal after the title |
| `platform` | | Free text; normalised against our `Platform` table |
| `status` | | Mapped through the preset's status vocabulary |
| `score` | | Normalised to our 1–10 scale (5-star, 100-point and letter grades all occur in the wild) |
| `hoursPlayed` | | HLTB gives `h:mm`, Completionator gives a decimal |
| `startedOn` / `finishedOn` | | Several date formats; parse with an explicit culture, never `DateTime.Parse` on the ambient one |
| `notes` / `review` | | Long text, may contain newlines and commas — the parser must handle quoted multi-line fields |
| `isFavourite` / `isWishlist` | | Some services model these as a shelf, some as a flag |

### 3.2 Status vocabulary

Every service has its own words. The preset maps them onto our list taxonomy. Note that the
taxonomy today is `playing` / `backlog` / `finished` (`Models/UserGameList.cs`) but the roadmap's
Tier 1 item replaces it with Playing / Completed / On Hold / Dropped / Plan to Play plus Wishlist.
**Write the presets against the Tier 1 taxonomy** — importing into the three-value one throws away
Dropped and On Hold irrecoverably, and re-importing later is not something users will do.

Anything unmapped lands in a "these N rows had a status we didn't recognise" bucket on the review
screen with a dropdown, rather than being silently dropped or silently defaulted to backlog.

## 4. Matching — the actual hard part

Matching titles to IGDB ids is the feature for every source that does not carry ids of its own.
Grouvee does carry them, which is why the first preset shipped without any of this (ADR 0037); it
exists now, ahead of HowLongToBeat and Backloggery.

| ID | Requirement |
|---|---|
| M1 | Match on normalised title plus release year. Normalisation: lowercase, strip accents, punctuation and leading articles, fold roman numerals **up to thirty**, and compare the numbers in a title as a set of their own. Edition suffixes are dropped by a **second, looser key only** — see §4.1. **DONE** |
| M2 | Confidence tiers: **matched**, **ambiguous**, **unmatched** — defined in §4.1, because "single candidate" does not survive contact with IGDB. **DONE, amended** |
| M3 | Only matched rows are pre-checked on the review screen. Ambiguous rows show up to 5 candidates with cover art and year so the user resolves in one click. **DONE** |
| M4 | The user can skip a row entirely **(done)**, and can search IGDB inline for one nothing was found for **(not built)** |
| M5 | Batch the IGDB calls. A 500-row import must not be 500 round trips — group by normalised title and cache within the job. **DONE**: one search per distinct normalised title, and the games offered are written to `CachedGames` on the way past so the review screen asks for none of them again |
| M6 | Respect IGDB rate limits. Matching never runs inside the request that uploads the file. **DONE, amended** — it is its own endpoint called repeatedly rather than a background job; see §4.2 |
| M7 | Persist the resolved match so re-importing the same file is idempotent and the second run is instant. **Not built.** Playthroughs are already idempotent by their own key, so a second import duplicates no data — only the matching work |

### 4.1 The tiers, and why "single candidate" is not one of them

**IGDB holds a row per release, not a row per game.** A search for "Final Fantasy VII" answers with
seven entries carrying that exact title, "Resident Evil 2" with six, "Hollow Knight" with two. So a
tier defined as "exact title, single candidate" would fire for almost nothing anybody owns.

Two keys are computed for every title, and the difference between them is the safety rule: a wrong
automatic match writes a game its owner never played into a library they will not audit, while a
missed one costs a click.

- **The conservative key** — M1's normalisation *without* edition suffixes. This is the only key an
  automatic match may be decided on.
- **The loose key** — the same, plus a trailing edition, remaster, cut or remake. It may only ever
  *offer* a candidate. "Dark Souls Remastered" matches "Dark Souls: Remastered" outright and merely
  offers "Dark Souls".

A row is **matched** when exactly one candidate survives, where surviving means: its conservative
key is the row's, and either side's year is unknown or they are within one. Several survivors are
still an answer when one of them has at least twenty-five ratings and at least ten times the next —
which separates the canonical row from its re-release stubs without separating two genuinely
different games of one name. It is **ambiguous** when candidates cleared the similarity floor but no
single one survives that test, and **unmatched** when nothing cleared it.

The decision is made over every candidate that cleared the floor, and the list is cut to five only
afterwards. Truncating first does not degrade to "ask the user" — it hides the rival that was
holding the decision open and produces a confident wrong answer instead.

ADR 0040 records the live IGDB measurements each of these numbers comes from.

### 4.2 A pass is bounded and repeated, not queued

`POST /api/import/jobs/{id}/match` looks up a bounded batch of the rows whose file named no game and
answers with **the rows it examined**; the client merges them into what it holds and calls again
until a pass examines nothing. Each pass is its own transaction, so closing the tab costs only the
rows nobody had reached — which is the resumability §C4 asks for, with no queue and no second
background service. It answers for what it touched rather than for the whole job, because a large
id-less import is hundreds of passes and re-sending five thousand rows on each is a gigabyte of
JSON to import one file.

A row says whether it has been looked at — `unlooked` — separately from whether anything was
found — `unmatched`. Without both, the two are the same row, and every pass spends its whole budget
re-asking the questions the last one already failed to answer.

An IGDB outage fails the pass with a 502 rather than answering "nothing matched". The difference
matters: the first is a sentence somebody acts on by trying later, the second by giving up.

## 5. Server work

| ID | Item |
|---|---|
| S1 | `ImportJob` entity — id, userId, source preset, filename, status (`pending` / `mapping` / `matching` / `review` / `committing` / `done` / `failed`), row counts, createdAt |
| S2 | `ImportRow` entity — jobId, raw values (JSON), canonical values, matched IGDB id, confidence, user decision |
| S3 | `IImportService` alongside `IListService` — `CreateJobAsync`, `ApplyMappingAsync`, `GetReviewAsync`, `CommitAsync`, `CancelAsync`; every method takes a `CancellationToken` (roadmap §1 item 7) |
| S4 | Preset definitions as embedded JSON under `Services/Import/Presets/`, one file per service, loaded at startup |
| S5 | Background execution for matching. A hosted service plus a queue is enough at this scale; do not add a broker for this |
| S6 | CSV parsing via a real library (CsvHelper). Quoted multi-line review text is guaranteed to appear and hand-rolled splitting will corrupt it |
| S7 | Upload limits — 5 MB and 5,000 rows, enforced before parsing. Reject non-CSV by content sniff, not by extension |
| S8 | Commit is one transaction per job, upserting `UserGameList` entries. Existing entries are **not** overwritten by default — the review screen marks them "already in your list" and the user opts in per row |
| S9 | ~~Jobs and their rows are deleted 7 days after completion.~~ **DONE**, and amended twice — see §5.1 below. A job's rows go at the moment it closes rather than a week later, and the job row itself has two windows rather than one. The uploaded file is never persisted at all |

### 5.1 Retention: the rows go at commit, the job keeps two windows

#### A job and its rows do not have the same lifetime

§S9 treats them as one thing. They are not. An `ImportRow` is the review's working state — the
parsed title, the game it matched, the decision its owner made about it — and when the job closes
every one of those has either become a library entry or been counted into the job's `skippedCount`.

Nothing reads them again. `/import` shows a finished import as its counts and does not link it, the
per-row failure report §C5 promises travels in the commit's **own response** rather than being
stored, and the review screen refuses a job that is not pending — otherwise it would render an
empty but fully actionable "nothing is saved until you finish" over an import that is already over.
So a closed job's rows were up to 5,000 `jsonb` rows apiece that no screen could render, kept for a
week, carried in their owner's data export, and swept an hour at a time by a background service.

**A commit or a cancel deletes the job's rows in the same transaction that closes it.** §S8 already
demands that transaction; putting the deletion inside it is what stops "the library is written" and
"the rows are gone" from being two states that can come apart. Everything below is therefore about
the job row alone — a few hundred bytes naming a file and four counts.

#### The job row: two windows, not one

As written, §S9 covered only half the jobs there are. `CompletedAt` is set when a job is committed
or cancelled and never otherwise, so "7 days after completion" is keyed on a timestamp a **pending**
job does not have. The rule does not delete those rows late; it never selects them at all.

That matters more than the storage it implies, because `MaxPendingJobs` counts pending jobs and
refuses the fourth. Three uploads somebody opened and walked away from would block every later
import, citing jobs they have long forgotten. There is a way out — the review screen has a Cancel
button and `/import` lists unfinished jobs to resume — so it is a dead end rather than a locked
door, but it is one nobody would expect to find themselves in.

So retention is two rules:

| Job | Deleted | Measured from | Why this length |
|---|---|---|---|
| `done`, `cancelled` | **7 days** | `CompletedAt` | A receipt, and by now the whole of that import: which file, when, how many went in, how many were passed over. Nothing in it is anyone's only copy — the uploaded file was never stored and the games are in their lists |
| `pending` | **14 days** | `UpdatedAt` | Unfinished work. Deleting it discards the decisions already made — resolved shelves, chosen games — which re-uploading does not give back. A fortnight respects "I will finish this at the weekend" while still freeing the slot on a human timescale |

`UpdatedAt` is the last time the job's owner **saved a decision**, so the pending window is a window
of silence and not a deadline to finish by. Measured from `CreatedAt` it would delete a review on
its fourteenth day however hard somebody had been working on it, taking with it the decisions the
row above promises to protect — the exact failure the longer window exists to prevent. Reading the
review does not move it: a `GET` that writes is its own problem, and a job left open in a background
tab would then never expire at all.

Which window applies is decided by `CompletedAt`, not by `State`: the first is the fact that a job
is over, the second says only how it ended. `MaxPendingJobs` counts from the same column, so the cap
and the sweep free and count the same jobs — and a `CK_ImportJobs_Completion` check constraint keeps
the two columns agreeing, so a state that is neither `pending` nor terminal cannot quietly become a
job that holds a slot for ever. Adding such a state stays additive and free; adding a new *terminal*
one is the case that needs a migration.

The pending window **must** be the longer of the two. Swapping them would delete reviews in progress
while keeping receipts nobody reads, so it is asserted by a test rather than left to reading.

**The user is told.** Every `ImportJobDto` carries an `expiresAt` computed from these windows, so
`/import` says when each job goes and the review screen says what keeps an unfinished one alive.
The date is computed on the server on purpose: the windows are a server decision, and a copy of the
two numbers in the client would drift — the one place that would show is a screen promising somebody
their part-finished work is safe for longer than it is. A job that is already gone answers 404, and
the review screen treats that as the end of the job rather than as something to retry.

Both are deleted by a scheduled sweep rather than on access, because nobody requests a deletion:
the user whose rows they are has by construction stopped interacting with them. That is the
application's only background job, and ADR
[0038](../docs/decisions/0038-where-scheduled-work-lives.md) records what it owes a fleet running
several copies of itself.

## 6. Client work

| ID | Item |
|---|---|
| C1 | `/import` route — source picker with a short "how to get your file out of X" per service, plus a drop zone |
| C2 | Column mapping table — our field, their column, a live preview of the first three values |
| C3 | Review screen — virtualised list grouped into auto / ambiguous / unmatched, a bulk "accept all auto", and a per-row candidate picker with cover art |
| C4 | Progress state while matching runs, resumable — the user can close the tab and come back to the job |
| C5 | Result summary: imported, skipped, failed, with a downloadable CSV of the rows that did not import, so nothing is silently lost |
| C6 | Empty and error states in the pattern the lists page already uses (roadmap Tier 2) |

## 7. Blocked on

- **Tier 1 per-entry tracking data.** `UserGameList` today stores only `UserId`, `GameId` and
  `ListType`. Score, dates, hours and notes have nowhere to land. We could ship import before that,
  but it would discard most of what makes a Grouvee or HLTB export worth importing — and users
  import once. **Do the per-entry fields first.**
- **Full list taxonomy** (see §3.2).
- Local game-metadata cache, for M5 and M7 — desirable, not strictly blocking.

## 8. Entitlement — a note on the roadmap's pricing

The paid-tier table gates import as "one-time free / unlimited re-sync paid". That split is right,
and CSV tracker import belongs on the **free** side of it:

- It contradicts our own stated rationale to put the anti-abandonment feature behind a paywall. A
  user who has not imported has nothing in the app worth paying for yet.
- It costs almost nothing recurring — one job, then it is over. What genuinely costs money is the
  recurring platform re-sync, which is what the paid tier should sell.
- "Bring your Grouvee data" is a top-of-funnel acquisition argument. Charging for it removes the
  argument.

Proposal: CSV import free, capped at 3 jobs per account per month. Unlimited jobs and scheduled
platform re-sync stay paid. Export stays paid, as the table already has it.

## 9. Open questions

1. Do we import review text now, when the review feature itself (Tier 2, "community signal") does
   not exist? Suggested: store it on the entry as notes and surface it later.
2. ~~Backloggery rows have no year and no database id. Is a title-only match worth offering at all,
   or do we label it "best effort" in the UI and set expectations up front?~~ **Answered: yes,
   offer it.** A game with one well-followed IGDB row resolves outright from the title alone — the
   following signal in §4.1 is what makes that safe without a year. What a title alone cannot do is
   separate two well-tracked releases of one name, and those become candidate pickers rather than
   guesses, so no "best effort" disclaimer is needed: the screen shows exactly where it is unsure.
3. Should a failed match create a placeholder entry so the user does not lose the row, or is the
   downloadable failure CSV (C5) enough? Suggested: the CSV — placeholders pollute lists.
4. Do we want to be an import target for someone else — that is, should our own export (Tier 2)
   round-trip through this importer? Cheap to guarantee, worth doing.

## 10. Suggested order

1. Tier 1 per-entry fields and the full taxonomy (prerequisite, already on the roadmap)
2. S6, S7, S1, S2 — upload, parse, persist a job
3. C1, C2 and S4 — mapping UI with the Grouvee and HLTB presets
4. M1–M4 and S5 — matching, plus the review screen (C3). **Done**, except M4's inline search, and
   without S5's queue: see §4.2
5. S8 and C5 — commit and the failure report
6. Remaining presets: Backloggery, Completionator, Darkadia — data only, no new code
7. M5–M7 — batching and idempotency, once real import sizes are known

## 11. Sources

- Grouvee — https://www.grouvee.com/
- Backloggery data export (v1.1.0) — https://www.patreon.com/posts/site-update-v1-1-108426624
- Backloggd roadmap (export still unshipped) — https://backloggd.com/roadmap/
- Tracker roundup — https://blog.chordian.net/2017/06/04/backlogchecklist-web-sites-for-video-games/
- Tracker comparison — https://www.flippingheck.com/how-to-organize-your-video-game-collection-manage-your-backlog/
- VGCollect — https://vgcollect.com/
