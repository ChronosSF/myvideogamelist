# 0054. A hand-arranged order is a sparse position the client computes, and a change of list clears it

**Status:** Implemented

## Context

[#116](https://github.com/ChronosSF/myvideogamelist/issues/116) asked for the backlog in an order its
owner arranges by hand, "what I will play next", kept per account beside the sorts that exist. Three
records had already narrowed it. [0020](0020-list-view-preferences-in-the-database.md) keeps sort
preferences in the database and does the sorting on the client, over lists that are fetched whole.
`docs/data-model-plan.md` reserved a position on `UserGameEntries`: "sparse, per status, re-sequenced on
the client; nothing statistical reads it". [0031](0031-a-list-rename-is-a-label-its-owner-sees.md) §4
says that how a list is presented is its owner's alone, and a public profile does not show it.
[#117](https://github.com/ChronosSF/myvideogamelist/issues/117) will want the same for the favourites
showcase, so whatever is built here is built to be reused.

That still left these questions open:

- **What a position is a position in.** A game moves between lists. A number chosen between two backlog
  neighbours means nothing in Playing.
- **What "sparse" buys, and who computes the numbers.** Renumbering the whole list on every move is
  simple, but a move should rewrite few rows.
- **Where games nobody has placed go.** A backlog has hundreds of games and its owner arranges the few at
  the top. Every game added later also arrives unplaced.
- **How the write fits the provider.** The client rules require a per-game lock for every write to the
  entry, an undo that touches only what it changed, and session stamps on everything a mutation raises
  ([0022](0022-entry-surrogate-key-and-the-wishlist-axis.md)). They also say an undo restores "values,
  not a position".
- **Whether to take a drag-and-drop library**, and how the order is changed from a keyboard and
  announced to assistive technology.

## Decision

### 1. A nullable integer on the entry, and a place in the list the entry is in now

`UserGameEntries.Position`, as the plan placed it. It belongs to the list the game sits in, so **every
write that changes the status clears it**. That covers `ListService`'s moves and removals, and the
import's commit when it moves a game to another list. A move to the status a game already holds
changes nothing and keeps the place. A game that comes back to the backlog arrives unplaced, at the
end, like any other arrival. The client does the same in its optimistic move. The undo of a failed
move gives the old place back.

The column belongs to `IHandOrdered`, which is the interface #117's `UserFavourite` will implement.

### 2. Sparse, with null for never placed

Positions are handed out 1,024 apart.

- **A move between two placed games takes the midpoint** of their positions. One row is written.
- **A move before the first or after the last placed game** steps 1,024 past it. One row again.
- **A move into the unplaced games** first places every unplaced game the moved one passes. Each takes the
  next step after the last placed game, in the order shown. The moved game takes the step after them,
  and the unplaced games behind it stay unplaced. So the first move in a backlog nobody has arranged,
  pulling the next game to the top, is one row. Arranging the tenth game in a list of three hundred
  writes ten.
- **When two neighbours have no integer left between them**, a few games around the spot are spread out
  again. The window widens by one game on each side until the games just outside it leave at least 64
  between everything inside, or until it reaches either end, where there is a whole step of room per
  game. A crowded spot costs a handful of rows, never the list.
- **Positions stay within ±1,000,000,000.** That is nearly a million steps either way from zero. The
  sum or difference of any two positions still fits in an `int`, so no midpoint or step can overflow.
  If moves to one end ever exhaust the range, everything placed is spread back across it.

**The unplaced follow the placed, in the order they joined the list:** `statusChangedAt`, or `addedAt`
for an import, which leaves the first null (ADR 0026). So a game added today queues at the end rather
than taking a place nobody gave it, and the owner's arrangement at the top is never disturbed by an
arrival. Title and then the game's id settle what is left: two games that one import landed at the same
moment, or two that two tabs placed at the same number.

### 3. The client computes the numbers; the server stores them

`planMove` (`@/lib/handOrder`) turns "put this game after that one" into the writes above.
`PATCH /api/lists/{status}/positions` stores the positions it is sent and leaves every other game in
the list alone.

- **A `PATCH`**, as the import's row decisions are: it writes some rows of a set and replaces nothing.
- **Absolute values, not "after game X".** A move of one game and a move of another, both out at once,
  write different rows with numbers that do not depend on each other. They land correctly in either
  order. A relative move applied out of order lands relative to an order the user never saw. It would
  also need the server to sort the unplaced games exactly as the client does, down to the millisecond
  JavaScript keeps of a timestamp. Sending the numbers keeps that comparator in one language, as 0020
  kept every other sort.
- **The server checks the range and the list, nothing else.** Each game must be one of this user's
  entries with this status. One that is not, because a stale tab names a game moved to Playing since,
  is passed over: its place in the backlog went with it. The user is in the store's own predicate,
  whatever list the caller hands it. A row deleted between the read and the save is passed over too,
  and the rest are saved, rather than a 500. A write carries at most 10,000 positions.
- **Any of the five lists.** A position means nothing to the server, like a sort preference. The client
  offers the order on the backlog alone, through `HAND_ORDERED_LISTS`, and a list that is later given
  one needs no server change.

`HandOrderStore` is that write, generic over `IHandOrdered`, for #117 to call rather than copy.

### 4. The order is a sort

`manual` joins `ListSortKeys` and the client's `SortKey`, so the order is chosen and remembered through
the preferences that already exist. It is labelled "My order" and offered on the backlog alone. The
default stays newest first. It has no direction, because a hand order read backwards is not one anybody
arranged: the direction button goes away, and `descending` is sent as false and ignored. A `manual`
stored for a list that does not offer it reads as the default.

### 5. The write follows the provider's rules

`moveInOrder` on `ListsProvider` takes the per-game lock of **every** game it writes. Usually that is the
moved one alone. A move that would write a game whose own write is still out is refused, and changes
nothing. The change is applied at once. A failure, whether refused or never arrived, puts back the
position each written game had.

That is the "values" half of the rule, not the "position" half. The rule forbids restoring an index,
which goes stale when another game leaves from in front of it. A sparse position is a value, like the
wishlist's `addedAt`. Restoring it is exact here, because those games were locked for as long as the
request was out. Every action is session-stamped. A reload that lands mid-move keeps the move.

### 6. Hand-rolled, not a library

dnd-kit was the candidate. Measured on 2026-10-15 with rolldown 1.2.12, minified, with React and React
DOM left external:

| | Minified | Gzipped |
|---|---|---|
| `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 + `@dnd-kit/utilities` 3.2.2 (what a sortable list imports) | 43.3 KB | 14.4 KB |
| `useReorder`, `ReorderHandle`, `ReorderAnnouncer` and `planMove` | 7.7 KB | 3.1 KB |

The second row includes the position arithmetic, which dnd-kit would not have supplied. `@dnd-kit/core`'s
last release is 6.3.1, published 2024-12-05. Its successor, `@dnd-kit/react`, is at 0.5.0. Its ids
come from a module-level counter (`useUniqueId` in `@dnd-kit/utilities`). Unless `DndContext` is given an
`id`, the `aria-describedby` on every draggable can differ between the server render and the client's.

What is needed here is narrow. It is one list of same-shaped items at a time, rows or a wrapped grid,
and the client has no UI library at all. So `useReorder` is ours. Nothing in it touches `window` or
`document` during render: measuring, capture, scrolling and listeners all live in event handlers and
effects.

### 7. The interaction

- **A handle per game**, a real `<button>` named "Move {title}" and described by hidden instructions.
  It shows the game's place for the eye and hides it from assistive technology, which hears the place in
  the announcements instead. It sits over the top of a cover in the grid, and in a column of its own in
  the table.
- **A pointer drag** captures the pointer and starts once it has travelled four pixels. The game is drawn
  in the slot under the pointer, and its neighbours shift. The slots are measured when the drag begins
  and judged against those measurements. Judged against the layout as it shifts, the game would jump
  between two slots on the spot. The window scrolls when the drag nears its top or bottom. Escape, or the
  browser taking the pointer away, calls the drag off.
- **From the keyboard**, Space or Enter picks a game up. Up and Down move it by a row of the grid, and by
  one in a list or a single row. Left and Right move it by one, and Home and End send it to either end.
  Space or Enter puts it down. Escape, Tab, or a press anywhere else puts it back.
- **Every step is announced** in an assertive live region: picked up, each new place, put down, called
  off, and "could not be moved" when the save fails. The handle carries `aria-pressed` only while its
  game is held.
- **A busy handle is `aria-disabled`, never `disabled`.** The moment after a keyboard user puts a game
  down is when its save is out. A `disabled` button would lose their focus.
- **Focus survives the move without help.** React draws a move by moving elements. A browser can drop
  the focus of a moved element, and React gives it back after its commit. That holds only while the
  handle stays the same element throughout, which the test pins, simulating the browser's half of it.
- **The list is found by an attribute, not a ref.** A ref handed out of the hook leads the React
  Compiler's lint to treat everything else the hook returns as a ref too.

### 8. Not while a filter hides part of the list

With a platform filter on, the order is shown but cannot be rearranged, and the page says so. A game
dropped between two that the filter left showing would land among games nobody can see, in an order
nobody chose.

### 9. The owner's alone

No public read carries a position, and nothing statistical reads one. The export does carry it, as
stored, added by hand to the entry's projection as `Ownership` and `Notes` were. The number is the data.
A rank would be one reading of it.

### Rejected

- **Keeping the position across a change of list.** A game coming back to the backlog months later would
  land wherever its old number now falls. If the list had been spread out in between, that would be
  nowhere in particular.
- **A table of positions keyed by entry and status.** It would be a new user-owned table, with its
  manifest entry and its cascade, to hold one integer the plan had already put on the entry. It would
  also keep stale places for lists a game left.
- **Placing every game when it joins the list.** Every path into a list would owe a position: the moves,
  the import, and whatever comes next. One that forgot would leave a null anyway, which would need the
  handling that null-for-unplaced already is.
- **Sending the whole order on every move.** It is simple, but two moves out at once overwrite each
  other unless the client queues them, and finding the few rows that changed becomes the server's
  problem.
- **Rearranging under a filter, relative to the visible games.** It is well defined, but the result
  depends on games the user cannot see.

## Consequences

**Checked against PostgreSQL.** The migration's SQL is one `ALTER TABLE "UserGameEntries" ADD
"Position" integer`. With no default, that is a change to the catalogue only, and it applied cleanly to a
copy of the local database. Arranging a test account's backlog in the browser wrote one row for a drag to
the top (position 0), one for a keyboard move to second place (1,024) and one for a drag between them
(512). A drop past two unplaced games wrote those two and the moved one. Each statement updated
`Position` alone. Moving a placed game to Playing cleared it on the server, and moving it back put it
last in the backlog, in the browser and in the database alike.

**What #117 reuses:** `IHandOrdered` and `HandOrderStore`, `PositionDto` and `SetPositionsDto`,
`planMove`, and `useReorder` with `ReorderHandle`, `ReorderAnnouncer` and `Reorder.css`. What it adds
itself: the column on `UserFavourite` and its migration, the export projection's new field, its own
`PATCH`, and its own comparator, which decides where unplaced favourites go. `planMove` needs only the
list in the order it is shown, placed games first.

**Two tabs can give two games one number.** The tie-break keeps the order total, and a later move between
the two spreads them apart. A stale tab's move can land relative to an order that tab cannot see. That
is accepted, as it is for every other control on the lists page.

**What the tests cannot see.** jsdom lays nothing out. The geometry is tested as pure functions, and the
pointer path runs against stubbed boxes. The drags themselves were checked in Chromium: grid and table,
pointer and keyboard, a failed save's undo, and Escape. Touch on a real device, Firefox, Safari and an
actual screen reader were not checked. The announcements were read from the live region's text, not
heard.

**The play-next picker on the home page still picks at random.** Offering the top of a hand-arranged
backlog instead is a natural next step. It changes a page this issue did not touch.
