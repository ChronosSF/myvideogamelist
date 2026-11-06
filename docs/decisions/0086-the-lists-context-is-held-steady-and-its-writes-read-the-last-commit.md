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

It is memoised on what it holds. The readers, `isPending`, `isInList`, `getListFor`, `scoreFor` and
`nameFor`, are called during render, so they read the render's state and change when what they read
changes. A card asking after its game is then drawn again only when the answer can have changed. The
three that ask where a game is look it up in one index, built once for each change of the lists. Before,
each walked every list, five times for each card on every render.

### 3. Every write is the same function for as long as the provider is mounted

A write reads `committed.current` as it starts. That ref holds the state and the account of the render
React last committed, and it is written in an insertion effect, never during render. ADR 0022 §8 rules
out the render: React can discard a render it never commits, and a marker moved by one would name an
account that never arrived. It also rules out the passive effect, which runs after the commit and leaves
a window in which the new account is on screen and the marker still names the old one. An insertion
effect runs before every other effect of the same commit, layout effects included. So no effect of any
component can call a write between the commit and the write.

What 0022 §8 guards is unchanged. The account is in the reducer. A mutation reads the session once, as it
starts, and stamps everything it raises with it, through `stamped(dispatch, session)`: its lock, its
undo, its failure. The reducer drops whatever no longer matches. A write reads the same state its closure
used to hold, because the render that drew the button the reader pressed is the render last committed.
The one difference is a write kept from an older render. It used to read that render, and so could miss
a lock taken since, or a row it would need to put back. Now it reads the state as it stands, and a test
holds that.

`useEffectEvent` would have done this, but it may be called only from an effect, and these are called
from event handlers.

### 4. A card reads its own game's place, and draws again only when that changes

`GameCard` reads the lists context, and a component that reads a context is drawn again whenever its
value changes. So the outer part reads the context, takes from it its game's list and lock, a list's
name and the two writes, and hands them to a memoised card in the same file. A save of another game
calls the outer part of every card, which only looks its game up, and draws no other card.

## Consequences

- A change of order draws no table row again, and only the tiles whose cover moves into or out of the
  first row, where it loads with the page. A save draws the row or the card of the game saved, and no
  other. #457 has the timings. The cost that remains for a save with the whole list drawn is mostly the
  browser laying out six hundred rows or cards, not React.
- A new write in the provider is a `useCallback` with no dependencies. It reads `state` and `session`
  from `committed.current` as it starts, by those names, and gets its stamped actions from `stamped`. One
  that reads the component's `state` instead gets a warning from the hooks lint, which does not fail the
  lint. Left as it is, the write reads the render it was made in, for ever, which the test of a kept write
  shows for the score. Given the dependency the lint asks for, it changes with every
  render again: the test of the writes after a save fails, for every write in its list, where a new one
  belongs. A new reader is a `useCallback` over exactly what it reads, and it is
  never called from a write.
- What this leaves. A hand order's rows are still drawn on every render, because `useReorder` returns new
  props each time. The wishlist and the favourites (`useGameAxis`) still hand out a new value on every
  change, so a wishlist toggle still draws every card. The same treatment would apply to both, and
  neither is done here.
