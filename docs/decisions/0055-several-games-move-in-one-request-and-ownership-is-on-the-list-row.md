# 0055. Several games move in one request, through the single move's rule, and ownership is on the list row

**Status:** Implemented
**Amends:** [0030](0030-ownership-and-notes-belong-to-the-entry.md) §4 and §6, for ownership; extends
[0054](0054-a-hand-arranged-order-is-a-sparse-position.md) §8 to every filter

## Context

[#115](https://github.com/ChronosSF/myvideogamelist/issues/115) asked for two things on the lists page:
selecting several games and moving, removing or tagging them in one action, and a column or a filter for
ownership. Three records had narrowed it:

- [0018](0018-append-only-status-event-log.md): every status change has its event, through `ListService`,
  and a move to the status a game already holds records nothing. A bulk move is N transitions and N events.
- [0030](0030-ownership-and-notes-belong-to-the-entry.md) §4 kept ownership off the list row on purpose,
  because nothing on a list view read it, and "a field on the row is a field the list's optimistic state has
  to keep true".
- [0020](0020-list-view-preferences-in-the-database.md): sorting and filtering are the client's, over lists
  fetched whole. The issue reads the table view as the place selection lives.

Two later records bear on it as well. [0054](0054-a-hand-arranged-order-is-a-sparse-position.md) gave the
backlog a hand order that a change of list clears, and refuses to rearrange it under a filter.
[0022](0022-entry-surrogate-key-and-the-wishlist-axis.md) and the client rules set what every optimistic
change in `ListsProvider` owes: a per-game lock, an undo that touches only what it changed, and a session
stamp on everything it raises.

Tagging waits for [#135](https://github.com/ChronosSF/myvideogamelist/issues/135): there are no tags yet.
The issue left one question open, whether a bulk action is one request per game or a batch, and
`ListsProvider`'s optimistic update assumed one game per request.

## Decision

### 1. One request for the whole selection

`PATCH /api/lists` takes `{ gameIds, status }` and moves every game named to that list, or out of every list
when the status is null — the null `ImportPlayedStatusDto` already uses for "no list", and the one a null
`ToStatusId` records in the log. It is a `PATCH` of the collection the `GET` beside it reads: it changes the
status of the games it names and leaves every other game alone.

One request rather than one per game, because of what a failure leaves:

- **One transaction.** Every change and every event are in one `SaveChanges`, so a failure leaves nothing
  half done. That is 0018's "the event and the state change share one transaction", applied to the batch.
  N requests fail one at a time. An outage halfway through a selection leaves some games moved and the rest
  not, a mix nobody asked for, each with its own banner.
- **One answer.** The client is told in one place what happened to every game, so it can say so in one
  sentence and undo exactly what did not save.
- **One round trip** for a selection that can be a whole list.

### 2. The single move's rule, and one moment for the batch

`ListService.SetStatusesAsync` puts every game through `Transition`, a private method of `ListService`.
The single move and the single removal now go through the same method, so a batch can never drift from
them:

- an event for each change;
- none for a game already where it was asked to be;
- the hand-order place cleared by a change of list (0054 §1).

Every change and every event in a batch share one moment, read once. Games a batch brings into a list
therefore arrive together. They are told apart by title, on the server as on the client, whose optimistic
copy stamps them with one time too. A game named twice is moved once. The single paths read the clock once
too now, so an event and the change it records never differ by the microsecond between two reads.

### 3. Acts on the user's own games, creates none, and says what it did to each

A single move creates the entry if there is none (0019). The batch does not. The selection it serves is
made of games in the user's lists, and find-or-create is not a path that should create ten thousand rows in
one request. The read is scoped to the user in its own predicate, so an id that is another account's game
looks like a game with no entry.

It answers `200` with an outcome per game, in the order the games were first named:

| Outcome | Meaning |
|---|---|
| `moved` | It was not where it was asked to be, and now is. One event. |
| `unchanged` | It already was: in that list, or, for a removal, in no list (with or without an entry). Nothing recorded. |
| `missing` | The user has no entry for it, so a move did not happen. Never the answer to a removal. |

`missing` is the honest "partial failure" a single transaction can still have. The usual case is a game
deleted from another tab since this one loaded. "Delete my data" can also land in the moment between the
batch's read and its save. The save then finds the row gone, and the whole save is rolled back. The game is
answered as though it had no entry, `missing` for a move and `unchanged` for a removal, and its event is
dropped with it. The rest are saved again, up to three attempts, which is `HandOrderStore`'s answer to the
same race rather than a 500.

Only a conflict made of entries is treated as a row gone missing. One that named an event would be rethrown,
because dropping an event while saving its entry's change is the status change without an event that 0018
forbids. PostgreSQL cannot produce one today. Anything else that fails the save is not caught, and nothing
has moved.

### 4. The request's bounds

- **Both fields are required in the body.** `SetStatusesDto` is a property record so that both can carry C#'s
  `required`, which `System.Text.Json` enforces. A client that leaves out the status gets a 400, rather than
  every game it named taken out of its list.
- **The ids.** One to 10,000 of them (`ListBatch.MaxGames`, the number `HandOrder.MaxWrites` already uses).
  An id below one is refused as a 400, and a `null` among them fails as the body is read.
- **The size.** The body is held to a megabyte before it is read, as the position writes are.

The client restates the bound as `MAX_BULK_GAMES` and refuses past it before anything moves. A test on each
side pins its number. That is far past any list a person keeps, so selecting every game in one is never
refused.

### 5. The optimistic update: one change, and an undo by each game's own row

`ListsProvider.moveGames` and `removeGames` follow the provider's rules for many games at a time.

- **Locks.** Every game takes its per-game lock. The action is refused, changing nothing, while any of them
  has a write out. That is how a hand-order move behaves (0054 §5), rather than queueing behind the write.
- **The change.** It is shown at once through `MOVE_ENTRIES`, one pass over each list for the whole
  selection. So are the undo and a reload that lands while games are held. A pass per game would be
  quadratic in a selection that can be a whole list. Each game is carried across whole, with its score and
  its ownership. Its hand-order place is not carried, since the server clears it.
- **The undo.** It is the same action, built from each game's own row, captured under its lock. It puts
  back exactly the games it names, each in the list it came from with the row it had there. That row
  includes its hand-order place, a value the lock kept true. A change to another game that saved meanwhile
  survives it.
- **A request refused or never arrived** puts every game back, because the server saved none of them.
- **A game answered `missing`** is left in no list rather than put back. That is where the server has it,
  and putting it back would show a game the account no longer has. The banner says how many did not move,
  and why.
- **A `200` whose body cannot be read, or is not the shape it should be,** leaves every game where it was
  sent. So do a game the answer leaves out and an outcome the client does not know. The status says the
  batch was saved, and only `missing` takes a game out of the lists.

Every action is session-stamped, and a reload that lands mid-batch keeps the batch, as one does a move.

### 6. Selection, in the table, belongs to one account's one list

- **The table view only.** Each row has a checkbox, and the header has one that selects every row drawn:
  every game the filters leave showing, and no other.
- **Page state, stamped with the account and the list.** It is read through that stamp rather than cleared
  from an effect, so a sign-in or a change of tab never acts on games somebody else ticked. That is the
  provider's account scope, applied to page state. What an action out is doing, what it said and why it fell
  short are stamped the same way, so the next account is never shown the previous one's action.
- **What acts on what.** An action acts on what is both ticked and drawn. A change of filter lets go of
  whatever it stops drawing, so a hidden game is never moved unseen. Going back to the tiles lets the
  selection go.
- **After an action.** A game that saved has left the list and is let go. One put back after a failure stays
  selected, so trying again is one press. A game whose move is still out has left the list for the moment.
  Neither a change of filter nor the header lets go of it, so a failure brings it back still ticked.

### 7. The bar

**Always drawn while the table is, and one height in every state.**
- With nothing selected it says how to use it. Drawn only with a selection, it would push the rows down
  under the pointer the moment a first box is ticked.
- It is one row at every width, its actions scrolling sideways when they do not fit, rather than wrapping.
  On a phone it is two rows: the count, then the actions. Only the removal question and the sentence saying
  why an action fell short may wrap, while somebody is reading them. The rows' and the header's controls keep a scroll margin that clears the navbar
  and the bar, so the keyboard never lands on one hidden beneath them.
- It is sticky under the navbar, so it is in reach anywhere in a long list. It steps out of the way during a
  drag in the hand order, which scrolls the window from near its top.
- It comes before the table in the page, so the keyboard reaches it from the toolbar rather than after every
  row's controls. Its controls are drawn in the order the keyboard reaches them, Clear last, at every width.

**What it offers.**
- **Moves.** The other four lists are buttons, by their owner's names, in a group named "Move the selected
  games to". Each button also carries "Move to" in its own name, because iOS VoiceOver does not speak a
  group's name. A `<select>` that acts on change would fire on every arrow key in some browsers. A select with
  a separate Move button is two controls for one choice.
- **Removal asks first**, in place of the button that asked. Focus goes to Cancel, so that a held Enter's
  repeat lands on the harmless answer. Cancel or Escape puts focus back on the button.
- **When an action falls short**, the bar says why in place of the count, as well as in the page's banner.
  The banner is at the top, out of sight deep in a long list.

**Focus and what is said.**
- Focus goes to the bar before an action's button goes with its games. An action that takes every row shown
  takes the table and the bar with it, so focus goes straight to the list's tab instead. Moving it a second
  time, after the announcement, could cut that off. Clear sends focus to the bar too.
- A polite live region says how many are selected and what an action did. It is emptied on a change of tab
  or layout, so the next announcement is heard even when its words are the same. A failure is left to the
  page's banner, which already says it assertively.

The toolbar's filters share `ListFilterMenu`, the platform filter's panel given a second use. Escape closes
it with focus back on its button, and its checkboxes are a group named by its heading.

### 8. Ownership on the list row, and kept true

**On the row.**
- `ListEntryDto.Ownership` carries it, which amends 0030 §4. The notes stay off the row, for 0030's reason:
  fifty rows of them are payload nobody on the lists page reads.
- The single-entry read takes ownership from the entry now, instead of a second copy beside it, so the game
  page's panel reads `entry.ownership`.
- It is private like everything else on the row. Only the owner's own reads carry a `ListEntryDto`, and a
  test walks every action reachable without signing in and fails on any type they answer with that carries
  a list row, an ownership or notes.

**Kept true.**
- **`setOwnership` now changes the row as well**, which amends 0030 §6. The change is shown at once and put
  back if the save fails, under the game's lock and session-stamped, as a score is. A game in no list has no
  row, and the panel's own copy is all there is to change.
- **A game coming back from no list.** The client dropped its row when the game left every list, and the
  row it builds on the way back could only guess at the score, the ownership and when the game was first
  added. The entry kept all three (0019). So the single move, `PUT /api/lists/{gameId}`, answers `200` with
  the entry's own fields (`EntryStateDto`), and the client puts them in the row while it still holds the
  game's lock. The score and the first-added date had the same gap before this change. The ownership filter
  is what made it visible.

**The column** is not a sort. 0020 made the sort keys API contract, stored as strings and checked by
`[AllowedValues]`. Narrowing to what somebody has is the filter's job.

**The filter** sits beside the platforms.
- It offers the choices present across the user's lists, "Not recorded" included, once there are two of
  them. It narrows only by choices still offered, and by nothing while it is not offered. Otherwise a bulk
  removal of the last game of a kind would leave the filter hiding every game behind a menu that no longer
  lists that kind.
- It is transient, and says so, as the platform filter is (0020).
- Either filter stops the backlog's hand order from being rearranged. That is 0054 §8's reason, which holds
  for any filter.

### Not here

- **Tagging several games at once.** It waits for tags (#135), and is a line on that issue.
- **Selection in the tiles view.** A cover grid has no row to tick, and the issue put selection in the table.
- **Range selection** with Shift. The issue did not ask for it.
- **Sorting by ownership.** It would be a new sort key, for the reason in §8.

### Rejected

- **One request per game**, reusing `addToList` and `removeFromList` unchanged. See §1. It would also need
  a page-level tally of N results to say anything in one sentence.
- **Creating entries, as a single move does.** See §3. A move of a game deleted elsewhere would bring back a
  row the user had just deleted.
- **Rolling a `missing` game back to the list it came from.** See §5. That would show a game the server does
  not have.
- **`207 Multi-Status`.** It is WebDAV's. A `200` with an outcome per game says the same plainly.
- **A modal confirmation dialog.** The inline question is the pattern the game page's "delete my data"
  already uses, and it needs no focus trap.

## Consequences

**Checked against PostgreSQL**, on a copy of the local database, signed in as a test account in the browser:

- **A move.** Two games moved from Playing to On Hold with one request. Each had a `playing → on_hold` event,
  and both events and both `StatusChangedAt` were the same instant.
- **A removal.** Two were taken out of On Hold after the confirmation, by keyboard alone. Both entries
  survived with their status cleared, and two departures were recorded.
- **An outage.** With the API stopped, a move put both games back, still selected, with the banner. Moved
  again once the API was back, it saved and the banner cleared.
- **A game deleted elsewhere.** A game was deleted through the API around the page, as another tab would.
  Moving it with another, the batch answered it `missing`, created nothing and recorded nothing for it. The
  other game moved with its event, and the page said "1 of the 2 games was not moved".
- **The hand order.** A placed game moved out of the backlog lost its place. Moved back with another game,
  both arrived unplaced at the end, with one `StatusChangedAt`, in title order. A reload drew the same order.
- **Ownership.** Chosen on a game page, it showed in the table on returning without a reload. The ownership
  filter appeared once there were two kinds, and it stopped the hand order being rearranged.

**A row deleted between the read and the save is checked on every run** of the integration suite
([0057](0057-the-api-is-tested-over-a-real-postgresql.md)), in `ListFlowTests`. It deletes the row through a
second connection at exactly that moment. The first save finds it gone and is rolled back whole, and the
retry saves the other two. The answer is `moved, missing, moved`, and exactly two moves are recorded: none for
the deleted game, and none twice. A harness in a scratch project showed the same before the suite existed;
the test is the line [#104](https://github.com/ChronosSF/myvideogamelist/issues/104) left open for it.

**What the in-memory tests cannot see.** The in-memory provider is not transactional. It applies a save's
event inserts before it reaches the update that fails, and keeps them. So the deleted-row tests raise the
concurrency failure from an interceptor, before the provider writes anything, which is what PostgreSQL's
rolled-back transaction amounts to. The real retry is the integration suite's to show, above.

**Inherited, not new.** EF writes the entry by key, with no concurrency token. So a move landing between
this batch's read of a game and its save leaves the batch's event with a stale `from`, exactly as two single
moves would. Every event in a batch shares one `OccurredAt`, as the import's rows share one timestamp.

**The batch makes the event log's growth cheap.** One request appends up to 10,000 rows to a log nothing
prunes, where a single move appends one. A signed-in account could grow it quickly by moving the same games
back and forth. [0033](0033-what-the-api-refuses.md) puts volume control at the edge, in a WAF that is not
built yet. That item on [#109](https://github.com/ChronosSF/myvideogamelist/issues/109) now says it has to
weigh writes, not only requests. A per-account write budget is the likelier limit, rather than a limiter
here: the rate limiter runs before authentication, so it cannot be partitioned by account.

**Not verified.**
- An actual screen reader: the announcements were read from the live region's text, not heard.
- Firefox and Safari, including whether they honour the scroll margins for focus.
- Touch on a real phone. The phone layout was checked at 375px in Chromium.
