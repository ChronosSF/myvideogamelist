# 0078. What the import's screens count, and what they offer

**Status:** Implemented — #300.

## Context

The import's review and result screens are the first thing a newcomer with a list meets, and before v1
they said several things that were not true.

- **Rows were counted as games (#300).** A row is one line of the file. Two rows can name one game,
  when a source lists a game once per platform or when somebody chooses the same game for two rows, and
  the commit makes one entry of them. #152 taught the result panel to count games and to name the rows
  only when the two differ. Everything before the result still counted rows: the review's "Games in
  file", "Will import" and "Import N games" (which read "Import 1 games" for one row), `/import`'s
  "N games — review" for a waiting job, its receipts' "14 imported, 3 skipped" under "The games are in
  your lists", and the upload's refusal "That export has N games".

## Decision

### 1. Games wherever a row's game is known, rows wherever it is not

The review counts the games the selected rows name: the "Games to import" tile and the commit button,
which now says "game" for one. It also counts the games already in the lists. When the selected rows
name fewer games than there are rows, the tile says how many rows, as the result panel does, so that a
file of 14 rows that will import 11 games does not read as three left out. The counts are taken from the
rows on the client, as "Need a decision" already was. The summary's `Selected` stays a count of rows,
which is what the "Importing" filter lists.

Rows are counted, and called rows, where only rows can be counted. That covers the file's own figure
(the tile is now "In your file", with no noun), a job still waiting on `/import` ("617 rows —
review"), the receipts ("14 rows imported, 3 skipped") and the upload's limit ("That export has 5,001
rows, and the limit is 5,000"). A job that is still waiting has games only for the rows that have been
matched, and its count of rows is what the limit is about. "Row" was already the word the result panel
used ("from 14 rows of your file").

**Not a games count stored on the job.** The receipt could say games if the commit stored how many it
wrote. That would take a column, a migration and a field in the data export, for a line that is kept a
week. The commit's own answer already says it once, where it matters (#152: "answered here and stored
nowhere"). The receipt's sentence over the list no longer claims the games are in the lists, because
the commit can leave some of them in no list.

A row with no game cannot be selected by giving its unrecognised shelf a list either. The checkbox was
already disabled for such a row, but the shelf's list select still set it to import, which listed it
under "Importing" and then had the commit skip it.

## Consequences

- **Every Grouvee export reads as it did,** apart from the nouns: Grouvee lists a game once, so its
  rows and games are the same number. The two figures differ only when two rows name one game.
- **A new count on these screens has to say which it is.** Rows are what the job, the limit and the
  filters count. Games are what the library gains.
