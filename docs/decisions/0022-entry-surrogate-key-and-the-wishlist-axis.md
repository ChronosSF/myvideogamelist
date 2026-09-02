# 0022. The entry gets a surrogate key, and the wishlist is an axis rather than a status

**Status:** Implemented

## Context

Two changes to the one table that already holds data, done together because they are the same
migration and because both get more expensive the longer they wait.

`UserGameEntries` was keyed on `(UserId, GameId)`. That was correct while the entry was the only
row a user owned about a game. It stops being correct the moment anything hangs off it:
playthroughs, reviews and tags are all next, and each would carry both columns in its own primary
key and in every join to reach one entry.

Separately, the roadmap has always promised a wishlist, and the cheap-looking move is a sixth
`ListStatuses` row. That is wrong in shape, not just in policy. The five statuses are mutually
exclusive *by construction* — a game holds exactly one, in a single `StatusId` column — and
wanting a game is not exclusive with playing it. Someone part way through a series while
wishlisting the sequel cannot be expressed by a status at all.

The timing argument is the whole reason this went first: a primary-key change is cheapest when the
table is smallest. The local database had nine rows.

## Decision

**1. A surrogate `Id`, with `(UserId, GameId)` kept unique by index.** This adds a column and
relaxes nothing — one user still cannot hold two entries for the same game. Children point at one
integer.

**2. The wishlist is its own table**, `UserWishlistItems(UserId, GameId, AddedAt)`, with a
composite primary key and **no foreign key to `UserGameEntries`**. A wishlisted game usually has no
entry: wishlisting is often the first thing a user does with a game, long before there is a score
or a status. A foreign key would force an entry into existence just to record wanting something.

**3. A wishlist change records no `UserGameEvent`.** `AddedAt` is the entire history the axis
keeps. [0018](0018-append-only-status-event-log.md) keeps that log typed and narrow — status
transitions only, no event-type discriminator — because every statistic derived from it assumes
one shape. A wishlist add has no *from*, is not exclusive, and is not meaningfully aggregatable as
a transition. The data-model plan reaches the same conclusion for custom lists, and the wishlist
gets the same treatment: a timestamp column, not events.

**4. Adding is idempotent and never re-orders, including under concurrency.** `PUT`, not `POST`.
Re-adding a game that is already wishlisted succeeds, changes nothing, and specifically **keeps the
original `AddedAt`** — the list is ordered by when someone started wanting a game, so a
double-click must not move it to the top.

A pre-check alone does not deliver that promise. Two requests can both read "not present" and only
one insert can win the composite key, so the loser surfaced a unique violation as a 500 — on a
double-click or a second open tab, which is to say on the primary interaction. The same shape
applies to delete, where the loser gets a `DbUpdateConcurrencyException` for a row that is already
gone. Both are now translated into the advertised result, and **both confirm by re-reading rather
than by matching a SQL state**, so neither depends on which provider is underneath or on what error
code it chose.

**5. The separation runs all the way up.** A separate service, controller, context and provider,
rather than more methods on the list versions. The concrete payoff is two pending-mutation sets:
a status change in flight no longer disables the wishlist button on the same game, which is the
bug a shared set would have produced.

**6. Optimistic rollback is surgical, because concurrent mutations are the point.** The pending set
is per game, so an add of one game and a removal of another run at the same time deliberately.
Rolling back by restoring the list as it was before the request therefore cannot be correct: it
would undo whichever other mutation succeeded in the meantime, and the visible symptom is a removed
game reappearing. So the rollback of an add drops exactly that game from current state, and the
rollback of a removal re-inserts exactly that row.

Adding and restoring are then deliberately *different* operations. A newly wanted game is placed at
the front, because it is the newest by definition and its timestamp came from the browser — sorting
that against server timestamps lets a slow client clock file a brand-new game below old ones. A
restored row has a server timestamp and a position it came from, so it is sorted back into that
position rather than prepended.

**7. A toggle is only offered when membership is known.** That means disabled during the first
fetch — where a successful write would be overwritten by the older response landing after it — and
also disabled while a *failed* fetch stands. The second case is the sharper one: `loading` goes
false on failure, so without it every card would cheerfully offer "Add" for games already on the
wishlist, on the strength of a list that never arrived. Since that leaves the feature inert, the
error state carries a retry; disabling with no way out would be worse than the wrong label.

**8. A rollback belongs to the session that started it.** A mutation can still be in flight when
one account logs out and another logs in. Without a guard, the delayed failure writes the previous
account's row into the new account's list — one user seeing another user's game, which is a leak
rather than a glitch, and the reason this is a decision and not a detail.

It takes two things, and neither is sufficient alone.

**The account lives in reducer state**, is stamped on every action a mutation raises, and
mismatched actions are dropped by the reducer. The first attempt used a ref written from the fetch
effect, which is wrong in a way worth recording: a passive effect runs *after* the commit, so there
is a window in which the new account is already on screen while the marker still names the old one,
and a completion landing inside it passes the guard. Writing the ref during render closes that
window but opens another — React can discard a render it never commits, moving the marker for an
account that never arrived. State compared inside the reducer cannot drift from the data it guards,
which is the property the ref never had.

**And the state is cleared when the account changes**, on `FETCH_START` rather than when the fetch
succeeds. This one is independent of any mutation: `FETCH_ERROR` keeps the items it already has, so
a *failed* load for the new account left the previous account's data on screen underneath the error
message. Clearing on the transition means a fetch that never succeeds cannot strand anything.

**And the transition is applied during render**, not from the effect. Dispatching it from the
effect still leaves the frame between commit and effect, in which the new account is on screen
while both the lists and the session guarding them belong to the previous one. Nothing about
rollbacks fixes that frame: no mutation need be in flight for it to render one user's games under
another.

Both of the first two were found by review after the first fix shipped, and the tests meant to
cover the first could not have caught either: they signed the second account in through a helper
that exits its own `act` and therefore flushes effects, so the marker was always current by the
time the rollback ran.

**The third has no test at all, and the reason is worth recording** so nobody assumes it is an
oversight. Under jsdom, `act` flushes render, commit and passive effects together on the way out —
a `rerender` inside an `act` block does not even commit until the block exits — so the frame this
guards does not occur in the test environment. Removing the render-phase dispatch leaves the entire
suite green. It stays because it is correct in a browser, and it is commented in the provider as
reasoned rather than covered.

The same caveat applies to session-stamping `FETCH_SUCCESS`, `FETCH_ERROR` and
`PREFERENCES_LOADED`. Every case a test can reach is already stopped by the request's
`AbortController`; the stamps only matter in that same unobservable frame, before the effect
cleanup aborts anything. They are belt-and-braces, and the test that looks like it covers them
says in its own comment that it does not — it survives having the stamp removed.

`CLEAR_MUTATION_ERROR` is the exception: it is raised from a mutation continuation rather than from
an abortable fetch, so a late success from the previous account really could wipe the new one's
error banner. That one is stamped and tested.

**9. Load errors and mutation errors are separate fields.** A wishlist that failed to load has
nothing trustworthy to show and takes the whole page. A toggle that failed has already been rolled
back, so the wishlist beside it is perfectly good and must not be replaced by an error state. The
mutation error also clears on the next success, or the banner outlives the problem with no way to
dismiss it. `ListsProvider` already drew this line; not following it here was an oversight rather
than a decision.

## Consequences

**The migration scaffolded correctly, which is not the norm here.** EF has produced
drop-and-recreate for this table before. This time it emitted the right four statements, and the
generated SQL was read before it was run: non-destructive, one transaction, and
`GENERATED BY DEFAULT AS IDENTITY`, which is what makes it safe on a populated table — PostgreSQL
rewrites the table and assigns every existing row a distinct value. Verified against the real local
database afterwards: nine rows, nine distinct ids, the sequence sitting past the highest of them.
The migration file carries a note telling the next person to check the same things.

The scaffolder also emitted `defaultValue: 0` on that column, which Npgsql ignores for an identity
column — the generated SQL carries no `DEFAULT` either way, confirmed by diffing the script with
and without it. It has been deleted regardless. A migration whose source says one thing while its
remarks and this record say the opposite is a trap for whoever reads it next, and "the provider
happens to suppress it" is not a property worth depending on silently.

**`Ownership` and `Notes` were deliberately left off**, even though the data-model plan lists them
as this table's other two open columns. A nullable column is additive and cheap to add whenever
there is UI for it; the primary-key change was neither, and that asymmetry is the only reason this
work was urgent. Adding them now would have shipped two columns nothing reads.

**The unique index cannot be unit-tested.** The EF Core in-memory provider ignores unique indexes
entirely, so a duplicate insert succeeds there whatever the model says. `EntryKeyTests` asserts the
*model* — the key is `Id` alone, and a unique index on `(UserId, GameId)` exists — plus the
application-level half, that every write path goes through find-or-create and so never produces a
second row. The constraint itself is verified by reading the generated SQL.

**Five user-owned tables now, so the plan's guard test is overdue and landed with this.**
`UserOwnedDataTests` walks the EF model and fails if any entity carrying a `UserId` lacks a
cascading foreign key from `AspNetUsers`, plus an inventory tripwire that fails when a sixth such
table appears. The plan asks for the export half of that assertion too; there is no data export
yet, so it joins when there is one. ASP.NET Identity's own tables carry a `UserId` and pass the
cascade check, but are scoped out of the inventory — the framework owns their lifecycle.

**What this unblocks:** playthroughs, `PlaythroughTypes` and reviews (the plan's step 3, which
needed the surrogate key); H4 "your week", which surfaces wishlist and backlog releases above the
general timeline; and the IsThereAnyDeal work, whose flagship feature is a price-drop alert on a
wishlisted game.

**A card reports its own failure, because the shared error has nowhere to appear.** `GameCard`
renders on Games, Home and the upcoming timeline, and none of those pages show the provider's
`mutationError` — so a failed toggle would have snapped the heart back with no explanation. `add`
and `remove` therefore return whether the wishlist ended up holding what was asked for, following
`setScore` on the lists context, and the card renders its own result rather than the shared error,
which belongs to whichever card was clicked last. The message sits in the card body, not the hover
overlay, because a message that vanishes when the pointer moves is not one.

A shared notification would be the better answer and is the natural follow-up: the five list
buttons on the same card have exactly this gap, and it predates the wishlist.

**`ListsProvider` has since had decision 8 applied to it** — all four of its mutations
(`addToList`, `removeFromList`, `setScore`, `deleteEntry`) stamp the session on every action they
raise, and it clears its lists *and* its per-user preferences when the account changes. Both
providers now use the same two mechanisms, and the wishlist one was moved off the ref it originally
shipped with.

**It still rolls back wholesale, though.** Its mutations share one pending set across all five
statuses, so two cannot overlap for the same game — but they can for two different games, and
`setScore` takes no pending lock at all, so the resurrection described in decision 6 is still
reachable there. Separately, `addToList`, `removeFromList` and `deleteEntry` wrap their fetch in
`try`/`finally` with no `catch`, so an unreachable API rejects into an unhandled promise rather
than the deliberate rollback — which is the trap `CLAUDE.md` warns about for loaders. Both predate
this work and belong in their own change.

**The wishlist page is tiles only.** No table view and no toolbar: a wishlist item has no score and
no status, so four of the table's columns would be empty and its sort options meaningless. "When
did I start wanting this" is the only ordering the axis has, and it is the default.
