# 0095. Start over empties the library in one transaction and keeps the account, and the event log goes with the library

**Status:** Implemented. [#475](https://github.com/ChronosSF/myvideogamelist/pull/475). Makes a second
exception to [0018](0018-append-only-status-event-log.md)'s append-only log, beside the account's deletion
([0024](0024-the-ownership-contract.md) §6), and both are the owner's, behind the password. Adds a tenth
event to [0058](0058-a-withdrawal-leaves-the-edge-when-it-is-made.md) §1, paced as
[0081](0081-a-withdrawal-is-never-refused-and-one-accounts-are-paced.md) §2 paces a game's deletion.
Corrects [0026](0026-a-library-import-records-ownership-not-history.md) §4's claim that `Origin` makes
"undo my import" possible.

## Context

- **Dev runs a public trial whose data moves to production at launch**, so nobody resets it by hand, and
  nobody can reach its database. Testers are about to import their lists, from Grouvee, from our own export
  ([0083](0083-our-own-export-is-imported-as-any-trackers-is.md)), and from formats added for them whose
  first versions will not be right. Somebody whose import went wrong will want to empty their library and
  import again.
- **The only wholesale reset was deleting the account.** Games leave one at a time: `DELETE /api/lists/{id}`
  takes a game out of its list, and `DELETE /api/entries/{id}` deletes everything recorded about it and
  keeps its events. A bulk action over chosen games was declined:
  [#115](https://github.com/ChronosSF/myvideogamelist/issues/115) was closed as not planned, and
  [#299](https://github.com/ChronosSF/myvideogamelist/pull/299) was closed unmerged.
- **Importing again resets nothing.** The review sets every game already held to skip
  ([0037](0037-a-tracker-import-carries-history.md)), and the commit sets `AddedAt` only on the entries it
  creates. A second import over a bad first one keeps the first one's games.
- **`Origin` cannot say which games one import wrote.** 0026 §4 said it makes "undo my import" possible. The
  import sets it only where it writes a status, so an imported game with no status stays `manual`. And it
  stamps an entry the user already had whenever the import moved it, so undoing by `Origin` would delete
  games the user added by hand.

## Decision

### 1. One action, beside the account's deletion, behind the same password

**Start over** is a section of the settings page's *Your data* card, between the download and *Delete
account*: a button, *Empty my library*, and a dialog that asks for the password and offers the download
first. The dialog is the deletion's own, shared as `PasswordConfirmDialog`, so the two confirmations behave
alike: what holds them while a download runs, Escape, the backdrop, and focus going back to the opener.

The endpoint is `DELETE /api/user/library`, and the password is checked with `CheckPasswordAsync` and refused
with a 401, as 0024 §7 decided for the account: a cookie says the browser signed in once, and nothing a start
over deletes comes back. It answers with what it took, counted by the statements that took it, and the card
says so where the button is.

It is not the bulk action #115 and #299 declined. It chooses nothing: it empties the library whole, as the
deletion empties the account whole.

### 2. The library goes and the account stays, and a test makes every table say which

| Goes | Stays |
|---|---|
| Every entry, with its list, score, notes, ownership, position and origin | The account: handle, address, password, Identity's rows |
| Each entry's playthroughs, review and tag links, by PostgreSQL's cascade | The profile: visibility, display name, picture, bio |
| Other members' reports about those reviews, by the same cascade | The look |
| The wishlist | The tags, with no games on them |
| The favourites | The list names and the sort preferences |
| The event log | The import jobs, their receipts, and a pending job's rows |
| | The reports the account made about other people's words |

**The event log goes.** The history page ([0062](0062-the-history-is-three-rows-unioned-and-what-has-no-moment-has-no-item.md)) and the
activity statistics read it. Kept, they would go on listing moves and counting finishes of games the library
no longer holds, which is the opposite of starting over. 0018 makes the log append-only so that the
application never rewrites what somebody did. It was never proof against its owner, whose account's deletion
has always taken it. A start over is the second way, and the only other one: a single game's deletion still
keeps its events, as 0018 asks.

**The tags and the list names stay.** They are settings, not library, and no import brings them back: our own
export, imported, brings each game's list, score, notes, runs and marks, and leaves the tags, the list names
and the event log behind (0083). Somebody about to import again would otherwise retype them.

**Every user-owned table is classified.** `LibraryResetService.Cleared` and `Kept` between them name every
table in the export manifest, and `LibraryResetTests` fails when one is in neither or in both, and when a
cleared table has no `DELETE` of its own and no cascade from one that has. A table added later arrives with
the question asked at build time, as 0024 has every table arrive with the export's and the deletion's.

### 3. One transaction of set-based deletes, and the events before the entries

One `DELETE` per table, nothing loaded, in one transaction through the execution strategy
([0038](0038-where-scheduled-work-lives.md)), committed on `CancellationToken.None`: a tab closed before the
commit rolls all of it back, and a token cancelled after the last statement would only throw a finished start
over away. The cascades are PostgreSQL's, so the in-memory provider runs none of it, and the integration suite
does ([0057](0057-the-api-is-tested-over-a-real-postgresql.md)).

**The order keeps 0026's rule.** A `manual` origin means every status the entry has held has an event behind
it. A game added in another tab is written with its event in one save, and each statement sees what had
committed when it began. Entries first would let that add commit between the two statements: its entry
outlives the first, its event does not outlive the second, and a held game says `manual` with no event behind
its status. Events first, the worst the same race leaves is an event for a game no longer held, which a single
game's deletion leaves on purpose. A stricter isolation level would close the race instead, by refusing with a
serialization failure any start over that overlapped a write to the same rows, and somebody would have to try
again. The order gives the guarantee that matters without refusing anybody.

### 4. A pending import's rows that were skipped for the library are selected again

An upload sets a matched row to skip when its game is already held, so that an import never overwrites what
somebody recorded by hand (§S8 of `specs/csv-list-import.md`). After a start over nothing is held, and those
rows would go on saying skip. So, in the same transaction and before the entries go, every matched row of a
pending import that is on skip and whose game the library holds goes back to import, and its job's
`UpdatedAt` is stamped, since every write to a job is a decision its pending window counts from (0038).

The review cannot tell the upload's skip from one its owner chose for a game they held. Both had the library as
their reason, and the library is what is gone. A row skipped for a game the library does not hold was skipped
by its owner, and stays. A closed job has no rows to change ([0039](0039-an-imports-rows-die-with-its-review.md)).

### 5. A public profile is invalidated at the account's pace, and only when a game went

Every game's deletion at once takes every review with it, so a start over is 0058 §1's seventh event many
times over: `library emptied`, the profile's one path, `/u/{name}*`, after the commit, through
`ProfileWithdrawals`, and only if the profile is public then.

- **Paced, not at once.** Adding a game and starting over again repeats it, with nothing between them that is
  limited. The password is a confirmation, not a limit. So it waits its turn with the account's other
  withdrawals, as a game's deletion does (0081 §2), and the first goes at once.
- **Only when a game went.** Only an entry carries a review. The count is the `DELETE`'s own, which nothing can
  overtake, unlike a question asked before the delete (0058 §1). A start over of an empty library sends
  nothing.
- **Not the sitemap files.** An emptied profile drops out of them, as one emptied a game at a time does
  ([0036](0036-what-a-crawler-is-told.md)), but it is still public, so that is a change to who is listed and
  keeps the files' window.

### 6. No undo by import

Undoing one import would need each entry to record the job that wrote it, and a rule for an entry that job only
moved: back to where it was, which nothing records, or deleted, which loses what the user had. Start over
answers the case at hand, an import that went wrong, without either. If undoing one import is ever wanted, it
is its own issue, and it starts from a job id on the entry, not from `Origin`.

### Rejected

- **Deleting the games one at a time through `ListService`.** Each deletion writes a departure event and keeps
  the log (0018), so a start over would fill the log it means to empty, one statement per game, and send an
  invalidation per game.
- **Keeping the event log.** See §2.
- **Clearing the tags and the list names too.** See §2.
- **Cancelling pending imports**, which deletes their rows and makes the user upload again. Re-selecting keeps
  the review they may be half way through.
- **Leaving pending imports alone**, and telling users to start over before uploading. The natural order is the
  other way round: upload, see every game marked as already held, then start over.
- **A withdrawal sent at once.** See §5.
- **`REPEATABLE READ` or `SERIALIZABLE`.** See §3.

## Consequences

- **0018's log has two ways to be deleted**, the account's and this, both the owner's and both behind the
  password. Nothing else deletes an event.
- **The password is checked as the deletion checks it, and that includes its gap.** `CheckPasswordAsync`
  counts no failure towards the lockout, so a session that is not its owner's can guess the password through
  either endpoint without limit. That is the deletion's behaviour too, and it is left as it is here.
- **A tester's way back is the download, then Start over, then an import of that download** if they want their
  games again: it brings the games back without their history, tags or settings, and a review as notes (0083),
  and the card says so above the download.
- **One log line per start over**, at Information, with the account's id and each count, so a question about a
  library that emptied itself has an answer.
- **Tested.** In memory: the classification against the manifest, the password, and the invalidation for a
  public and a private profile. Against PostgreSQL: a row in every table, each cleared table empty and each kept
  one unchanged, another account untouched, the account still signed in; a wrong password deleting nothing; the
  history emptied; a pending import's rows selected again and committed; a public profile invalidated once and
  paced; an empty library sending nothing. On the client: the dialog, the card's summary and focus, the request,
  and the providers read again.
- **Not tested:** the race in §3, which no test here can arrange deterministically. It rests on PostgreSQL
  giving each statement its own snapshot under `READ COMMITTED`, and on the list write saving the entry and its
  event together.
