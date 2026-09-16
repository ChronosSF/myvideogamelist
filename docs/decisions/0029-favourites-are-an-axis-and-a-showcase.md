# 0029. Favourites are an axis like the wishlist, share its code, and are shown on the profile

**Status:** Implemented

## Context

Tier 1 of the roadmap asked for favourites in one line: *"star a game independent of list
membership."* The data-model plan gave them a table, `UserFavourites (UserId, GameId)`, separate from
the entry because a favourite has to be expressible with no entry at all.

Two words in that line do not survive contact with the code, and two questions were left open.

**"Star" is taken.** [0021](0021-one-control-for-a-score.md) settled that stars mean the user's own
score and nothing else. A starred favourite beside a five-star score control would be exactly the
mix-up that record exists to prevent.

**The plan's shape has no timestamp**, but its own decision 7 gives every axis that is not a status —
the wishlist, custom lists — a timestamp column instead of events. Without one there is no order to
show favourites in and no history of them at all.

**The wishlist already is an axis, and copying it would be the third copy.** Its service has a race
guard in each of its two writes, and its provider carries the session stamps, the per-game lock and
the surgical rollback that [0022](0022-entry-surrogate-key-and-the-wishlist-axis.md) took three
rounds of review to get right. 0022 also records why copies are dangerous here: a guard added to one
provider was missed on the other twice, because review reads the diff and the other file is never in
it.

**Where a favourite is shown was never said.** A favourite is the one thing about a game somebody
chooses in order to show it, which points at the public profile — but
[0027](0027-usernames-and-public-profiles.md) hand-assembles that document field by field, and
deliberately publishes nothing of the wishlist beyond its size.

## Decision

### 1. An axis with the wishlist's shape

`UserFavourites (UserId, GameId, AddedAt)`: a composite primary key that makes adding idempotent, a
cascade from `AspNetUsers`, an index on `(UserId, AddedAt)`, **no foreign key to the entry** and **no
events**. `AddedAt` is the whole history. The API is the wishlist's: `GET /api/favourites`, and an
idempotent `PUT` and `DELETE` on `/api/favourites/{gameId}`, where a second add keeps the original
timestamp. The `PUT` answers with the timestamp it kept — on both axes, since the code is shared — so a
tab that adds a game another tab already added files it where it really belongs rather than at the top.

It is registered in the export manifest (`favourites`, oldest first like every other section) and in
`UserOwnedDataTests`' inventory, as [0024](0024-the-ownership-contract.md) requires.

### 2. One implementation for both axes

The code is shared and the state is not.

- **Server:** `IGameAxisItem` names the three columns, and `GameAxisStore` holds the add and the
  remove with their race guards, scoped by the row's own `UserId` in every predicate. `WishlistService`
  and `FavouriteService` call it; neither holds a copy.
- **Client:** the wishlist provider's reducer and mutations moved, unchanged in behaviour, into
  `useGameAxis`. `WishlistProvider` and `FavouritesProvider` each call it with their own endpoint and
  messages, and each keeps its own context — so each keeps its own pending set, and a wishlist toggle in
  flight never disables the favourite toggle on the same game.

A fix to either axis is now a fix to both, which is the property 0022 lacked.

### 3. A rosette in violet, never a star in yellow

The panel's favourite control is a rosette, filled when set, in violet: a third colour for a third
kind of thing beside the statuses' blue and the wishlist's pink, and deliberately not the stars'
yellow. The roadmap's "star a game" is read as "mark a game".

### 4. Set from the game page, not from every card

The toggle is in the game page's panel, beside the wishlist, and nowhere else. The card overlay holds
the five statuses and the wishlist, which are the quick actions of browsing; making something a
favourite is a rarer and more deliberate act, and a seventh button would crowd the six that are used
constantly. A marker on cards that are already favourites is a possible follow-up.

### 5. Shown on the owner's profile and on the public one

The owner's `/user` page opens its main column with them. The public profile opens with them too, and
this is the decision 0027's hand-assembly requires somebody to make explicitly:

- **One gate, the profile's.** A private profile publishes no favourites; a public one publishes all of
  them. There is no per-favourite visibility, because a favourite is a statement made in order to be
  shown — which is the difference from the wishlist, whose contents say what somebody means to buy and
  stay off the public page.
- **The panel and the owner's page say which applies**, from the account's own visibility, as the
  review form does ([0028](0028-a-games-community-view.md) §8): "shown on your public profile" or
  "your profile is private, so nobody else sees them".
- **The count is on the profile document; the games are a request of their own.** The count needs no
  IGDB, so the page can say "3 favourites, but they could not be loaded" during an outage rather than
  implying there are none. The list, `GET /api/users/{name}/favourites`, carries `GameRefDto`s — a cover,
  a name and an id — and no dates, which are the owner's data rather than part of a showcase.
- **Server-rendered, in the loader.** A row of covers arriving after hydration would push the whole
  profile down under the reader. A failed favourites request makes the render degraded, and so
  `no-store`, only for somebody who has favourites; for anybody else the page is the same either way.

### 6. Unbounded and in the order they were chosen

No cap. A small cap would keep the word meaning something — a favourite among three hundred is not
much of one — but that is a product call this record does not make, and ROADMAP §4.1 keeps the core
tracking loop unlimited. A cap added later is a check in `FavouriteService.AddAsync`; the table needs
nothing. Newest first, everywhere they are read. A hand-arranged order would need a `Position` column,
which is additive whenever it is wanted.

## Consequences

**Every signed-in page load makes one more request**, `GET /api/favourites`, from the root provider, as
it does for the wishlist — and it resolves covers through IGDB's id lookup, which is cached. Accepted
for the reason the wishlist accepted it: the panel needs membership the moment the page renders, and a
provider is what keeps a toggle on one page true on the next.

**The wishlist's tests are the evidence the move preserved it.** All 26 of `WishlistProvider.test.tsx`
passed against `useGameAxis` without an edit (three more have since been added, for the timestamp the
`PUT` answers with), and `WishlistRaceTests` now exercise `GameAxisStore`.
`FavouriteRaceTests` exist so that a favourites service which stopped going through the store fails
rather than losing its guard quietly.

**The generic predicate was checked against PostgreSQL, not only the in-memory provider.** Npgsql
translates the interface-constrained `i.UserId == userId && i.GameId == gameId` into a plain
parameterised `WHERE`, and an add, a repeated add, a remove and a repeated remove against the local
database returned true, false, true and false. Once the add returned the timestamp instead, the
projection `(DateTimeOffset?)i.AddedAt` was checked the same way: it reads the one column, and an add
repeated three hours later answered with the first add's time.

**An unfavourited game stays on a cached public profile** for `CACHE_PROFILE`'s window. That is not a
withdrawal of consent, so it is not one of the events ROADMAP D14 invalidates for; a profile made
private still is, and takes its favourites with it.

**Favourites are not a statistic.** `/api/user/stats` does not count them and the profile's tiles do
not mention them: they say nothing about what somebody played, finished or thought of a game.
