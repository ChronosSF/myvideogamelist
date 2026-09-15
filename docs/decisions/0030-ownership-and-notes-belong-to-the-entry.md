# 0030. Ownership and notes belong to the entry, stay private, and are written under the game's lock

**Status:** Implemented

## Context

The last two per-entry fields in Tier 1 were *"own it / subscription / borrowed"* and entry-level
personal notes. [0022](0022-entry-surrogate-key-and-the-wishlist-axis.md) left both columns off on
purpose: a nullable column is cheap to add whenever there is UI for it, and adding them early would
have shipped two columns nothing read. This is that UI, and building it raised questions the plan did
not answer.

**Which row.** [0025](0025-playthroughs-and-reviews.md) moved platform, dates, hours and per-run notes
onto the playthrough, so "a replay on a second platform is another row instead of an overwrite". A
second note field invites the question of why it is not a third.

**Who reads them.** Everything else a user writes about a game has a visibility or is an anonymous
aggregate. A note is neither.

**Where they are written from.** The client rule is that every mutation writing the entry takes the
per-game lock in `ListsProvider`. But that lock lives in a provider whose state is the lists, and
neither field appears in a list.

## Decision

### 1. On the entry, as current state

Both are columns on `UserGameEntries`, overwritten in place like the status and the score.

- **Ownership is about the copy, not the playing.** Whether somebody has a game to keep, through a
  subscription, or borrowed is true of them now, and is overwritten when it changes — a game bought
  after its subscription lapsed. Where they played it is the playthrough's `PlatformId`, and a
  storefront is deliberately not recorded at all.
- **Notes are about the game as a whole**: where a save lives, what to try next time. A playthrough's
  notes are about one run. A review is prose written to be read by other people, which is why it
  carries a visibility and a note does not.

### 2. Three permanent keys, enforced by the database too

`owned`, `subscription` and `borrowed`, or null for "not said". A string with a check constraint rather
than an enum, for the reason `Reviews.Visibility` is one: a fourth value is one additive migration. The
keys are permanent once written, because the export carries them.

The set is written down three times — `[AllowedValues]` on `SetOwnershipDto`, `ListService.OwnershipValues`
and `CK_UserGameEntries_Ownership` — and `EntryOwnershipTests` fails if they ever disagree. A value the
DTO accepts and the database refuses would be a 500; the reverse, a choice nobody can make.
`AllowedValues` refuses null unless null is one of its values, which is the trap the test names.

Notes are bounded to 2,000 characters, as a playthrough's are, and trimmed by the service; blank is no
notes.

### 3. Private, and exported in full

Neither reaches `PublicProfileDto` or any community read, and nothing on a public page mentions them.
Both are in the export, on each entry. A user's notes are theirs to take with them, and ownership is
already a key.

### 4. On the single-entry read, not on the list row

`EntryDetailDto` carries both; `ListEntryDto` carries neither. Fifty rows of notes are payload nobody on
the lists page reads, which is the argument that record already made. Ownership is small, but nothing on
a list view reads it yet either, and a field on the row is a field the list's optimistic state has to
keep true.

### 5. One `PUT` per field, and a clear writes nothing that is not there

`PUT /api/entries/{gameId}/ownership` and `/notes`, beside `/score`, with null clearing. Each control on
the panel saves on its own, and a general "update the entry" would have to tell a field left out from a
field cleared.

Setting a value creates the entry, as a score does. **Clearing a field on a game with no entry creates
nothing**: a row holding only nulls would switch on the panel's "delete my data" for a game the user has
said nothing about. The score keeps its older behaviour and creates the row either way.

Neither writes an event. Neither is a status transition.

### 6. Written under the game's lock, and shown by the panel

`ListsProvider` gained `setOwnership` and `setNotes`. They take the per-game lock like a move or a
score, because they write the same row — a delete racing a notes save could otherwise have the save
recreate the row it had just removed. They change nothing in the provider's state, since no list shows
either field, and return whether the save landed.

The panel holds the values. Ownership is shown the moment it is pressed and put back if the save fails,
as the score is; it is a row of toggles like the statuses, in teal, so pressing the one that is on
clears it. Notes are a form with a Save button, not a field that saves as it is typed in: a request per
keystroke is a request per keystroke, and a note half-typed when the tab closes is better lost than
stored half-finished. The form is keyed on the game, so a draft does not follow the reader to the next
game's page, and the panel drops a save that completes after it has moved on to another game.

## Consequences

**"Delete my data for this game" now names ownership and notes**, and they go with the row. Taking a game
out of every list keeps them, as it keeps the score ([0019](0019-entry-survives-leaving-every-list.md)).

**A column on an existing table trips no ownership guard.** `UserOwnedDataTests` checks tables, and
`ReadEntriesAsync` is a hand-written projection — [0026](0026-a-library-import-records-ownership-not-history.md)
recorded the same trap for its `Origin` column. Both fields were added to the projection by hand, and
`ExportAsync_Entry_CarriesItsOwnershipAndNotes` is what notices if the next column is not.

**Checked against PostgreSQL.** On the local database: clearing ownership on a game with no entry created
no row; setting it and saving padded notes read back as `subscription` and the trimmed text; a direct
`UPDATE` to `'stolen'` was refused by the check constraint; and deleting the entry removed the row and
recorded no event.

**0026's import has somewhere to say what it knows.** It records ownership, and this is now a column it
can write. Which value each imported row gets is for that import's own record to decide.

**A list filter on ownership is the obvious next use**, and the reason it is not here: it needs ownership
on the list row, and with it the provider keeping that field true through every optimistic move.
