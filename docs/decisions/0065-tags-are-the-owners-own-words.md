# 0065. Tags are the owner's own words: per account, by id on the row, set as a whole, and never published

**Status:** Implemented

## Context

#135 asked for tags on an entry that belong to their user rather than to a global vocabulary, and for a
tag filter on the lists page. `docs/data-model-plan.md` had reserved `Tags` and `UserGameEntryTags`, and
two records had already fixed their shape: both are user-owned, so both cascade from the account and are
in the export manifest ([0024](0024-the-ownership-contract.md)); and a child of the entry carries its own
`UserId` and reaches the entry by `(UserGameEntryId, UserId)` ([0025](0025-playthroughs-and-reviews.md)).

What neither said, and building it had to:

- **What a tag may be called**, whether "Co-op" and "co-op" are one tag, and how many there may be.
- **How a list row carries its tags** — names or ids — and so what a rename costs.
- **How a game's tags are written**: one tag at a time, or the whole set.
- **What ticking two tags in a filter means**, beside a platform filter that lets a game through on any.
- **Where the account's tags live on the client**, given the account guard
  [0022](0022-entry-surrogate-key-and-the-wishlist-axis.md) took three rounds of review to get right.
- **Who else sees them**, and whether changing them is an event.

## Decision

### 1. Two tables, each the user's, and the link a child of both

`Tags (Id, UserId, Name, NormalizedName, CreatedAt)`, unique on `(UserId, NormalizedName)`, with an
alternate key on `(Id, UserId)` that exists only to be referenced.

`UserGameEntryTags (UserGameEntryId, TagId, UserId, AddedAt)`, keyed on the game and the tag, so a tag is on
a game once or not at all. It carries its own `UserId`, for 0025's reason: the ownership guard finds a
user's tables by that column. It reaches the entry by `(UserGameEntryId, UserId)` and the tag by
`(TagId, UserId)`, and both cascade, as does its own key to the account.

The second composite key is the one that matters here. With it, "one account's game carries only that
account's tags" is a constraint: PostgreSQL refuses a link from one account's game to another account's
tag whatever any service does. That was checked on the local database, along with the account's deletion
emptying both tables, in a transaction rolled back. `UserOwnedDataTests` passes unchanged except for its
inventory, which names both.

### 2. A name is the owner's words, and an account has one of each whatever its case

`TagNamePolicy` composes a name to Unicode NFC, trims it, and folds every run of whitespace into one space;
then it must be 1 to 30 characters with no control characters. Punctuation and emoji are fine, for the
reason [0031](0031-a-list-rename-is-a-label-its-owner-sees.md) gives for list names: nobody else reads it
and it is never in a URL. Thirty is room for "Couch co-op with the kids" and still a chip under a cover.
NFC because "café" typed with a combining accent and "café" pasted from somewhere else are two strings and
one word, and two tags that look the same are worse than either. For the same reason an invisible formatting
character is refused — a zero-width space, a byte-order mark, a direction override, which would make a
second "co-op" indistinguishable from the first, a chip with nothing on it, or the text after it read
backwards — except the two joiners emoji and some scripts need and the tag characters a subdivision's flag
is spelt with; joiners alone are no name. A lone surrogate, which JSON can carry, is refused rather than
allowed to throw inside `Normalize`.

Uniqueness ignores case, and is held by a unique index over a folded column, `NormalizedName`, rather than
by a check before the insert — review found on #167 that an index over the spelling alone let two
spellings in at once, and Identity keeps a username unique the same way.

### 3. Two hundred tags an account and twenty a game, as bounds rather than invariants

The account's cap is checked by counting before an insert, as the import's pending cap is. Creates in flight
together at 199 can each land: the overshoot is as many as one account sends at once, nothing reads the
count as a fact, and a lock to prevent it is not worth what it would cost every create. The game's cap is
on the request, by attribute, and again in the service. Two tabs writing one game's set in the same instant
can leave the union of both: without a lock on the entry — which the in-memory provider the tests run on
cannot take — neither write sees the other's links. The next write from either tab replaces the set, and
nothing reads the set as a count.

### 4. The row carries ids, and the names are a read of their own

`ListEntryDto` gains `TagIds`. The names, and how many games carry each, come from `GET /api/tags`, once
per sign-in. So a rename changes one row of that answer and nothing on the lists, and a deleted tag's id
left on a row this tab loaded earlier is simply not drawn: every reader goes through the account's tags.
The single-entry read carries the ids on its `entry`, like every other list-shaped field; the lists read
fetches the links of games in a list and no others, since a game in no list is in none of its rows and a
tag write can make an entry for any game. Both reads, like `/api/tags`, answer `no-store`.

Names on the row were the alternative, and would have made a rename rewrite every row the client holds and
put each name on the wire once per game.

A count includes games that are in no list. Taking a game out of every list keeps its entry and so its
tags, as it keeps its score ([0019](0019-entry-survives-leaving-every-list.md)).

### 5. One write sets a game's whole set

`PUT /api/entries/{gameId}/tags` takes `{ tagIds }` and makes that exactly the game's set; an empty list
takes every tag off. One change on the panel is one request, and its undo is the set as it was.

- **An id that is not one of the caller's tags is a 400 beside the field**, and nothing is written —
  refused whole, never filtered, because a set stored without one of its tags would be answered as saved
  while the client went on showing it. A tag named twice is carried once.
- **A set to hold creates the entry, with no status; an empty set on a game with no entry creates
  nothing**, by [0030](0030-ownership-and-notes-belong-to-the-entry.md) §5's reasoning.
- **It is a diff rather than a delete and a re-insert**, so a tag that stays keeps the moment it was put on
  the game. Checked on PostgreSQL: a tag kept through a change of set kept its `AddedAt`.
- **A row that moves between the read and the save** — a link already deleted, one already added by
  another tab, a tag deleted, two first writes for one game both creating its entry — rolls the save back
  whole. The change tracker is cleared and the write starts again from its read, which re-checks the tags,
  so a deleted one comes back as the 400 rather than as a 500. Three attempts, so a pathological run ends in
  an error rather than a loop.

### 6. A create answers with the tag of that name, a rename keeps the games, a delete takes it off them

`POST /api/tags` answers 201 with a new tag, or 200 with the one the account already has under that name in
any case: a tab whose list of tags is out of date, or a press sent twice, gets the tag it asked for rather
than an error. The cap is checked only when a row would be made. Two creates of one name racing each
other are settled by the unique index and confirmed by reading again, as `GameAxisStore` confirms its
race, never by matching a provider's error code.

`PUT /api/tags/{id}` renames, and every game keeps the tag. Its own name in another case is a rename;
another tag's name is refused with that tag's spelling, not merged — folding two tags into one is a
different act from renaming one.

`DELETE /api/tags/{id}` takes the tag off every game. The service deletes the links itself, in the same save
as the tag, rather than leaving it to the cascade alone: the behaviour then does not depend on which
provider is underneath, which is what lets a test say a deleted tag leaves no game carrying it. The cascade
stays the backstop for a link added after the read.

Another account's tag is a 404 to a rename or a delete, the same answer as one that does not exist.

### 7. The owner's alone

No tag reaches `PublicProfileDto`, a game's community view, the sitemap or anything else an anonymous
caller can read. The public profile is assembled field by field ([0027](0027-usernames-and-public-profiles.md)
§8), so this holds by construction, and `TagPrivacyTests` makes it fail loudly if it stops: it walks the
response types of every action reachable without signing in and finds no `TagDto`, no `ListEntryDto`, no
`EntryDetailDto` and no field shaped like a tag's — a name ending in `Tag`, `Tags`, `TagId(s)` or
`TagName(s)`. Because a walk of types sees only what an action declares, the same test refuses an anonymous
action that does not declare its answer as `ActionResult<T>`; none does today. Publishing tags
would be a field added to the public document on purpose, with the moderation question answered first —
the same door 0031 left for list names.

One thing about a tag does reach a public reader, and it is a count rather than a tag. A tag put on a game
the owner has said nothing else about makes an entry (decision 5), and the public profile's `recorded`
figure and the sitemap's test for an empty profile count entries — exactly as they already count one that
holds only notes or an ownership ([0030](0030-ownership-and-notes-belong-to-the-entry.md)). No name, id or
game is published; the figure moves by one. Counting only entries that hold something public is a change to
the profile's statistics rather than to tags, and is #346.

### 8. No event and no status

A tag is not a status ([0018](0018-append-only-status-event-log.md)): a game carries any number at once and
moving between them has no *from*. Nothing in `TagService` appends to `UserGameEvents` or writes
`StatusId`, and tests pin both. The link's `AddedAt` is the whole history a tag keeps, as `AddedAt` is the
wishlist's (0022 §3).

### 9. Exported by name

The export gains `tags` — each tag's name and when it was made, including one no game carries — and
`entryTags` — the game's IGDB id, the tag's name, and when it went on. No surrogate id in either, as a status
is exported by its key rather than its seeded id (0024 §4); the name is unique per account, so it is the
key anything reading the document can join on. Both are ordered so that two exports of unchanged data are
byte-identical.

### 10. On the client

**The account's tags are a `TagsProvider` built on `useAccountResource`**, the account guard written once:
the account in the reducer beside the data, every completion stamped and dropped on a mismatch, the
transition applied during render. It is not a fourth copy of that guard, and a create still out when the
account changes cannot put the previous account's tag in front of the next one. Nothing in it is
optimistic — a new tag has no id until the server gives it one, and a rename or a delete has to be able to
refuse beside the field — and the counts move by one game's change once the server has stored it.

**A game's tags are `ListsProvider.setTags`**, under the per-game lock, shown on the row at once and put back
if the save fails. The undo touches that game's tags and nothing else, from the value captured under the
lock, and is session-stamped like every other action a mutation raises. The lock matters more here than for
the notes: the tags are on the row, so a move of the same game rolling back would put its row back as it was
captured, tags and all, over a write that had succeeded. It shares one writer, and one reducer action for a
row's own fields, with the score — the next field on the row joins them rather than becoming a third copy —
and a refusal comes back with the server's own sentence, which for a tag deleted in another tab says to
reload. A read of the account's tags that was out when a write landed is followed by another, so its older
answer cannot take the write away.

**The editor is on the game page's panel**, beside the ownership and the notes it shares the entry with. It
is an ARIA combobox over the account's tags. Enter commits exactly what was typed — the account's tag of
that name in any case, or a new one made there and then — and the suggestions are reached with the arrow
keys or the pointer, with nothing highlighted until somebody highlights it, so a tag nobody chose is never
the one that lands. Each change is saved at once, as the ownership toggles are. While a write is out nothing
is committed, and the editor says so, but nothing is disabled either: a disabled input drops the focus, and
the next tag is being typed into it. Each change is announced in a polite live region, a failure in an
alert.

A new tag is two requests, the tag and then the game's set, and for the time between them the panel treats
the game as locked: its own controls are the only other writers of the entry — the delete's own question
included — and holding them is what keeps the set-write from overlapping a move, a score, or a delete it
would otherwise undo by making the entry again. The box is cleared only once both have landed, so a name
the server refused is still there to correct. The set it sends keeps any id this tab's tags do not
know — one made in another tab — so a change here never takes off a tag it could not show, and the panel
asks for the account's tags again, once.

**Tags are drawn on the lists page as chips** — on a tile through a slot under `GameCard`'s title, and under
the title in the table — in three new tokens, `tag-300`, `tag-800` and `tag-900`, orange, so the owner's
words are never taken for IGDB's genres beside them.

**The tag filter sits beside the platform filter**, through a slot on `ListToolbar`, and offers the
account's tags that some game in the lists carries. A game passes when it carries **every** tag ticked,
where the platforms let a game through on any: a platform is an alternative — the game is on PS5 or Switch —
while a tag is a facet of the game, and "co-op" with "short" is a question about one game. The panel says so
in words. It is client-side and transient, like the platforms
([0020](0020-list-view-preferences-in-the-database.md)): nothing is saved. The ticks carry the account they
were made under and count only while that account is on screen, and only while their tag is still offered,
so a sign-in on the page never filters by another account's ids and a deleted tag never leaves an invisible
filter matching nothing. That is page state with nothing asynchronous in it, so it is derived at render
rather than given a reducer of its own.

**Renaming and deleting are on `/user`**, in a card beside the list names, because both are words the owner
chose that only the owner sees. Neither is optimistic. A delete asks first, inline, saying how many games
the tag comes off.

## Consequences

**Every signed-in page load makes one more request**, `GET /api/tags`, from a provider around the pages, for
the reason [0029](0029-favourites-are-an-axis-and-a-showcase.md) accepted the favourites': a row carries only
ids, and every page drawing one needs the names the moment it renders.

**A game coming back from no list is drawn without its tags until the next load.** `addToList` builds that
row from nothing, as it builds its score, which comes back empty in the same way. A move that answers with
the entry's own fields — `EntryStateDto` in the open #299 — closes it for the score and the ownership, and
`TagIds` belongs in that answer when the two meet (#345).

**The race paths are reasoned, not exercised.** The set-write's and the delete's retries, and the unique
index settling two creates, run only when two requests interleave inside one save, which neither the
in-memory provider nor a single browser produces. The constraints they lean on were checked on PostgreSQL;
the retries themselves were not driven.

**What this leaves.** Tagging several games at once from the lists page's selection — the selection #115 asks
for — is #344. A filter for games with no tags, merging two tags, and choosing a tag's colour are not built,
and nothing here makes any of them harder.

**The plan's row is closed.** `docs/data-model-plan.md` no longer lists the two tables as still to build.
