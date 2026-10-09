# 0049. An imported run takes its type from the source's completion level

**Status:** Implemented
**Amends:** [0037](0037-a-tracker-import-carries-history.md), decision 4

## Context

[0037](0037-a-tracker-import-carries-history.md) decision 4 imports a Grouvee run's dates, hours and
platform, and leaves its type null. Its reason was that `level_of_completion` is a default rather than
a statement: it reads `"Main Story"` on 596 of 608 rows, including all 448 that carry no date and no
hours.

That evidence is about rows the import never turns into runs. The same decision already drops a row
with no dates and no duration, so the 448 rows that showed the default never become playthroughs.
What the import does write is the 161 runs that carry a date or a duration, and on those the field
looks like a statement:

| `level_of_completion` | Runs, first export | Runs, second export |
|---|---|---|
| `"Main Story"` | 148 | 149 |
| `"Main Story + Extras"` | 3 | 3 |
| `"100% Completion"` | — | 1 |
| `null` | 10 | 8 |

The two exports are from the same account, three weeks apart. The second one exists because its owner
marked a run 100% complete so that the exact string could be seen. The owner also confirmed the rest:
main story on almost everything, extras on three games, nothing fully completed before that test. The
`null`s show that Grouvee does not write a level onto every run either. It leaves the field empty on a
run nobody gave one. The JSON and CSV forms carry the same four values.

Leaving every run untyped cost more than 0037 expected. It said a typeless run "needs no special case
anywhere". The game page called every untyped run "In progress", including the 158 with a finish date,
which [#210](https://github.com/ChronosSF/myvideogamelist/pull/210) fixes on the client. And the type
of every imported run had to be entered again by hand, one game page at a time.

0037's underlying worry still holds: a typed run with a duration counts towards the community medians,
a figure other members read. One uncertainty remains. The export cannot tell a `"Main Story"` someone
chose from one they left as it was offered. Between the two exports, one run gained `"Main Story"`
when it was finished, and the file does not say which of those it was.

## Decision

**The source translates its completion level into our type, without asking.** It is the same kind of
translation the preset already makes for shelves and ratings.

| Grouvee | Ours |
|---|---|
| `"Main Story"` | `normally` |
| `"Main Story + Extras"` | `normally` |
| `"100% Completion"` | `completionist` |
| `null`, or anything else | none |

- **Coarser than a one-to-one mapping, on purpose.** Our `rushed` is "straight through the main
  story", IGDB's *hastily*. It is a claim about pace. Grouvee's "Main Story" says the game was
  finished, not that it was hurried, and nothing in the file says a run was quick. `normally` is the
  broad middle tier and claims the least. So no imported run is ever `rushed`. The cost is that a
  main-story-only run counts in the `normally` median and pulls it a little towards main-story times.
  The account's owner chose that over filing it as rushed.
- **Only strings seen in a real export are mapped.** Any other value leaves the run untyped. The test
  fixtures had used `"Completionist"` for Grouvee's top level, which Grouvee never writes and which
  would have matched nothing. If Grouvee adds a level later, those runs lose their type; they are not
  guessed into a median.
- **A level on its own never makes a run.** The 448 shelving rows still produce no playthrough.
- **The canonical run carries our key, never the source's word.** `ImportPlaythroughPayload.Type` holds
  one of `PlaythroughTypeKeys`, and the commit resolves it to the seeded id. Everything after the seam
  stays source-agnostic, as 0037 decision 1 requires. The next preset maps its own vocabulary in its
  own `IImportSource` and the commit does not change.

### Rejected

- **Asking once on the review screen**, in [0045](0045-an-import-asks-once-about-what-it-will-not-guess.md)'s
  shape. The question would be one checkbox, ticked by default so that a quick import is not slowed
  down. That makes it the silent mapping plus an opt-out almost nobody would use. Anybody who knows a
  run's level is wrong can fix that run on its game page. Meanwhile it would cost a field per run, a
  flag on the job, an endpoint and a control. 0045 asks because a Played game with no finish date says
  nothing about how it ended. Here the file says something, and translating what a file says is what
  the import does everywhere else.
- **A mapping table on the review screen**, one select per level. That makes the owner translate a
  vocabulary for us. It is a burden on someone who wants their list in quickly, and it settles nothing
  the fixed mapping does not.
- **`"Main Story"` as `rushed`.** It reads a level of completion as a pace, which it is not.

## Consequences

**Imported runs with a level and a duration count towards the community medians.** On the second
export that is 49 runs: 48 `normally` and 1 `completionist`. The four runs with minutes and no level
still count nowhere. Each tier is still hidden below `MIN_PLAYTHROUGH_SAMPLES`.

**A re-import does not retype runs that are already there.** A run is identified by its game, dates and
duration, never its type, so importing the same file again matches the untyped run from before this
change and leaves it alone rather than adding a typed copy beside it. Those runs stay untyped until
somebody edits them. With nothing live, that is development data only.

**A job uploaded before this change commits its runs untyped.** Its stored payloads have no `type`,
which reads back as null. That is what the job would have done on the day it was uploaded.

**The question 0037 left for HowLongToBeat is answered.** `specs/csv-list-import.md` held back a typed
import until a source's completion field could be shown to be its owner's answer. Grouvee's has been,
on the rows that become runs. A later preset maps its tiers the same way, from strings seen in a real
export of it.
