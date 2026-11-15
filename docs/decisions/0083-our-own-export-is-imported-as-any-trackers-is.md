# 0083. Our own export is imported as any tracker's is

**Status:** Implemented — part of #126.

## Context

The data export ([0024](0024-the-ownership-contract.md)) hands somebody everything they entered, one
section per user-owned table, as JSON. It was never read back. 0024 said so ("it does **not** give us
re-import"), the import spec left it as an open question ([§9, question
4](../../specs/csv-list-import.md)), and #126 listed "an export shape our own importer accepts" among
the paid formats. Uploading the file at `/import` was refused with a 400: Grouvee's reader was the only
source, and nothing in our export matches its fingerprint.

What made it worth doing now is a public beta on the dev environment ahead of production. The move from
that beta to production does not need it: production will open on a copy of dev's database, so every
beta account arrives whole, history and handle included. What does need it is everything that is not
that move: somebody bringing a file into a second account, putting a library back after deleting it, or
holding on to the file after closing their account. "Download my data" saved a file nothing could open.

A perfect round trip was weighed and set aside. Every section of the export would need a writer: the
event log with its timestamps, the moment a score was given and a status changed, reviews with their
visibility, tags and their links, both hand-arranged orders, list names, sort orders and the account's
settings. Most of that is a second writer of tables that have one each today, and part of it is a
history this application has so far refused to accept from a file
([0026](0026-a-library-import-records-ownership-not-history.md)). The question was what the cheap
version should keep.

## Decision

### 1. Our export is an `IImportSource`, and every import rule applies to it

`MyVideoGameListImportSource` reads the export into the same canonical rows Grouvee's reader produces
([0037](0037-a-tracker-import-carries-history.md)), and nothing after the seam knows the difference.
The canonical row is widened by one optional field, a run's platform id, and by nothing else: what it
can carry comes back, and what it cannot stays behind.

| Comes back | Stays behind |
|---|---|
| The list a game is in, or none | The event log |
| The score | When the score was given (`ScoredAt`) and when the status last changed |
| The notes, and a review's text after them | The review itself, its spoiler mark and its visibility |
| The date the game was added | Ownership |
| Wishlist and favourite marks | Their own dates (both take the row's one date) and the showcase's order |
| Each run's dates, minutes, type and platform | A run's notes |
| | The backlog's hand order, tags, list names, sort orders, the account's settings, past imports |

The source key, and so the entries' `Origin`, is `myvideogamelist`: not `manual`, although every one of
those statuses was once set by hand here, because in the importing account none of them has an event
behind it, and that is the fact the column exists to record.

### 2. A file brings no history, even one of ours

The event log is append-only and is the only record that a transition happened
([0018](0018-append-only-status-event-log.md)); its value is that the application wrote every row of it
at the moment it happened. A log assembled from an uploaded file would make that untrue for every
account that ever imported one, and nothing afterwards could tell which rows were which: `Origin` marks
an entry, not an event. Our export is a file its owner holds and can edit like any other, so 0026's rule
stays one rule: an import writes no event, stamps no `ScoredAt` ([0062](0062-the-history-is-three-rows-unioned-and-what-has-no-moment-has-no-item.md))
and no `StatusChangedAt`, whatever wrote the file. The history page and the statistics then read these
entries exactly as they read Grouvee's.

A review comes back as notes for 0037's reason: putting somebody's prose in front of other people is
not an import's decision, and on a new account it is two clicks to make it again. It is appended after
the entry's own notes, and the pair is cut to the notes column's 2,000 characters as any imported note
is, so a long review loses its end. A review can run to ten thousand, so this is a loss our own file
meets far more often than Grouvee's did, and it is said rather than discovered: the review screen marks
a row whose notes will be cut, and the cut note ends in an ellipsis, so that read later it does not look
as though its owner stopped there. The cut never falls between the two halves of a character outside
the Basic Multilingual Plane, an emoji most often, which would leave half a character UTF-8 cannot
carry; it ends one unit early instead (`ImportText`).

### 3. Nothing in the file is trusted for having come from here

Every value the database checks is checked in the reader and dropped on its own when it fails: a score
outside 1 to 10, a duration outside the run column's range, a start after the finish (the start goes, as
Grouvee's does). A status key the reader does not know is the review screen's unrecognised status,
asked about rather than guessed; a run type it does not know leaves the run untyped, because a typed run
with minutes feeds the community medians. A game id of nothing is skipped, and a game named twice is
read from its first mention. A missing date reads as none rather than as the year 1.

### 4. A row is named after its game wherever it is shown

The export names a game by its IGDB id and nothing else, deliberately (0024), and the review screen and
the failure report both show a title. The reader produces rows with an empty title, which is stored as
the file gave it, and a row is named each time it is shown: on the review, after the game the review
already reads for its cover, with that game's release year; in the failure report, after the game's
row in `CachedGames`, read directly because the report is not worth an IGDB call and the review before
it has already put the game there. A game nothing holds, or IGDB no longer has, is named `IGDB game
<id>`. It is the game the file named, never one chosen for the row since, because the name stands in
for the file's title; and a row whose game its file named offers no search (0078 §3), so the empty
title is never a search term. An empty title is allowed only beside an id.

Naming the rows at upload instead was tried and dropped. The upload makes no network call (0037), so it
could read only what the cache held at that moment, and a game it did not hold kept the stand-in for the
life of the job, beside the cover and the name the review's own read had fetched for it seconds later.
That is the common case when an export from one deployment is imported into another whose cache is
cold.

### 5. It is recognised by its first two properties, and asked first

Every export begins `"exportedAt"`, then `"account"`, and the reader claims a file whose first two
kilobytes hold both. It is asked before Grouvee's reader, whose fingerprint is the word "grouvee"
anywhere in that head: the account section, bio included, sits at the top of our file, and an export
whose bio said "moved here from Grouvee" was handed to Grouvee's reader and refused as a bad Grouvee
file.

### 6. The reader reads the exporter's own records

The sections are deserialised into `EntryExportDto`, `PlaythroughExportDto` and the rest, so a property
renamed on the export is renamed for the reader too. `ExportRoundTripTests` exports one account, imports
the document into another and exports again, and asserts both columns of the table above. What this
cannot protect is a file saved before a rename, whose old name reads as null; the export carries no
format version, and the first rename of a section the reader reads is the time to add one.

### 7. It is free

0024 §5 and [0010](0010-monetization-model.md) put "a re-importable shape" in the paid export. Reading
our own JSON back is the other half of leaving with your data, and a right that only works one way is
half a right, so it is free and stays free. What stays paid is the format on top: CSV, column selection,
a scheduled export. #126 keeps those.

## Consequences

- **The round trip is lossy, and the page says so before the upload.** `/import`, the import card and
  the data card each name what comes back and what does not.
- **A run's platform travels by id, beside the name a tracker gives.** The canonical row held only a
  name, which the commit looks for in the game's own platforms, and our export holds only the id, so
  without a field for it the platform was lost although both ends knew it. `PlatformId` is optional on
  the run and wins over the name when present. It is stored as given, as a run logged by hand is:
  `PlaythroughInputDto` checks only that it is positive, and so does the reader. Grouvee's rows, and any
  payload stored before the field, carry none and resolve by name as they did.
- **Two runs of one game with the same dates and minutes become one**, by the commit's own key for "the
  same run" — two undated runs of one game, for instance.
- **Importing your own export into the same account is not a restore.** Every game already there
  defaults to skip; one ticked takes the file's list, and its score and notes only where it has none.
- **The upload's limits apply**: five thousand rows, which here is five thousand games, and five
  megabytes of file, the sections it does not read included. The event log is most of a long-kept
  export, at about a hundred bytes an event, so the size is reached only past some forty thousand
  moves.
- **A new column on an exported entry, run or review is not imported by itself.** Like the export's own
  projections ([0024](0024-the-ownership-contract.md)), the mapping is by hand: carrying a new field back
  means a field on the canonical row, which is the decision this record declined for everything above.
