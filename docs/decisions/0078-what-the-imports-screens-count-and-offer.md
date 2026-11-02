# 0078. What the import's screens count, and what they offer

**Status:** Implemented — #300, #301.

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
- **A wishlisted game was "in no list" (#301).** A game on Grouvee's Wish List shelf and no other is
  imported as an entry with no status and a wishlist item. The commit counted it in `Unlisted`, and the
  result panel said it was "on its own game page rather than in your lists", while `/wishlist` showed
  it. Every export with a wish list did this.

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

### 2. A game on the wishlist has a home, and the panel says it is there

The commit counts a game that is in no list but on the wishlist apart from the others, as
`ImportResultDto.WishlistOnly`. `Unlisted` now means in no list and not on the wishlist, which are the
games that only their own pages show. It counts the wishlist as it stands after the commit, so a game
the user had already wanted, imported with no list, counts as on the wishlist too. The panel says "40 of
them are on your wishlist." before any sentence about games in no list, and offers "See your wishlist"
beside "See your lists".

**Named rather than left out.** The issue offered leaving these games out of `Unlisted` and saying
nothing about them. Then a file of 600 listed games and 40 wanted ones would read "640 games are now in
your lists", which is false of the 40, because the wishlist is an axis and not a list
([0022](0022-entry-surrogate-key-and-the-wishlist-axis.md)).

**Not favourites.** A favourite in no list stays counted as in no list, although the profile's showcase
shows it. The wishlist is where somebody puts a game instead of a list, and the favourites are not. A
favourite in no list is a game somebody loves that the import could not place in a list, such as one the
file says was played without saying how that ended
([0045](0045-an-import-asks-once-about-what-it-will-not-guess.md)). That is a gap its owner may want to
fill, so the sentence that sends them to the game's page is still the right one.

## Consequences

- **Every Grouvee export reads as it did,** apart from the nouns: Grouvee lists a game once, so its
  rows and games are the same number. The two figures differ only when two rows name one game.
- **The result's three counts of games add up.** Games in a list, `WishlistOnly` and `Unlisted` are
  together `Games`. A new place a game can land without a list has to choose which of the last two it
  is counted in.
- **A new count on these screens has to say which it is.** Rows are what the job, the limit and the
  filters count. Games are what the library gains.
