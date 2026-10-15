# 0054. A hand-arranged order is a sparse position the client computes, and a change of list clears it

**Status:** Implemented
**Amends:** [0020](0020-list-view-preferences-in-the-database.md), the tie-break rule, for the hand order

## Context

[#116](https://github.com/ChronosSF/myvideogamelist/issues/116) asked for the backlog in an order its
owner arranges by hand, "what I will play next", kept per account beside the sorts that exist. Two
records and the plan had already narrowed it:

- [0020](0020-list-view-preferences-in-the-database.md) keeps sort preferences in the database and does
  the sorting on the client, over lists that are fetched whole.
- `docs/data-model-plan.md` reserved a position on `UserGameEntries`: "sparse, per status, re-sequenced
  on the client; nothing statistical reads it".
- The issue reads [0031](0031-a-list-rename-is-a-label-its-owner-sees.md) as "an order is its owner's; a
  public profile does not show it". 0031 §4 itself is about a rename, a label its owner sees. This
  record takes the issue's reading for the backlog and decides nothing for any other list.

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
- **Whether to take a drag-and-drop library**, and how the order is changed without a drag: from a
  keyboard, and from a pointer that cannot drag.

## Decision

### 1. A nullable integer on the entry, and a place in the list the entry is in now

`UserGameEntries.Position`, as the plan placed it. It belongs to the list the game sits in, so **every
write that changes the status clears it**. That covers `ListService`'s moves and removals, and the
import's commit when it moves a game to another list. A move to the status a game already holds
changes nothing and keeps the place. The client does the same in its optimistic move, and the undo of a
failed move gives the old place back.

A game that comes back to the backlog therefore arrives unplaced, and queues with the other unplaced
games by when it joined the list (decision 2). A move made in the app stamps that moment, so the game
arrives at the end. The import does not stamp it (ADR 0026), so a game the import moves back keeps the
date of its last change made in the app, or its `addedAt`, and queues by that.

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
- **Positions stay within ±1,000,000,000**, in the DTO's range and in a check constraint,
  `CK_UserGameEntries_Position_Range`. That is nearly a million steps either way from zero. The sum or
  difference of any two positions still fits in an `int`, so no midpoint or step can overflow, and the
  constraint makes that true of every row rather than only the rows the API wrote. If moves to one end
  ever exhaust the range, everything placed is spread back across it.

**The unplaced follow the placed, in the order they joined the list:** `statusChangedAt`, or `addedAt`
where that is null. So a game added today queues at the end rather than taking a place nobody gave it,
and the owner's arrangement at the top is never disturbed by an arrival.

This amends 0020's rule that title is the final tie-break for every key. In the hand order, arrival comes
before title among the unplaced, because "the order they joined" is the point of the queue. Title and
then the game's id settle what is left: two games that one import landed at the same moment, or two that
two tabs placed at the same number. The other keys keep 0020's rule.

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
- **The server checks the range and the list, nothing else.**
  - Each game must be one of this user's entries with this status. One that is not, because a stale tab
    names a game moved to Playing since, is passed over: its place in the backlog went with it.
  - The user is in the store's own predicate, whatever list the caller hands it.
  - A row deleted between the read and the save is passed over too, and the rest are saved, rather than
    a 500. Three deletions in a row end in the error.
  - A write carries 1 to 10,000 positions. A `null` among them is a 400, which model validation would
    otherwise pass to the store as a 500.
- **The list is checked when the rows are read, not in the update**, which goes by key. A move out of the
  list landing in the moment between the two leaves that game a number in a list it has left. Nothing
  reads a position outside its own list, and the next change of list clears it. Closing the gap would
  take an `UPDATE` with the status in its predicate, which the in-memory provider the tests run on cannot
  execute. That is not worth it for a number nobody sees.
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
moved one alone. The change is applied at once. A failure, whether refused or never arrived, puts back
the position each written game had and releases the locks.

That is the "values" half of the rule, not the "position" half. The rule forbids restoring an index,
which goes stale when another game leaves from in front of it. A sparse position is a value, like the
wishlist's `addedAt`. Restoring it is exact here, because those games were locked for as long as the
request was out. Every action is session-stamped, and a reload that lands mid-move keeps the move.

Two moves are refused before anything changes, each with a message in the page's banner. A sighted user
would otherwise see only the game snap back.

- A move that would need a game whose own write is still out.
- A move that would need more than 10,000 positions in one write. Only a first drop past that many
  unplaced games could plan one.

### 6. Hand-rolled, not a library

dnd-kit was the candidate. Measured on 2026-10-15 with rolldown 1.2.12, minified, with React and React
DOM left external:

| | Minified | Gzipped |
|---|---|---|
| `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 + `@dnd-kit/utilities` 3.2.2 (what a sortable list imports) | 43.3 KB | 14.4 KB |
| `useReorder`, `ReorderHandle`, `ReorderAnnouncer` and `planMove`, at the time of measuring | 7.7 KB | 3.1 KB |

The second row includes the position arithmetic, which dnd-kit would not have supplied. `@dnd-kit/core`'s
last release is 6.3.1, published 2024-12-05, and its successor, `@dnd-kit/react`, is at 0.5.0. In 6.3.1
the ids come from a module-level counter (`useUniqueId` in `@dnd-kit/utilities` 3.2.2). Unless
`DndContext` is given an `id`, the `aria-describedby` on every draggable can differ between the server
render and the client's.

What is needed here is narrow. It is one list of same-shaped items at a time, rows or a wrapped grid,
and the client has no UI library at all. So `useReorder` is ours. Nothing in it touches `window` or
`document` during render: measuring, capture, scrolling and listeners all live in event handlers and
effects.

### 7. The interaction

**Three ways to move a game, each announced** in an assertive live region: picked up, each new place,
put down, called off, and "could not be moved" when the save fails.

- **Dragging the grip.** The list's element takes the pointer's capture once the press has travelled four
  pixels, not the grip. React draws a move by moving the game's own element, and a moved element loses
  any capture held inside it. A first version captured on the grip, and every drag *down* the list
  called itself off at its first step. Review found it, and the downward drags have been checked in
  Chromium since.
  - The game is drawn in the slot under the pointer, and its neighbours shift. The slots are measured
    when the drag begins and judged against those measurements. Judged against the layout as it
    shifts, the game would jump between two slots on the spot.
  - The window scrolls when the drag nears its top or bottom.
  - Escape, or the list losing the pointer, calls the drag off. The click that ends a drag is not taken
    for a tap.
- **Tapping.** A tap on a grip picks its game up, and a tap on another grip puts it in that game's place.
  This is the single-pointer way that WCAG 2.5.7 requires for anything a drag does. It is also what a
  screen reader's own "activate" does in browse mode, since that sends a click and no keys.
  - A press on a grip never moves focus. Otherwise the held game's grip would lose focus to the tapped
    one, and that reads as the user moving on.
  - A press anywhere else puts the held game back.
- **From the keyboard.** Space or Enter picks a game up. Up and Down move it by a row of the grid, and by
  one in a list or a single row. Left and Right move it by one, and Home and End send it to either end.
  Space or Enter puts it down; a held key's repeats are ignored, and Space's release is stopped so the
  click a button makes on it cannot undo the pick-up. Escape, Tab, or focus going elsewhere puts it
  back.

**The grip is a real `<button>` whose only content is an icon**, named "Move {title}" and described by
hidden instructions. The game's place is text beside it rather than inside it. That keeps the name the
whole of the button's label, which speech input needs (WCAG 2.5.3). It also lets the place be read as
part of the item: it is the table's Order column, which carries `aria-sort`, while the grid of covers is
a list, so each cover's place is heard. The grip is 24 by 24, the smallest target 2.5.8 allows.

**Focus and scrolling follow a held game.** React keeps focus on an element its commit moves, and then
puts every scrolled ancestor back where it was. So after each step, and after an undo that sends the game
back, a layout effect scrolls the focused grip's item into view, clear of the sticky bar. A drag scrolls
the window itself and is left alone.

**A grip whose game is saving is `aria-disabled`, never `disabled`.** The moment after a keyboard user
puts a game down is when its save is out, and a `disabled` button would lose their focus.

**The list is found by an attribute, not a ref.** A ref handed out of the hook leads the React Compiler's
lint to treat everything else the hook returns as a ref too.

### 8. Not while a filter hides part of the list

With a platform filter on, the order is shown but cannot be rearranged, and the page says so. A game
dropped between two that the filter left showing would land among games nobody can see, in an order
nobody chose.

### 9. The backlog's order is its owner's alone

No public read carries the backlog's positions, and nothing statistical reads one. The export does carry
them, as stored, added by hand to the entry's projection as `Ownership` and `Notes` were. The number is
the data, and a rank would be one reading of it.

Whether the favourites' order is shown on a public profile is #117's to decide. [0029](0029-favourites-are-an-axis-and-a-showcase.md)
publishes the favourites, and a showcase arranged by hand is an order its owner may well want seen.

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
- **Move up and move down buttons as the pointer's alternative to dragging.** Taps reach any place in
  two presses, where buttons need one press per place. They also need nothing on the cover beyond the
  grip it already has.

## Consequences

**Checked against PostgreSQL.**
- The migration's SQL adds the nullable column, which changes the catalogue only, and the check
  constraint, which scans the table once and passes it, since every row is null. It applied cleanly to a
  copy of the local database.
- A direct `UPDATE` to 2,000,000,000 was refused by the constraint.
- Arranging a test account's backlog in the browser wrote one row for a drag to the top, one for a
  keyboard move and one for a drag between two placed games. A drop past three unplaced games wrote those
  three and the moved one. Each statement updated `Position` alone.
- Moving a placed game to Playing cleared it on the server. Moving it back put it last in the backlog, in
  the browser and in the database alike.

**What #117 reuses:**
- On the server: `IHandOrdered` and `HandOrderStore`, `PositionDto` and `SetPositionsDto`.
- On the client: `planMove` and `MAX_POSITION_WRITES`, and `useReorder` with `ReorderHandle`,
  `ReorderAnnouncer` and `Reorder.css`.

What it adds itself:
- the column on `UserFavourite` with its check and its migration;
- the export projection's new field;
- its own `PATCH`;
- its own comparator, which decides where unplaced favourites go;
- its answer to decision 9.

`planMove` needs only the list in the order it is shown, placed games first.

**Two tabs can give two games one number.** The tie-break keeps the order total, and a later move between
the two spreads them apart. A stale tab's move can land relative to an order that tab cannot see. That
is accepted, as it is for every other control on the lists page.

**What the tests cannot see.** jsdom lays nothing out and has no pointer capture.
- The geometry is tested as pure functions, and the pointer paths run against stubbed boxes.
- A test stands in for the browser's click on Space's release.
- The drags, the taps, the keyboard, End scrolling a game into view, a failed save's undo and Escape
  were checked in Chromium.
- Touch on a real device, Firefox, Safari and an actual screen reader were not checked. The
  announcements were read from the live region's text, not heard.

**The play-next picker on the home page still picks at random.** Offering the top of a hand-arranged
backlog instead is a natural next step. It changes a page this issue did not touch.
