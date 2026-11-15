# 0086. The lists context is held steady, and its writes read the render last committed

**Status:** Implemented — #457, after #455.

## Context

#455 drew a long list sixty games at a time and memoised the tile and the table row, so that a new
chunk drew its own sixty and nothing else. It left two costs where they were, measured and named in its
description. A change of sort drew every card on the page again, and a save, a score or a move or a
removal, drew every card and every row.

Both had one cause. `ListsProvider` built its context value afresh on every render: a new object, and
new functions in it. Every `useLists()` consumer was drawn again on every change of the provider's
state, a change of sort included, since the sorts and the layout were that state as well. `GameCard`
reads the context itself, so no memo above it could stop it. The table rows read nothing, but were handed
`setScore` and `removeFromList`, which were new each time.

The functions were new for a reason. Each one read the state and the account of the render that made it,
and ADR 0022 §8 is about why the account is read from there and not from a ref. A write has to know the
state as it is when it is called: whether the game is already saving, and which row to put back if the
save fails. A function made once cannot close over a render that came later.

## Decision

### 1. The layout and the sorts are a context of their own

`ListViewContext`, through `useListView`: the layout and each list's order, read by the lists page and
nothing else. They stay in the provider's reducer, beside the lists, because what ADR 0022 settled for
them still holds. An account change clears them on `FETCH_START`, and the preferences read gives way to
a write made while it is out. Only the context they are handed out in is new. A change of order now
reaches the lists page, which draws the games it puts in a new place, and no card anywhere.

### 2. The lists context is the same object until something in it changes

It is memoised on what it holds. The readers, `isInList`, `getListFor`, `scoreFor` and `nameFor`, are
called during render, so they read the render's state and change when what they read changes. A card
asking after its game is then drawn again only when the answer can have changed. Where a game is has one
answer, `locateAll`'s index, built once for each change of the lists: the readers look a game up in it,
and so do the writes, in the index of the render last committed (§3). Before, each reader walked every
list, five times for each card on every render, and the writes had a lookup of their own.

The per-game locks are not a reader. Every save takes one and releases it, and a reader that changed
with them would draw every consumer of the lists again twice a save: the lists page, every card on it,
and whatever else reads the lists. They are a store instead, `pending`, the same object for as long as
the provider is mounted, holding the set of games the provider last committed. It is published as each
commit is laid out, in a layout effect, which is the first moment a store may tell a component to draw
again. A component subscribes for one game, through `useListPending` or, if it must not read the lists
context, `usePendingIn` with the store it is handed, and is drawn again when that game's lock changes and
for no other. A component that shows several games' locks reads `useListsPending`, and is drawn again
for any. The store lags the reducer by one render, never painted: the layout effect's update is drawn
before the browser draws anything.

What is drawn in that render is replaced, but what is decided in it is kept. A save's first render moves
the game and takes its lock, and a component reading both sees the game moved and unlocked. So nothing
may decide anything from a game's place and its lock together. The play-next picker did: it kept its
pick while the pick was locked and drew another once it had left the backlog unlocked, so starting it
drew another game in that render, and kept it after the start had failed. It now keeps its pick by the
start it sent itself, which it lets go once the write has resolved (§3 commits the answer first), and only
draws the lock. The home page mounts it anew for each account, so a start one account left out holds
nothing on the next one's card.

### 3. Every write is the same function for as long as the provider is mounted

A write reads `committed.current` as it starts. That ref holds the state and the account of the render
React last committed, and where each game was in it, and it is written in an insertion effect, never
during render. ADR 0022 §8 rules out the render: React can discard a render it never commits, and a
marker moved by one would name an account that never arrived. It also rules out the passive effect, which
runs after the commit and leaves a window in which the new account is on screen and the marker still
names the old one. Insertion effects run while the commit is applied, before any layout or passive effect
of it, every component's. So no layout or passive effect can call a write between the commit and the
write. The insertion effects of the components below the provider run before its own, and none may call
a write.

What 0022 §8 guards is unchanged. The account is in the reducer. A mutation reads the session once, as it
starts, and stamps everything it raises with it, through `stamped(dispatch, session)`: its lock, its
undo, its failure. The reducer drops whatever no longer matches. A write reads the same state its closure
used to hold, because the render that drew the button the reader pressed is the render last committed.
The one difference is a write kept from an older render. It used to read that render, and so could miss
a lock taken since, or a row it would need to put back. Now it reads the state as it stands, and a test
holds that.

`useEffectEvent` would have done this, but it may be called only from an effect, and these are called
from event handlers.

**What a write raises once its request has answered is committed before it resolves.** Its all-clear or
its undo, and its lock released, go through `settle`, which is `flushSync`: one render, there and then.
Raised as they were, outside any event, they waited for a render React schedules for later. A caller
that made a second write of the same game as soon as the first resolved would read the render last
committed, find the first's lock still held, and be refused, or find the row as the first had left it
before its answer. No caller does that today, and two tests hold the order for whoever does: a move then
a score, and a move that failed then a score. The render is one either way; it only happens sooner. A
refusal's sentence is read from its body before anything is settled, so that the undo, the sentence and
the release are that one render. The hand order's move, written once for the backlog and the favourites
(`moveInHandOrder`), takes the same `settle` from the lists provider, and runs its completion as it
always did for the favourites, whose writes still read their render.

### 4. A card reads its own game's place, and draws again only when that changes

`GameCard` reads the lists context, and a component that reads a context is drawn again whenever its
value changes. So the outer part reads the context, takes from it its game's list, a list's name and the
two writes, subscribes to its game's lock, and hands them to a memoised card in the same file. A save of
another game calls the outer part of every card, which only looks its game up, and draws no other card. A
lock taken or released calls the outer part of its own game's card alone.

### 5. A row or a tile of the lists page reads its own lock, and a hand order's handles are steady

The page reads the lists context, so it is drawn for every save. It must not be drawn for every lock as
well, so it reads no lock: a table row and a tile in a hand order each subscribe to their own game's, in
the store the page hands them (`usePendingIn`), and draw it — greyed, held, a handle that cannot be picked
up.

A hand order's handles were the other thing every row was handed anew. `useReorder` built each item's and
each handle's props during the page's render, with handlers that closed over that render, so every row
beside a handle was drawn again with every render of the page. It now also hands out `handles`, the same
object for as long as it is mounted, which builds those props from what the item says of itself: its id,
its name, whether it is being moved and whether it can be. Their handlers call the gesture as the render
the list last committed would run it, through a ref written in an insertion effect, as the writes read
the provider's. A row, or a tile (`ListOrderTile`), builds its own props from them, and is drawn again
when its own place or state changes. Whether a game can be picked up is the handle's to say: the page no
longer passes `canMove`, since that would read the locks, and a press honours the handle as drawn
(`aria-disabled`). The favourites' showcase still builds its handles with `handleProps`, which `handles`
now builds too.

## Consequences

- A change of order draws no table row again, and only the tiles whose cover moves into or out of the
  first row, where it loads with the page. A save draws the page once, for the change it shows, and the
  row or the card of the game saved, and no other, in a hand order as well; its lock, taken and released,
  draws that row or card and nothing else. #457 has the timings. The cost that remains for a save with
  the whole list drawn is mostly the browser laying out six hundred rows or cards, not React.
- A new write in the provider is a `useCallback` with no dependencies. It reads `state` and `session`
  from `committed.current` as it starts, by those names, and gets its stamped actions from `stamped`. One
  that reads the component's `state` instead gets a warning from the hooks lint, which does not fail the
  lint. Left as it is, the write reads the render it was made in, for ever, which the test of a kept write
  shows for the score. Given the dependency the lint asks for, it changes with every
  render again: the test of the writes after a save fails, for every write in its list, where a new one
  belongs. A new reader is a `useCallback` over exactly what it reads, and it is
  never called from a write. A write that dispatches after its request ends with `settle`, or the next
  write of the same game, made as this one resolves, finds it still saving.
- A new reader of a lock reads the store: `useListPending` in anything that reads the lists anyway,
  `usePendingIn` in a memoised row or tile that must not, `useListsPending` for several games at once. A
  hand-built lists context in a test gives `pending: listPending(…)` (`@/test/factories`). A lock is for
  drawing, and for refusing a press: a component that must hold on to a game while its own write is out
  holds its own record of the write (§2), and a test of that has the real provider behind it, since a
  mock hands the lists and the lock over in the same render.
- What this leaves. The wishlist and the favourites (`useGameAxis`) still hand out a new value on every
  change, so a wishlist toggle still draws every card. The same treatment would apply, and it is not done
  here.
