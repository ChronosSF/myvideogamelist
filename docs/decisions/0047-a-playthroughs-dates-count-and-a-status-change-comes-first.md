# 0047. A playthrough's dates count in the activity figures, and a status change comes first

**Status:** Implemented
**Amends:** [0026](0026-a-library-import-records-ownership-not-history.md) §3, and
[0023](0023-profile-statistics-derived-at-read-time.md) §4 on where the chart starts and what it counts

## Context

[0026](0026-a-library-import-records-ownership-not-history.md) §3 split the statistics by what each
section reads, and put the activity section — the monthly chart, the finishing streaks, the median
time to finish — on the event log alone. Its table said that section leaves imported games out, and
the argument was sound for what it was about: an imported *status* is a true statement about what
somebody holds and would be a false one about what they did this month. Steam, which that record
was written against, carries no dates that could say otherwise.

[0037](0037-a-tracker-import-carries-history.md) changed what an import carries. A tracker export
has a play log, and its decision 4 imports it: a run with `date_started`, `date_finished` and
`seconds_played` becomes a `UserGamePlaythrough` with those dates. Its decision 5 still writes no
events, rightly — Grouvee records a shelf and its dates, never a transition, and a synthesised event
would be permanent fabricated history in the one table no migration can reconstruct
([0018](0018-append-only-status-event-log.md)).

So the dates were in the database and nothing read them. `StatsService.BuildActivity` returned an
empty section for anybody with no events, and the home page's *finished this year* is summed from
that section's months. The owner's own account shows the cost exactly: 608 entries imported from
Grouvee, 606 of them in Finished, 168 playthroughs of which 158 carry a finish date, and not one
status change. Fifteen games were finished in 2026 by those dates; the home page said 0, and the
profile said *No status changes recorded yet.*

What 0026 §3 protected was never the event log's monopoly on dates. It was that nothing invents
history. A playthrough's finish date is not inferred by us from a shelf — it is a date its owner
wrote down, here or in another tracker — and reading it is reading their record rather than writing
one for them.

## Decision

### 1. Per game and per kind of act, a status change takes precedence

| Figure | A game with a status change of that kind | Any other game |
|---|---|---|
| Finished, per month | its moves to a `CountsAsCompletion` status, as before | its playthroughs' `FinishedOn` |
| Started, the first time only | its first move to an `IsStarted` status, as before | its earliest playthrough date |
| Dropped | its moves to Dropped | nothing — a playthrough cannot say so |
| Streaks | over every finish month above, from either column | |

The event log is this app's own tracking, and after an import it is the record. So a game with a
move to Finished counts its finishes from those moves alone, and its playthroughs' finish dates are
not consulted — not counted beside the events, and not used to fill a month the events left empty.
Starts likewise. A game still counts at most once per month, whichever source it came from.

**Precedence rather than a union, because the common overlap is one act recorded twice.** Somebody
who finishes a game here usually does both: logs the run with its finish date, and moves the game to
Finished. Counted from both, one finish becomes two whenever the two dates straddle a month — the run
dated the 30th, the move made on the 2nd — and a streak appears out of nothing. Counting a game once
per month absorbs the overlap only when both fall in the same month; precedence absorbs the rest.

**Per game rather than per playthrough, because nothing links the two.** An event carries the game
and holds no key to the entry or to a run (0018), so "this move to Finished is that run's finish"
cannot be established — only ruled out, by never counting both for one game.

**Per kind rather than per game as a whole.** A move to Playing says when a game was started and
nothing about whether it was ever finished, so a game with a start event and no finish event still
counts the finish dates on its playthroughs.

### 2. A run with no start date was started by the day it finished

[0023](0023-profile-statistics-derived-at-read-time.md) reads "started" as the `IsStarted` flag,
which includes Finished: a game ticked off straight from the backlog counts as started in the month
it was finished, so that nothing on a chart where the two columns sit side by side is finished in a
month it was not started in. The same reading applies to a run. Its start is its `StartedOn`, or its
`FinishedOn` where it recorded no start. That matters for real data: of the 158 games with a finish
date in the owner's import, 94 have no start date on any run — the same count 0037's table gives for
rows with a finish date and nothing else — and without this they would be finishes nobody ever
started.

Within either source that keeps 0023's promise. Across the two it cannot, and this is the one place
the sources visibly disagree: an imported game moved back to Playing here, months after its imported
finish date, starts when the log says and finished when the date says, so its finish sits in a month
before its start. The precedence is the rule this record exists for, and it wins. A test pins the
case so that it stays a decision rather than a surprise.

### 3. Every playthrough, not only imported ones

The rule reads every playthrough, whatever `Origin` says. The precedence already lets our own
tracking win wherever there is any, and a finish date on a game nobody ever moved to Finished is a
real finish whether it was typed into another tracker or logged here —
[0025](0025-playthroughs-and-reviews.md) §4 makes logging a run of a game in no list a legitimate
thing to do. `Origin` marks a *status* that may have no event behind it (0026 §4). Keying a
statistic about *playing* on it would make a date its owner corrected after an import count
differently from the same date typed afresh.

Counting imported entries only would be one predicate, and is the alternative if this reading turns
out to be the wrong one.

### 4. What stays events-only

- **Drops.** Grouvee has no Dropped, and a playthrough has no outcome beyond a finish date. There is
  nothing to read.
- **The time to finish.** It is active time — time spent in Playing, with On Hold left out (0018) —
  and a playthrough's dates are the calendar span around it. Two weeks played, eight months shelved
  and three days more is nine months by the dates and three weeks by the log, which is exactly the
  figure 0018 refused. A run's minutes are a third quantity again, with a section of its own. Mixing
  either into the median would make one number average three different measurements.
- **`Transitions`.** It counts status changes, and a date is not one.
- **No event is ever synthesised**, here or anywhere else. 0026 §2 is untouched.

### 5. The chart starts at the earliest counted record

0023 started the chart at the first event, because the log was not backfilled and a bar of zero
before it would read as inactivity rather than as an absence of records. It now starts at the
earlier of two months, still capped at twelve: the first event's, which is unchanged — from then on
every status change was written down, whatever it was — and the earliest month a playthrough date is
*counted* in. Counted, because a date the precedence overrides is not on the chart, and reaching back
to it would open the chart on months of nothing with no visible reason for them.

It has to reach back. Starting at the first event whenever there is one would drop every imported
finish before it — and with them *finished this year* — the moment somebody moved a single game.

The cost is that an empty month inside the range no longer always means a quiet one. Between an old
imported date and the first status change there can be months in which nothing was recorded, and the
gaps between an import's own dates were always like that. The owner's page now says so — *a quiet
month may only be an unrecorded one* — where it used to say that months before the log are not
shown, which stopped being true.

### 6. Days and months

An event is an instant and is placed in a month by UTC (0023). A playthrough's date is a calendar day
with no time and no zone, so its month is the one it names; read as midnight UTC it lands in the same
month, which is why the two share one axis. Near midnight at the turn of a month an event can fall in
a different month from the date its owner would write for it, and that is 0023's UTC convention
rather than a disagreement between the sources.

A date in a month that has not begun is not counted. An event is stamped by our clock and cannot be
in the future. A typed date can, and would count a finish that has not happened and run a streak on
into months the chart does not show.

### 7. `LogStartedAt` stays the first status change

It is shown as *tracking games here since* on a public profile and as *N status changes recorded
since* on the owner's, and *here* is this app's own tracking. An imported date says when a game was
played somewhere else, possibly years before the account existed: *tracking here since 2015* would
be untrue. `specs/profile-statistics-tiers.md` also puts *tracking here since* in the basic tier,
published for an owner who has not paid; making it the earliest imported date would publish a new
fact there — how far back somebody's records go — in the tier meant to carry counts.

So the chart's first month and the log's start are no longer the same thing, and an account with
dates and no status change has months on its chart and a null `LogStartedAt`. The pages stop
treating the two as one. The owner's caption says where the counts come from. A public profile whose
library was imported and never moved no longer says *has not tracked anything here yet* above six
hundred games; it gives no date, because there is none to give.

### 8. The public profile publishes nothing new in kind

`PublicProfileService` copies the months and the streaks across exactly as it did, and they now
include counts from playthrough dates. Those are a count per month and the length of a run — the kind
of figure [0027](0027-usernames-and-public-profiles.md) §8 already publishes. No date, no game and no
duration crosses; the time to finish stays out, and stays events-only besides; `TrackingSince` is
unchanged.

## Consequences

**0026 §3's table now reads, for the activity section:**

| Section | Reads | Includes imported games |
|---|---|---|
| `BuildActivity` — monthly chart, streaks | events, and a playthrough's dates where a game has no status change of that kind | **Yes**, by their dates |
| `BuildActivity` — drops, median active time, transition count | events | No |

The rest of that table stands. 0023's *the chart never reaches back before the user's first event*
becomes *before the user's first record*.

**An imported finish can give way to a later status change.** A game imported as finished in March
2025, replayed and moved to Finished here in 2026, counts the 2026 finish and not the March one,
because the log has spoken about its finishes. That is the precedence doing what it is for, and the
price of never counting one finish twice.

**The owner's account, after the change**, read through `StatsService` against the local database
in a read-only session: the chart runs from November 2025 to October 2026, fifteen games finished in
2026, a five-month current streak and a longest of eight months, from 2020. `LogStartedAt` is null
and `Transitions` is 0, as they should be.

**Still five queries.** The playthrough query also reads the game id through the entry, and the two
dates. The predicate stays on the playthrough's own `UserId`, and the composite key on
`(UserGameEntryId, UserId)` makes the join user-consistent by construction
([0025](0025-playthroughs-and-reviews.md) §3); PostgreSQL is sent a join on both columns.

**Anything later that reads activity inherits this.** The yearly recap (#136) is this aggregation over
a fixed window and should take the same rule rather than restate it.

**What it leaves.** A dropped game is still not recoverable from an import. A time to finish built
from playthroughs would be a different metric under a different name, if anybody wants one.
