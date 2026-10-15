# 0064. The favourites showcase is arranged by hand and shown in that order, and a favourite is marked on every card its owner sees

**Status:** Implemented
**Amends:** [0029](0029-favourites-are-an-axis-and-a-showcase.md) §4 (the mark on cards) and §6 (the order)
**Answers:** [0054](0054-a-hand-arranged-order-is-a-sparse-position.md) §9, for the favourites

## Context

[#117](https://github.com/ChronosSF/myvideogamelist/issues/117) asked for two things: the rosette on game
cards wherever a favourite appears, and the favourites showcase in an order its owner arranges.

[0029](0029-favourites-are-an-axis-and-a-showcase.md) had left both open. §4 called a mark on cards a
possible follow-up, and §6 shows favourites newest first everywhere and notes that a hand order would be
an additive `Position` column. [0054](0054-a-hand-arranged-order-is-a-sparse-position.md) then built the
backlog's hand order for #117 to reuse: `IHandOrdered` and `HandOrderStore` on the server, `planMove` and
`useReorder` on the client. It left four things here: the column with its migration and export field, an
endpoint of its own, a comparator saying where unplaced favourites go, and whether a public profile shows
the order (§9).

Reusing it raised questions of its own:

- **Where the arranging happens.** The showcase on `/user` is a row that scrolls sideways. `useReorder`
  scrolls the window during a drag, not the row, and a held game is put back by a press anywhere but a
  grip, which is what a touch that scrolls the row is.
- **Where the move lives.** The favourites run on `useGameAxis`, the wishlist's code, and 0029 §2 makes a
  change to one axis a change to both.
- **Which cards carry the mark, and what it means** — on the reader's pages, and on somebody else's.
- **How a mark on a cover is heard.** A game card's cover is a `role="button"` with a name of its own, and
  a screen reader hears nothing inside it.

## Decision

### 1. The backlog's position, on the favourite

`UserFavourites.Position` is 0054's number on the other axis: nullable, sparse, and null for a favourite
never placed. It has no default, no backfill and no index, for 0054's reasons, and its check constraint
is `CK_UserFavourites_Position_Range`. The two range checks are one expression in
`ApplicationDbContext`, and `HandOrderTests` walks every `IHandOrdered` entity, so a third hand-ordered
table cannot arrive without its check.

`PATCH /api/favourites/positions` takes 0054's `SetPositionsDto` and calls `HandOrderStore` through
`FavouriteService.SetPositionsAsync`. Nothing is copied:

- the store scopes to the user in its own predicate;
- a favourite taken off between the read and the save is passed over rather than a 500;
- a game that is not a favourite is passed over and given no row.

A favourite has no list to leave, so nothing clears its position the way a change of list clears the
entry's. Taking the game off the favourites deletes the row, and the place goes with it: made a favourite
again, it arrives unplaced. The idempotent add (0029 §1) keeps the place along with the timestamp.

### 2. The unplaced follow the placed, newest first

The placed come first, in ascending order of position. The rest follow newest first, as every favourite
was shown before. A tie is broken by the newer first, then by the game id.

- **Somebody who never arranges their favourites sees nothing change.**
- **A favourite made today shows right after the ones placed by hand**, near the front where its owner
  sees it and can place it, rather than at the far end of a row.
- **The backlog queues its unplaced games the other way, oldest first** (0054 §2), because a backlog is a
  queue and a showcase is not.

This is one comparator in two places: `FavouriteService.InShowcaseOrder` on the server, which every read
of the favourites uses, and `compareItems` in `useGameAxis` on the client. Both put "no position" after
every position explicitly, because PostgreSQL and the in-memory provider disagree about where an
ascending null goes. `planMove` reads the order as shown, placed first, and needs nothing else.

### 3. The public profile shows the order, and never the numbers

0054 §9 kept the backlog's order its owner's and left this question to #117. A showcase is made to be
shown (0029 §5), and its order is part of what it shows: putting one game first says something. So
`GET /api/users/{name}/favourites` returns the games in the arranged order.

- **Only the order crosses.** `PublicFavouritesDto` still carries covers and names. The positions are
  numbers for the owner's client to plan moves against, and like the dates they are the owner's data.
- **The owner is told.** The showcase's caption on `/user` says a public profile shows the favourites in
  the same order.
- **The backlog's order stays private**, as 0054 §9 decided. Nothing here changes it.

The export carries the position as stored, added by hand to the favourites' projection as
[0024](0024-the-ownership-contract.md) requires.

### 4. The move is on the axis code, once

`useGameAxis` gains `moveInOrder`, with `ListsProvider.moveInOrder`'s shape (0054 §5):

- every favourite written takes its per-game lock;
- the change is applied at once;
- a failure puts back the position each written favourite had, and releases the locks;
- every action is session-stamped.

Three more things change in the hook itself:

- **Its order is position-aware** (decision 2). The wishlist has no positions, so its order is unchanged.
- **A game added now goes first among the unplaced**, not to the very front, which on the wishlist is
  still the front.
- **A refetch that lands while a move is out keeps the moved positions**, as the reconciling of a
  refetch already kept an add or a remove in flight. `ListsProvider` keeps a held entry whole and so
  already did this.

The two refusals #116 wrote inline in `ListsProvider` are now `moveRefusal` in `@/lib/handOrder`, and
both orders call it: a move that needs a game whose own save is out, and one carrying more positions
than a write may. `FavouritesProvider` gives the hook an `order`, its endpoint and failure message.
`WishlistProvider` gives none, so the wishlist's move refuses, and its context does not hand one on.

### 5. Arranged in a mode, laid out as a grid

The showcase has an Arrange toggle, a `<button>` with `aria-pressed`, offered once there are two
favourites to arrange. While it is on:

- the showcase is a wrapped grid with every cover on screen, three to a row on a phone;
- a drag never has to scroll the row to reach a far place, and a tap needs no swipe between its two
  presses;
- the control is #116's, unchanged: `useReorder`, `ReorderHandle` and `ReorderAnnouncer`;
- a failed or refused move says why beside the covers, while a game moved out of place goes back where
  it was.

Turned off, the row is as it was, in the new order.

### 6. The rosette marks the reader's favourites wherever their games and the site's are drawn

| Where | How |
|---|---|
| Game cards: browse, search, the lists' tiles, the wishlist | On the cover |
| The lists' table | After the title |
| The home page's Continue playing and Trending rails | On the cover |
| The home page's play-next picker | After the title, the cover being too small |
| A game page's similar games, expansions and DLC | On the cover |
| The owner's own showcase on `/user` | On the cover, on every one |

The release card already shows its favourite toggle filled for a favourite, and keeps it.

- **The mark is the release card's filled rosette without the button**: white on the favourite's violet,
  in the bottom corner of a cover. Nothing else uses that corner; the ESRB rating, the critic score, a
  rank and a hand order's grip all sit along the top.
- **It is never a star** ([0021](0021-one-control-for-a-score.md)).
- **It changes nothing.** A favourite is still made or unmade on the game's page and on a release card
  (0029 §4).
- **The owner's showcase carries it on every cover** because the mark is a property of the game, shown
  wherever the game is shown. There the heading is its legend.
- **On a cover it is decoration, and the item says it in words.** `FavouriteWords` adds "one of your
  favourites" to the game's name: the heading on a game card, whose cover is a button with a name of its
  own, and the link's name on a rail. After a title, the mark is a named image.

### 7. And on nothing of somebody else's profile

The showcase there is headed as its owner's favourites, so every cover is one of theirs already. The
reader's rosette on some of them would read as the owner's mark, and say something untrue about the
owner: that those few are favourites of some stronger kind. It adds nothing the heading does not say.
The page is also built to be the same for every reader, so its edge cache serves one copy, and a reader's
marks would be the first per-reader thing on it.

The same holds for the covers in that profile's reviews. `GameRefRail` takes the predicate as a prop
rather than reading the favourites context, and `ProfileFavourites` passes none.

### Rejected

- **Grips always on the row.** A far place needs the row scrolled in the middle of a drag, and a
  permanent rank on every cover turns a showcase into a numbered list.
- **Teaching `useReorder` to scroll its container sideways.** It would make the drag reach, but the tap
  would still fail on touch, where the swipe that scrolls the row puts the held game back.
- **The unplaced oldest first**, the backlog's rule. It would reverse every unarranged showcase, and a
  new favourite would land at the far end of the row.
- **A move button on the showcase's covers**, as an alternative to dragging. 0054 rejected buttons for
  taps, and the grid has the same three ways in.
- **A rosette on somebody else's showcase marking the favourites the reader shares.** See decision 7.

## Consequences

**Checked against PostgreSQL**, on a copy of the local database, signed in as a test account:

- The migration ran `ALTER TABLE "UserFavourites" ADD "Position" integer` and added the check, and the
  check refused a row at 2,000,000,000.
- The arranged showcase wrote one row for each of a drag to the front, a tap-to-place and a keyboard
  move. A move landing past an unplaced favourite placed that favourite too, so two rows. Each was an
  `UPDATE` by `(GameId, UserId)`.
- The public profile read back the arranged order with no rosette, viewed by the owner, whose favourites
  are every cover on it. The export carried each position as stored.
- A favourite made from a game page arrived first among the unplaced, in the browser and in the database
  alike.
- With the API stopped, a move snapped back with the banner and the announcement. Moved again once the
  API was back, it saved and the banner cleared.
- The endpoint refused a missing write header, a body with no positions, an empty list, a position out
  of range, a `null` among them and a game id of 0, each as #116's does. A game that was not a
  favourite was passed over and given no row.

**A rearranged showcase can take `CACHE_PROFILE`'s window to reach a cached public profile**, as an
unfavourited game already does (0029). Reordering is not a withdrawal of consent, so D14 does not
invalidate for it.

**No request is added.** Every card reads the favourites the root provider already loads for a signed-in
reader. In the server render and until that load, nobody has favourites, so a shared-cached page renders
the same for everybody and the marks arrive after hydration.

**The migration follows #116's**, and is regenerated if that one is.

**Not verified:** touch on a real device, Firefox, Safari, and an actual screen reader. The
announcements and the words beside the marks were read from the page's text, not heard.
