# Spec — Import lists from other game trackers (CSV)

Status: **draft, not started**
Relates to: `ROADMAP.md` Tier 2 "Import from Steam / PSN / Xbox / GOG" (line 57) and the
paid-tier table row "Import from Steam/PSN/Xbox" (line 187).

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

The mapper is a morning's work. Matching titles to IGDB ids is the feature.

| ID | Requirement |
|---|---|
| M1 | Match on normalised title plus release year. Normalisation: lowercase, strip punctuation and leading articles, fold roman numerals, drop edition suffixes ("Game of the Year Edition", "Remastered", trademark symbols) |
| M2 | Confidence tiers: **auto** (exact normalised title, single candidate, year within ±1), **ambiguous** (several candidates, or a fuzzy hit), **none** |
| M3 | Only auto rows are pre-checked on the review screen. Ambiguous rows show up to 5 candidates with cover art, year and platforms so the user resolves in one click |
| M4 | The user can search IGDB inline for any unmatched row, and can skip a row entirely |
| M5 | Batch the IGDB calls. A 500-row import must not be 500 round trips — group by normalised title, use a multi-query, and cache within the job |
| M6 | Respect IGDB rate limits. Matching runs as a background job, never inside the request that uploads the file |
| M7 | Persist the resolved match so re-importing the same file is idempotent and the second run is instant |

M5 and M7 get much cheaper once the roadmap's "no local cache of game metadata" issue (§1 item 2)
is addressed. Import is a good forcing function for that cache.

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
| S9 | Jobs and their rows are deleted 7 days after completion. The uploaded file itself is never persisted beyond the job |

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
2. Backloggery rows have no year and no database id. Is a title-only match worth offering at all,
   or do we label it "best effort" in the UI and set expectations up front?
3. Should a failed match create a placeholder entry so the user does not lose the row, or is the
   downloadable failure CSV (C5) enough? Suggested: the CSV — placeholders pollute lists.
4. Do we want to be an import target for someone else — that is, should our own export (Tier 2)
   round-trip through this importer? Cheap to guarantee, worth doing.

## 10. Suggested order

1. Tier 1 per-entry fields and the full taxonomy (prerequisite, already on the roadmap)
2. S6, S7, S1, S2 — upload, parse, persist a job
3. C1, C2 and S4 — mapping UI with the Grouvee and HLTB presets
4. M1–M4 and S5 — matching, plus the review screen (C3)
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
