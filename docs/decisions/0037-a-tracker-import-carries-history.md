# 0037. A tracker import carries the history a platform import cannot

**Status:** Implemented

Extends [0026](0026-a-library-import-records-ownership-not-history.md), which scoped the *platform*
import. Revises `specs/csv-list-import.md`, which was written in August 2026 without a real export
in hand.

## Context

[0026](0026-a-library-import-records-ownership-not-history.md) settled what an import may write, and
settled it against Steam: ownership, one inferred status, no playthroughs, no events. Its reasoning
was not "imports are untrustworthy" but something narrower and better — **Steam does not model the
concepts we would be importing into**. `playtime_forever` records that somebody stopped, never why;
there is no completion level; there is no transition date.

A tracker export is a different document, and the difference has to be established from a real one
rather than assumed. `specs/csv-list-import.md` assumed, and a genuine 608-row Grouvee export
falsifies three of its premises.

### What the real export actually contains

Grouvee offers the same data as JSON and as CSV. Both were checked and are field-for-field
identical, including the nested cells; the CSV is the JSON with four of its columns serialised into
quoted strings.

| Spec premise | What the file shows |
|---|---|
| §4 — "Matching titles to IGDB ids **is** the feature" | **`igdb_id` is present on 606 of 608 rows.** Grouvee stores IGDB's id and exports it |
| §3 — a preset is "a column map plus a status-vocabulary map" | Four fields are **nested documents**, not scalars. `shelves` is an object keyed by shelf name; `dates` is an array of runs. No column map can express either |
| §7 — blocked on per-entry fields, the full taxonomy, and a metadata cache | **All three have shipped** — 0025 (playthroughs, reviews), 0019/0022 (the five statuses and the wishlist axis), 0035 (`CachedGames`) |

The shelf and date signals cross-tabulate cleanly, and this table is what decides the mapping:

| Shelf | Real start date | Real finish date | Real hours | Rows |
|---|---|---|---|---|
| Played | no | no | no | **448** |
| Played | no | **yes** | no | 94 |
| Played | **yes** | **yes** | **yes** | 52 |
| Played | **yes** | **yes** | no | 12 |
| Playing | **yes** | no | no | 2 |

Two traps live in those columns. Absent dates are the **string `"None"`**, not JSON null — a
`str(None)` leak from their exporter, which a naive parse turns into a date-shaped value that is not
a date. And `seconds_played` is `0` rather than absent when unrecorded, which must not become a
zero-minute playthrough: the check constraint requires at least one minute, and a zero would be a
claim nobody made.

### The completion level is a default, not a statement

`level_of_completion` reads `"Main Story"` on 596 of the 608 rows — **including all 448 that carry
no date and no hours at all**. It is what Grouvee writes into the play-log row it creates when a game
is shelved, not something the user chose. Of the twelve rows that say anything else, every one
carries a real signal.

That matters more than it looks, because [0016](0016-scores-carry-their-sample-size.md) and
[0025](0025-playthroughs-and-reviews.md) count a playthrough towards the **community median** only
when it carries both a type and a duration. Mapping `"Main Story"` to a type would take 52 genuine
durations and file them under a label their owner never picked, into a figure other members read.

## Decision

### 1. The seam is `file` to canonical rows, not a column map

The spec's instinct — one code path, presets as data — is right and is kept. Its seam is wrong.
Grouvee's export is nested, HowLongToBeat's is a flat CSV, and a column map is a special case of
the general thing rather than the general thing itself.

So the interface is `IImportSource`: given an uploaded file, produce rows in one canonical shape. A
flat CSV with a user-supplied column map is *one implementation* of that interface, and the one
every future service without a structured export will use. Grouvee is another. The canonical row,
the matching, the review screen, the commit and the failure report are shared by both and are where
the work actually is.

This keeps the spec's promise — adding Darkadia is data, not parsing logic — while not forcing a
document that is not a table to pretend to be one.

### 2. An id in the file beats a matcher, and the matcher is not on this critical path

`igdb_id` on 99.7% of rows means the Grouvee importer ships **without** M1–M4. A row carrying an id
is resolved through `IGameCacheService` — which already holds a tombstone for an id IGDB no longer
knows ([0035](0035-a-local-copy-of-what-igdb-said.md)), so a withdrawn game surfaces as unmatched
rather than as a silent failure — and the fuzzy matcher is built later, for the sources that have no
ids, against a preset that already works end to end.

That inverts the spec's "the mapper is a morning's work, matching is the feature". For the first
preset it is the reverse, and building the matcher first would have been building the hard half
against no working whole.

### 3. `Played` with no finish date is 0026's ambiguous bucket, and gets 0026's answer

| Grouvee | MVGL |
|---|---|
| shelf `Playing` | `playing` |
| shelf `Backlog` | `backlog` |
| shelf `Wish List` | the **wishlist axis**, not a status ([0022](0022-entry-surrogate-key-and-the-wishlist-axis.md)) |
| shelf `Played` **with** a real finish date | `finished` |
| shelf `Played` **without** one | **an entry with `StatusId` null** ([0019](0019-entry-survives-leaving-every-list.md)) |
| a custom shelf | unmapped — surfaced on the review screen with a dropdown, never defaulted |

Grouvee has no Finished, no Dropped and no On Hold; `Played` means "I have played this" and nothing
more. Untouched, it is precisely the bucket 0026 refused to guess at, and it gets the same answer for
the same reason — 448 of 608 rows here, which is most of a real library, exactly as 0026 predicted.

What is new is that a tracker **can** resolve part of that bucket where a platform cannot: a
user-entered finish date is a statement that the game was finished, which is a signal Steam does not
have. So 158 rows here land in Finished on evidence, and the remaining 448 stay honest.

A game a user has *dropped* is still not recoverable from this export, and is not guessed at.

### 4. Playthroughs are imported; a type is not

This is the substantive departure from 0026, and it turns on that record's own reasoning. 0026
refused playthroughs because Steam "cannot supply a type" and a timed run with an invented type
would be fabricating an answer. Grouvee supplies the dates and the duration honestly, so those are
imported: a run with `date_started`, `date_finished` and `seconds_played` is the user's own record of
playing a game, and discarding it would throw away most of what makes a tracker export worth
importing.

The **type stays null**, because the section above shows the source field is a default rather than a
statement. A typeless playthrough is an explicitly supported shape — it is what "still playing, do
not know yet" looks like — so this needs no special case anywhere, and it has exactly the right
consequence: the run appears on its owner's profile and in their own playtime figures, and
contributes nothing to a median other people read. 0026's rule is upheld rather than bent.

A row whose `seconds_played` is `0` and whose dates are all `"None"` produces **no playthrough at
all**, not an empty one.

### 5. Still no events, and `Origin` carries the preset's name

0026's argument is untouched by anything in this file. Grouvee records a shelf and the date it was
added to, which is a snapshot and not a transition log; there is no "from" endpoint anywhere in the
document. Synthesising events from it would write permanent fabricated history into the one table no
migration can reconstruct ([0018](0018-append-only-status-event-log.md)).

So the import writes no `UserGameEvents`, and `UserGameEntry.Origin` — the column 0026 specified and
which this change is the first to actually add — holds the **preset key**, `grouvee`, rather than a
generic `import`. Naming the source is what makes "undo my Grouvee import" a query, and what lets a
later reader see which importer produced a row whose shape looks odd.

`StatusChangedAt` stays null, per 0026 §5.

### 6. Both file formats are accepted

The JSON and the CSV were verified to carry identical data, so the choice is the user's and neither
is rejected. The CSV path parses the four nested columns out of their quoted cells and then joins
the JSON path; it is not a second importer. A user who clicked the other button on Grouvee's settings
page has not made a mistake worth an error message.

## Consequences

**The spec's §10 order is superseded.** It sequences the matcher before a working import because it
assumed matching was unavoidable. With ids in the file the order is: the entry's `Origin` column, the
job tables, the Grouvee source and its canonical row, the service and the commit, then the client —
and the matcher afterwards, when a preset that needs it arrives.

**`Origin` is a column on a registered table, so `UserOwnedDataTests` will not catch it.** The
manifest is keyed by entity type and `UserGameEntry` is already registered. 0026 flagged this and it
is still true: `ReadEntriesAsync` is a hand-written projection and `Origin` has to be added to it
deliberately. It is, in the same change that adds the column.

**`ImportJob` and `ImportRow` are user-owned**, so both cascade from `AspNetUsers` and both are
registered in the export manifest — and `ImportRow` carries its own `UserId` and reaches its job
through a composite foreign key, for the reason [0025](0025-playthroughs-and-reviews.md) gives for
playthroughs and reviews doing the same.

**Grouvee's platform names are IGDB's own**, verbatim — `PC (Microsoft Windows)`,
`Sega Mega Drive/Genesis`, `Nintendo Entertainment System`. That is a convenience and not a contract,
so it is used as a hint and never as a key: a name that does not resolve leaves the playthrough's
`PlatformId` null rather than failing the row.

**Review text is imported as the entry's notes, not as a `Review`.** The spec's open question 1
answered itself: Grouvee's `review` field is empty on every row of this export, and
[0030](0030-ownership-and-notes-belong-to-the-entry.md) already separates private notes from prose
written to be read. Importing somebody's text straight into a publishable surface is not a default
worth having, and `Visibility` is theirs to set afterwards.

**We inherit a dependency on a format version.** The document declares
`export_format_version: 2`; the parser reads it and refuses a major it does not know, rather than
silently mapping a renamed field to null — the same silent-empty failure class as IGDB's removed
`external_games.category`.
