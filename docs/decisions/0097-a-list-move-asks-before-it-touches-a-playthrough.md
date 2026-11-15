# 0097. A list move asks before it touches a playthrough, and only the reader's yes writes one

**Status:** Implemented. [#480](https://github.com/ChronosSF/myvideogamelist/pull/480), closing #222. Keeps
[0025](0025-playthroughs-and-reviews.md) §4 whole: a move still writes no run, and a run still writes no
status and no event. Amends 0025's closing remark that nothing marks a run as current, and the last
consequence of [0084](0084-the-readers-controls-in-the-hero-everything-else-in-tabs.md).

## Context

[0084](0084-the-readers-controls-in-the-hero-everything-else-in-tabs.md) put the reader's playthroughs on a
tab of their own, Your game, and left the list, the score, the wishlist and the favourite in the hero. That
made runs easy to miss. Nothing linked the two acts either: moving a game to Playing started nothing, and
moving it to Finished finished nothing, so every run was logged by hand, on another tab, from a form most
readers never opened.

#222 asked two things of a move. Its body asked whether a move to Playing should start a run by itself,
inside `ListService`, so that a move from anywhere would; a later comment asked for a prompt after a move
instead, offering the change the move implied. The owner's UX pass on 15 November 2026 settled it with
mock-ups: **a move never writes a run by itself. A toast asks, and the reader says yes or lets it go.** This
record says why it asks only twice, whose day it names, how the yes is kept from writing twice, and why the
form opens where the reader is.

Two constraints were already fixed. 0025 §4: a playthrough writes no status and no event, and status changes
go through `ListService` alone. And the lists page holds nobody's runs: a list row is a `ListEntryDto`, and
the runs come only with the single-entry read the game page makes.

## Decision

### 1. Two moves ask, and nothing else does

| The move | The game's runs | What happens |
|---|---|---|
| To Playing | No unfinished run | The toast asks "Start a playthrough today?" |
| To Playing | An unfinished run | Nothing. The run carries on |
| To Finished | An unfinished run | The toast asks "Finish your playthrough today?" |
| To Finished | No unfinished run | Nothing |
| To Dropped, On Hold or Backlog | Any | Nothing |
| To the list it is already in | Any | Nothing, as 0018 says of the event |

An unfinished run is one with no finish date, and nothing more: a run has no outcome of its own. So a move
that ends play some other way has nothing true to write. **Dropped and On Hold cannot end a run**, because the
only ending a run can carry is a finish date, and [0047](0047-a-playthroughs-dates-count-and-a-status-change-comes-first.md)
counts a finish date as a finish for any game with no move to Finished, which a dropped game has not got. A run
"closed" on a drop would put that game in the finished chart. Leaving the run open is the truthful record: the
game was put down mid-run, and a later move back to Playing carries that run on, unasked.

**Finished with nothing unfinished asks nothing.** Asking to start and finish a run on the same day would make
up a run for every game somebody adds to Finished, and a reader entering a library of old games one by one
would be asked about each, about a run they did not play that day. A game added straight into Playing is
asked, being the same move as any other to Playing; a game with only finished runs moved back to Playing is a
replay and is asked too.

**A run whose start date is after the reader's today is not asked about**, because it cannot finish before it
started: the database refuses the date order (`CK_UserGamePlaythroughs_Dates_Order`) and the toast could only
fail. The reader puts that run right on the Your game tab, where the form shows both dates.

The client decides, from the move's answer and the reader's day (`askFor` in `@/lib/playthroughPrompt`), since
only the browser knows that day (§3).

### 2. The move's answer says whether it moved and which run is unfinished

`PUT /api/lists/{gameId}` used to answer 204. It now answers a `ListMoveDto`: `moved`, and the game's
unfinished playthrough as the move leaves it, its id and its start date. One round trip, because the lists
page has no runs to ask from, and a read after the move would be a second request racing the first's answer.

**`moved` is the server's word.** A tab that showed the game in the Backlog after another tab had moved it to
Playing sends a move that changes nothing, records no event, and is asked nothing. The client's own idea of
where the game was is not consulted.

**`ListService` reads runs to answer and writes none.** 0025 §4 stands in both directions. Which run is meant
is one rule in one place, `UnfinishedPlaythroughs`, which the move and the start both read: with several
unfinished, the one started most recently; where none says when it started, the one logged most recently; a
dated run before an undated one, since a date is what the question shows. Runs logged by hand can overlap, and
nothing forbids it.

A client from before this ignores the body. A client from after it asks nothing of a 204, so a page served
by a new SSR task against an API still mid-deploy simply does not ask.

### 3. Today is the reader's own calendar day, read once

The toast names the day — "Sunday 15 November 2026" — and a yes sends that day, not one read again when the
button is pressed or the request retried. The day is the browser's local date when the move is saved
(`localToday`), because a playthrough's dates are calendar days the reader would write
([0025](0025-playthroughs-and-reviews.md) §5), and the server's UTC day is the wrong one for anybody far from
Greenwich: a move at one in the morning in UTC+3 is still the previous day in UTC.

The server takes the day as sent and checks nothing of it against its own clock. The form already lets anyone
type any day, and the endpoints' guard (§4) is about which run, not when.

### 4. A yes is guarded where it is written, under the entry's lock

Two endpoints are the yes, both `PlaythroughService`'s:

- `POST /api/entries/{gameId}/playthroughs/start` `{ startedOn }` starts an untyped run on that day — **unless
  the game already has an unfinished run**, a 409.
- `POST /api/entries/{gameId}/playthroughs/{id}/finish` `{ finishedOn }` puts the day on that run — **only while
  it is unfinished**, a 409 otherwise, **never before its start**, a 409, and a 404 for a run that is not this
  reader's for this game.

A yes can arrive late: after the game moved again, after another tab answered first, after the reader logged a
run by hand. The server decides then, and this path never makes a second unfinished run. Both run in a
transaction that first takes the game's entry row with `SELECT … FOR UPDATE`, the row every run of the game
hangs off. PostgreSQL blocks another transaction's `FOR UPDATE` of that row until this one ends (PostgreSQL 18
documentation, §13.3.2), and at Read Committed every statement after the wait reads a snapshot taken when it
starts (§13.2.1), so the second request's check finds the first one's committed run.
`PlaythroughStartFlowTests` holds the entry from a session of its own, commits a run there while a start waits,
and sees the start refuse; and sends six starts at once and sees one run. With the lock taken out, both tests
fail.

**The form's own writes take the same lock**, though they check nothing, because a start and a finish do: a
run logged by hand landing between a start's check and its commit would leave two unfinished, and an edit
putting a finish date on a run between a finish's read and its write would be written over. Only the import's
commit writes runs without it, all at once and from a file.

**A guard and not a unique index**, because a partial index on unfinished runs per entry would refuse the
overlapping runs a reader may log by hand, and the import may write. An entry that does not exist yet has no
row to lock; two starts at once then both create it, the unique index over `(UserId, GameId)` refuses the
second entry and its run with it, and there is still one run. That takes a game whose data was deleted between
the move and the yes.

Neither endpoint writes an event or a status, and the in-memory provider, which has no row locks, runs every
decision in the unit tests while the integration suite runs the lock.

### 5. The toast asks once the move is saved, one at a time, and never takes focus

`ListsProvider.addToList`, which every move goes through, tells a store of saved moves about each one once its
answer is committed: never the optimistic step, never a move rolled back. `PlaythroughPromptProvider`, mounted
once in the root inside `ListsProvider`, listens and asks. Its state follows `ListsProvider`'s shape
([0022](0022-entry-surrogate-key-and-the-wishlist-axis.md) §8): the account in the reducer, the account's change
applied during render, every completion stamped with the account it began under and dropped when that has
changed, so a yes still out when somebody else signs in puts nothing on their screen.

**One toast at a time.** A newer move's question replaces the one up. A newer move of the same game that asks
nothing takes a question still unanswered away, since it is stale; a move of another game that asks nothing
leaves it. Once a yes has gone out, what the toast says is a report of it, and stays.

**After a yes the same toast confirms**, with one button: "Add details" after a start, "Add your hours" after a
finish. A refusal says plainly that nothing changed and why — a run already under way, or the run gone or
changed — and the game page reads its runs again. Any other failure is an alert, with "Try again", which sends
the day that was shown.

**It is fixed at the bottom of the window**, so it shifts nothing on the page, and drawn only after hydration,
so nothing of it is in the server render. It never takes focus as it appears: the question is announced
politely, a failure as an alert, from two live regions drawn empty after hydration so that a question put in
them is announced. F8 takes focus to it from anywhere, which the announcement says; Escape inside it closes it;
its timer stops while it is hovered or focused; and closing it with focus inside puts focus back where it came
from. The yes and "Not now" keep their elements from the question to its failure and are `aria-disabled` while
saving, since a disabled button drops its focus.

### 6. The form opens in place, in a popup, on the run the yes wrote

The confirmation's button opens the existing playthrough form in a native modal `<dialog>`, as the site's
other dialogs are, on the lists page, a card or the game page alike, and on a phone as a sheet across the
bottom. No navigation: the reader moved a game from wherever they were and should stay there, and the Your game
tab is a page of its own. No second toast: one at a time is the rule.

0084 set a dialog aside for the reader's record of a game, because a long review is one stray Escape from lost.
A playthrough form is short, and the popup does not close on a press outside it, so what is typed is not lost
to a stray tap on the scrim. It is the Your game tab's own form, with its fields in the same order, Platform
first; the mock-up's Hours first would read oddly on the tab, where a run being logged is as often one just
begun, so instead the popup focuses Hours after a finish, which is what it was opened to add.

The popup's form and styles are loaded only after a yes, and fetched as the confirmation appears. They are
loaded by hand rather than through `React.lazy`, which throws a failed load while rendering: from the root that
is the root's error boundary, and a tab open across a deploy would lose the whole page to a missing chunk. A
failure here is the confirmation's to say, and the run it reports is saved either way. The prompt
tells the game page about every run it writes, so the Your game tab's list and the hero's "1 playthrough" are
right without a reload.

### 7. A yes counts nothing twice

The activity figures already count a run's dates only for a game whose status changes say nothing of that kind
(0047 §1), and a yes always follows a move that recorded one. So a start from the toast adds no second start,
and a finish adds no second finish, even when the reader's day and the move's UTC month differ at midnight;
`GetStatsAsync_ARunStartedAndFinishedByYesToTheMovesQuestions_CountsEachActOnce` pins it. The owner's history
lists the run's dates beside the moves, as it lists every run's ([0062](0062-the-history-is-three-rows-unioned-and-what-has-no-moment-has-no-item.md)
§5), which is a record and not a count.

## Consequences

- **Every page carries the toast's code.** Measured on the production build of 2026-11-15, the root's static
  imports grew from 464.0 kB to 480.3 kB, 5.7 kB more once gzipped, against the 600 KiB script limit in
  `lighthouse/budgets.ts`. The popup and its form are not part of it.
- **The wording and the timings are provisional**, and all in `@/lib/playthroughPrompt`: twelve seconds for a
  question, a failure or a refusal, seven for the confirmation.
- **A run left unfinished by a drop stays unfinished.** Moved back to Playing, it carries on unasked; moved to
  Finished, it is asked about. Nothing asks the reader to close it on a drop, by §1's argument.
- **Nothing stores which run is current.** 0025 closed by leaving any notion of a current run out, because the
  status list already says what someone is playing. That stands: the unfinished run is worked out when a move
  asks, from the dates, and nothing keeps it.
- **The import still writes runs from the file alone** ([0037](0037-a-tracker-import-carries-history.md)), and
  asks nothing: it does not go through `addToList`.
- **A new path that moves a game** asks only if it goes through `ListsProvider.addToList`, which every move on
  the client does today.
