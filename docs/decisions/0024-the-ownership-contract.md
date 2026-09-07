# 0024. The ownership contract: one manifest, guarded in both directions

**Status:** Implemented

## Context

`docs/data-model-plan.md` separates schema gaps into two kinds. Most are recoverable — add a
column, ship a migration, users fill it in. The second kind is a **cross-cutting constraint**, and
account deletion with data export is the example it gives: not a feature of one table but an
obligation on *every* user-owned table, forever, including the ones added a year from now. Miss one
and it surfaces as a compliance defect at the worst possible moment.

Half the guard already existed. `UserOwnedDataTests` walked the EF Core model, selected every entity
carrying a `UserId`, and failed if one lacked a cascading foreign key from `AspNetUsers` tied to that
column, plus an inventory tripwire naming the five. The export half was left out deliberately,
because there was no export to assert against — the plan's instruction was to "add it with the
export, not before". This is that export.

Two smaller things forced choices along the way. The status a game sits in is stored as a numeric
id, and those ids are seeded constants of *this* database. And `ROADMAP.md` says two contradictory
things about export: Tier 1 lists "self-service account deletion with data export" as core, while
the monetisation table lists "Export (CSV/JSON)" as paid-only.

## Decision

**1. One manifest, keyed by `Type`, and it is the only place a table is registered.**
`UserDataExporter.Manifest` maps each user-owned entity type to the read that fills its section of
the document. `ExportAsync` walks it rather than calling the five readers in sequence, so adding a
table to the export is one entry and nothing else. The registry is keyed by `Type` rather than by
table name specifically so the guard can compare it against the model itself; a string registry
would need keeping in step with a rename by hand, which is the class of mistake the guard exists to
remove.

Two types are deliberately absent. `ApplicationUser` is not a table the user owns rows in — it *is*
the user, carries no `UserId`, and its two MVGL columns are read straight into the document's
`account` section. `ListStatus` is system-owned seed data; the export carries its keys, not its rows.

**2. The guard runs in both directions.** Every entity in our assembly carrying a `UserId` must be a
manifest key, *and* every manifest key must be such an entity. The first direction catches the
failure the plan is about: a new user-owned table nobody exported. The second catches a stale
registration left behind by a removed or renamed table, without which the first direction could pass
for the wrong reason. Both were mutation-tested when they were written — dropping `UserWishlistItem`
from the manifest fails the first, and adding a bogus `typeof(ListStatus)` fails the second.

The draft object every section writes into starts each slot **empty rather than null**, which is
what makes the guard load-bearing rather than decorative: an unregistered section would not throw,
it would export as "nothing recorded". A silent, plausible-looking hole in somebody's data is
precisely the failure that has to be caught by a build rather than by a user.

**3. The export makes no IGDB call and carries no game metadata.** Same rule as the profile
statistics in [0023](0023-profile-statistics-derived-at-read-time.md), for a stronger reason. There
the argument was that a statistic about the user's own behaviour should not go dark because a third
party is down. Here it is that taking your data with you is a *right*, and a right that stops
working during an IGDB outage is not one. Each row carries the IGDB id, which is the same identifier
our own tables hold and therefore exactly as much as we know about the game.

The document is deliberately about our data, not IGDB's — the distinction
[0001](0001-igdb-as-source-of-truth.md) draws. A user who wants titles has an id per row to resolve
them with, and we have not pretended to own a catalogue we do not have.

**4. Statuses are exported as their `Key`, never their id.** [0018](0018-append-only-status-event-log.md)
makes `Key` the permanent contract and the numeric id an implementation detail — the ids are seeded
constants assigned in `ApplicationDbContext`, and nothing outside this database could interpret
them. An export full of `4`s would be unreadable by any other tool and by a future importer of our
own. So an entry in Finished exports as `"finished"`, and both ends of every event likewise. A null
status stays null at both ends, because null is a real value on both tables: on the entry it means
the game is in no list (ADR [0019](0019-entry-survives-leaving-every-list.md)), and on an event it
means a first add or a removal.

The entry's surrogate `Id` is omitted for the same reason. It is an internal key from ADR
[0022](0022-entry-surrogate-key-and-the-wishlist-axis.md) with no meaning outside this database;
`gameId` plus the owning account is what actually identifies the row.

**5. Export is free, and it stays free. The paid product is a format.** The roadmap's two entries
are not actually in conflict once the line is drawn in the right place:

- **`GET /api/user/export` is data portability**, which is a data-subject right. It cannot sit
  behind a subscription, cannot be rate-limited to uselessness, and cannot be removed if the
  monetisation model changes. It ships in Tier 1 alongside account deletion because the two are the
  same obligation seen from either side — leaving, with your data.
- **The paid "Export (CSV/JSON)" is a nicer format on top of it**: CSV for spreadsheets, a
  re-importable shape, column selection, scheduled or emailed exports. Convenience over the same
  data, which is a legitimate thing to charge for.

Written down here because the failure mode is silent and specific: somebody reads the monetisation
table, sees "Export — paid", and puts an entitlement check on this endpoint. The endpoint's own XML
comment says the same thing at the point where that edit would be made.

**6. Deletion is one `userManager.DeleteAsync`, and that is the whole point.** Every user-owned
table cascades from `AspNetUsers` through its own `UserId` column, so the account row going away
takes the entries, the event log, the wishlist, the hidden platforms and the sort preferences with
it, in one transaction. The controller holds no list of tables to fall out of date. What makes that
safe is not the controller but the model, and the model is what the guard asserts — which is why
this record treats the cascade test and the deletion endpoint as one decision rather than two.

**7. Password re-entry is the confirmation.** A valid session cookie says this browser signed in at
some point; it says nothing about who is at the keyboard now. For an act with no undo — and this one
takes the event log, which ADR 0018 spent its whole argument on being unrecoverable — the bar is the
account's own password, checked with `CheckPasswordAsync`. A wrong password is a 401 with a message,
not a 400: it is a failed authentication, not a malformed request.

## Consequences

**There is no test that deletes a user and asserts the rows vanished, deliberately.** The suite runs
on the EF in-memory provider, which cascades only to rows the context happens to be tracking. Such a
test would pass when the fixture loaded the dependents first and fail when it did not, in both cases
for reasons that have nothing to do with PostgreSQL — and a green test that proves nothing about the
constraint it names is worse than no test, because it stops anyone from writing the real one. The
cascade is established by the model assertion plus the `ON DELETE CASCADE` the migrations emit from
it. The controller action is thin enough to read in one screen and, like every other controller here,
has no unit test of its own. If deletion ever grows a real service — soft delete, a grace period,
export-before-delete — that is the point at which this needs an integration test against a real
database, not a fake one.

**The export is one query per table plus two, unpaginated and uncached.** A heavy user by ADR 0018's
own sizing is a few thousand rows, which is a document of tens of kilobytes; this is a rare, manual
action and does not deserve machinery. If the cached-metadata table or playthroughs make it large
enough to matter, the answer is a background job that writes a file and emails a link — the shape
every large export ends up as — not pagination on this endpoint.

**A missing account row throws rather than returning an empty document.** Callers reach the endpoint
authenticated, so no row means the account was deleted underneath the request. Handing back a
document about an account that no longer exists would be worse than a 500.

**Sort preferences whose status cannot be resolved are skipped, not exported with a null.** The
foreign key makes that impossible in PostgreSQL; the skip keeps the promise that every key in the
document is one something could be imported against.

**No UI yet.** Server side first, and the profile page's "download my data" and "delete my account"
buttons are a follow-up. The `.http` file carries both requests in the meantime. Nothing about the
endpoints is provisional — the delete is irreversible and takes a password, so the UI it eventually
gets needs a confirmation dialog worth the name, and probably an "export first" nudge in it.

**What this unblocks and what it does not.** It closes step 4 of the data-model plan's sequencing,
and it means every table added from here — playthroughs, reviews, favourites, custom lists — arrives
with the question already asked, at build time. It does **not** give us re-import: the document is
readable and stable but nothing consumes it, and an importer is a Tier 2 feature with its own
conflict-resolution decisions to make. It is not an email or a background job either, both of which
account lifecycle blocks on anyway for confirmation and password reset.
