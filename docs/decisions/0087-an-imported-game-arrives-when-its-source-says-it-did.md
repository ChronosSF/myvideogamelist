# 0087. An imported game arrives when its source says it did

**Status:** Implemented. It amends [0026](0026-a-library-import-records-ownership-not-history.md) §5,
which [0037](0037-a-tracker-import-carries-history.md) decision 5 applied to Grouvee: an imported status
now takes the moment its source gives for it, and stays null only where the source gives none.

## Context

An imported list sorted by date came out in the wrong order. The owner of the Grouvee export
[0037](0037-a-tracker-import-carries-history.md) was built from imported it again, a 608-game export
from October 2026, and sorted the Finished list by date added to see the games in the order they were
finished. Two games finished in August and September 2021 sat among the first games the account ever
recorded. Three things in the file explain it, and two of them are wrong for most people who import,
not only for this one.

**`date_added_to_collection` is a day with no time.** The import made it midnight UTC. Every game
recorded on one day then ties, and the lists break a tie by title. Somebody moving to a tracker enters
their back catalogue in a few long sittings, so most of a library ties: 255 of this export's games share
one day and 141 another. Each such day comes out alphabetical. Measured against the owner's own ranking
of the shelf, 473 of the 607 Played games were out of place.

**It is the day the game first went onto any shelf, and it does not move when the game does.** The two
games were shelved on the account's first day while they were still being played, and went onto Played
six weeks later. 61 of the 607 Played games went onto Played on a later day than they entered the
collection. That is few here only because this owner put most games straight onto Played. Somebody who
uses the shelves as they are meant — Wish List or Backlog, then Playing, then Played — has most of their
finished games dated by when they first wanted them.

That second point is not a fault in the date: the game *was* first recorded then, and a game moved from
the backlog to Finished by hand on this site keeps its date added too. What answers "when did I finish
it" here is the date the game arrived in its list, `StatusChangedAt`, which the list's "Recently moved"
order sorts by. 0026 §5 kept it null on every imported status, for a reason that was right for Steam,
which cannot say when a status became true, and wrong to apply to a source that can.

**Grouvee can.** Each of a game's shelves records `date_added`, when the game went onto that shelf, to
the second. The collection's day is UTC's: shelvings after nine in the evening UTC, which were past
midnight where the export was made, still name the UTC day. Each shelf also records `order`, the game's
place in its owner's ranking of the shelf, which is what Grouvee's "Ranking: First to Last" shows.

## Decision

### 1. Date added keeps its day and takes its time from a shelf on that day

`AddedAt` is still the collection's day. Its time is the earliest shelving on that day, which is the
moment the game was first shelved. A game none of whose shelves is dated that day was moved since, and
keeps midnight: a later shelving is the shelf's moment, not the collection's.

### 2. An imported status arrives when the source says it did

When the import writes a status, `StatusChangedAt` is the moment its source gives for the game reaching
the place the status is read from: for Grouvee, that shelf's `date_added`. Playing's for Playing,
Played's for Finished, Backlog's for Backlog. Never the import's own clock: §5's reason for that stands,
and a source that gives no moment leaves it null as before.

The moment belongs to the shelf rather than to the status, and that is what lets it outlive the review
screen. The review offers a list for two kinds of row only: the played group, whose one answer is a
reading of the Played shelf ([0045](0045-an-import-asks-once-about-what-it-will-not-guess.md)), and a
shelf the preset does not know, whose list its owner names. Either way the status read is the shelf's,
and so is its moment. A game on two shelves neither of which we know has no single shelf the answer
reads, and carries no moment.

When the import moves a game its owner already has into another list, the moment becomes the source's,
or null if the source has none: the moment the entry held dated its arrival in a list it has now left.
When the import leaves the game in the list it was in, its owner's own moment stays.

### 3. The ranking is not read

Left alone, Grouvee's ranking is the order the games were shelved, which the shelf times already give.
Only somebody who reordered the shelf adds anything to it, and what they added may be when they played
the games or how good they were. Nothing in the file says which. This export's ranking is a history: it
agrees with all 159 finish dates in the file, and the shelf times disagree with it at six games, which
its owner moved by hand. Somebody else's could be "best first", and turned into dates it would be a
history nobody lived. An owner whose ranking is a history can edit the file.

### 4. What does not change

No event is written ([0026](0026-a-library-import-records-ownership-not-history.md) §2), and `Origin`
still says whether a status has one behind it. `ScoredAt` is never set by an import
([0062](0062-the-history-is-three-rows-unioned-and-what-has-no-moment-has-no-item.md)): a shelf's moment
is when a game arrived, not when it was scored. Neither the history nor the statistics read
`StatusChangedAt`. Its readers are the "Recently moved" order, the queue of games the backlog's hand order
has not placed, the Continue Playing rail and the choice of which tracked games' news is read first, and
an imported game now takes its real place in each.

## Consequences

On the export this was measured on, "Recently moved" puts six of the 607 Played games out of the order
their owner ranked them, the six they moved by hand. Date added puts 35 out of it, down from 473, and
the most games sharing one moment is 14: those moved to Played on a later day, at midnight on the day
they arrived.

`StatusChangedAt` on an entry whose `Origin` is not `manual` may now hold a moment with no event behind
it. Nothing reads it as the time of the last event, and nothing should.

A job uploaded before this carries no moment, and commits as it would have. An entry imported before
this keeps its midnight and its null: importing the same file again writes neither over an entry that
already exists in the same list, since date added is taken only by an entry the commit creates, and a
moment only by a status the commit changes. Its owner fixes it by removing the games and importing
again.

The canonical row in `specs/csv-list-import.md` §3.1 gains the two dates, so the next preset knows to
look for them.
