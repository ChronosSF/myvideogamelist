# 0019. A user's entry survives the game leaving every list

**Status:** Implemented
**Amends:** [0018](0018-append-only-status-event-log.md)

## Context

Adding a user score exposed a modelling error that had been harmless until then.

`UserGameLists` was named and treated as a list-membership row: `(UserId, GameId)` with a
non-nullable `StatusId`, and `RemoveListEntryAsync` deleted it. Putting a score on that row made
the consequence obvious — **removing a game from your lists would delete your score.**

That is worse than it sounds, because the list controls are toggles. Clicking the status a game
already sits in calls the removal path, so an ordinary mis-click would have silently destroyed a
judgement the user had recorded. And it gets worse as the entry fills up: notes, ownership,
playthroughs and a review are all planned for the same row.

The mistake was conceptual rather than a missing guard. A score is a judgement about a *game*. It
has no relationship to which list the game currently sits in — you can score a game you dropped,
and that is often the most informative score there is. Deleting it as a side effect of
reorganising lists conflates two unrelated things.

## Decision

**The row is the user's record of a game, and status is one field on it.** Renamed accordingly,
`UserGameLists` → `UserGameEntries`, because the old name is what made the error easy to make.

**`StatusId` is nullable.** An entry with no status is a game the user has data about but is not
currently tracking. It appears in no list, and `GetListsAsync` filters it out.

Three operations, with clearly different meanings:

| Operation | Effect |
|---|---|
| Move to a status | Sets `StatusId`, appends an event |
| Remove from lists | Sets `StatusId` to null, appends an event. **Keeps everything else** |
| Delete entry | Deletes the row. The only path that discards a score |

**Deleting everything is explicit and separate**, at `DELETE /api/entries/{gameId}`, and is never a
side effect of a list change. It is surfaced as one deliberate control on the game page rather than
hidden behind a list toggle.

**Scoring a game creates the entry.** A score does not require the game to be in a list first, so
`SetScoreAsync` creates the row with a null status. This is why the entry table cannot be
understood as list membership even in principle.

**A score change appends no event.** The log records status transitions; a score is not one. Score
history, if it is ever wanted, is a separate decision and a separate table.

**The endpoints split by what they describe.** `/api/lists` stays the list-shaped read and the
status write; `/api/entries/{gameId}` owns the score, the single-entry read and the delete. Routing
"clear my score" through a controller called `lists` would misdescribe it.

Scores are constrained to 1–10 in the database as well as by `[Range]` on the DTO. The column
outlives any one validation attribute.

## Consequences

**Statusless rows accumulate**, one per game a user has ever scored or listed and then removed.
They are perhaps thirty bytes each, they carry a genuine `AddedAt`, and the explicit delete is the
intended way to clear them. No cleanup job: a predicate for "this entry holds nothing worth
keeping" would need updating every time a field is added to the entry, which is exactly the kind of
maintenance trap that rots.

**Every read of the entry table must decide about null statuses.** `GetListsAsync` filters them
out; the game page's user panel wants them. A future query that forgets will quietly show games in
lists they are not in, so `StatusId != null` is the default and inclusion is the exception.

**Two sort keys came along with this**, because the same change had to add them for the sortable
list views: `AddedAt` (set once, never updated) and `StatusChangedAt` (moves on every real
transition, including to null). Both were backfilled from `UserGameEvents` — the earliest event for
a (user, game) is when it was added, and the latest is when its status last changed. That is the
event log paying for itself in a way nobody planned, and it only worked because the log shipped
first.

The scaffolded migration for this change dropped and recreated the table, which would have deleted
every entry: EF cannot tell a rename from a delete-and-add. It was rewritten to rename the table
and its constraints in place. **That is now twice in a row that a scaffolded migration would have
destroyed data if run unread** — see also 0018.
