# 0043. An import asks once about what it will not guess

**Status:** Implemented
**Amends:** [0037](0037-a-tracker-import-carries-history.md), decision 3

## Context

0037 decision 3 sends a Grouvee game on the *Played* shelf with no finish date to an entry with no
status. That is [0026](0026-a-library-import-records-ownership-not-history.md)'s answer to its
ambiguous bucket: Played means "I have played this", and choosing Finished, Dropped or On Hold for
it would be a guess.

The first import of a whole real library showed what that answer costs. Of 617 rows, 457 landed in
no list: 448 Played games with no finish date, and nine that were on no shelf at all.
[0019](0019-entry-survives-leaving-every-list.md) is explicit that an entry with no status appears
in no list, so they were saved, scores and all, and the only place any of them showed was its own
game page. The result screen meanwhile said "617 games are now in your lists".

This is not one user's quirk. Grouvee added playthroughs, and finish dates with them, after it
already had shelves. Anybody who used it before then has a library of Played games with no dates,
unless they went back and added them. For that user the bucket is not 0026's residue, it is most of
the library — and they usually know the answer for nearly all of it. What they could not do was say
so, short of opening hundreds of game pages.

## Decision

**The import still guesses nothing, and its owner answers for the whole bucket in one choice.**

- The source **flags** the rows it leaves without a status for this reason
  (`ImportRowPayload.PlayedUnresolved`), apart from a null status for any other reason. A game only
  on the wishlist has none because nobody played it, and one only in a play log has none because it
  was taken off every shelf; neither is in the group.
- The review screen **asks once**, above the rows: put them in no list, or in any of the five.
  **No list is the default**, which is 0026's and 0037's rule kept — nothing lands in a list its
  owner did not choose — and it stays one choice away until the commit.
- `PUT /api/import/jobs/{id}/played-status` takes **a list and never row ids**. Which rows are in
  the group is the server's to decide, so the group answered for is exactly the one the review
  counted.
- A status chosen this way is **written as one the file carried**: `Origin` names the source and no
  event is written (0026 §2, 0037 decision 5). It is its owner's answer, but an answer about the past
  given on the day of the import, and an event would date it to that day.
- The result **says how many of the games it wrote are in no list**, rather than that they are all
  in the user's lists.

### Rejected

- **Defaulting the bucket to Finished.** Right for the user who found this, wrong for anybody whose
  Played shelf holds abandoned games, and exactly the guess 0026 refused — made silently, for them.
- **A status choice per row.** Four hundred selects is the problem restated.
- **Sorting them afterwards, from a view of the entries in no list.** That view is worth having: the
  Steam import ([#124](https://github.com/ChronosSF/myvideogamelist/issues/124)) will put whole
  libraries there, and 0019's own leftovers need it. But its bulk moves would go through
  `ListService` and write an event per game, dated the day of the move. That is a true record of a
  move made that day, and the wrong one for an import of old history. The review is where the
  question belongs, before anything is written.

## Consequences

**A platform import gets the same question for free.** 0026 sends a played Steam game to the same
place, so the Steam source sets the same flag. Nothing about the screen or the endpoint is
Grouvee's.

**The group is marked in the payload, not in a column.** The endpoint reads every row of the job to
find it, which is a read the review already makes to render the screen. A review that stops reading
every row is the moment to add a column.

**The unshelved games still land in no list**, and the result now says how many. Answering those is
the no-list view above, which this does not build.
