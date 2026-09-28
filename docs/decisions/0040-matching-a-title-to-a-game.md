# 0040. Matching a title to a game, when we would rather not answer

**Status:** Implemented

Builds on [0037](0037-a-tracker-import-carries-history.md), whose decision 2 deferred this
deliberately, and revises `specs/csv-list-import.md` §4 — written in August 2026 without either a
real export or a live look at what IGDB answers a search with.

## Context

0037 shipped the import without a matcher, because Grouvee's export carries `igdb_id` on 606 of its
608 rows and building the hard half against no working whole would have been the wrong order. It
named the condition for building one: *"the sources that have no ids, against a preset that already
works"*. Those sources are next — the spec's §2 puts HowLongToBeat at P1 and marks Backloggery
*"free-text titles, no database ids, matching is hardest"* — and the matcher is the one part of them
buildable before a sample file is in hand, since it needs titles and IGDB rather than an export.

The spec's §4 describes it in four requirements: normalise and compare (M1), three confidence tiers
(M2), offer up to five candidates for the middle one (M3), let the user search or skip (M4). The
shape is right. Two of its assumptions are not, and both were found by asking live IGDB rather than
by reasoning.

### IGDB holds a row per release, not a row per game

§M2 defines an automatic match as *"exact normalised title, single candidate, year within ±1"*.
**"Single candidate" is close to never true for a game anybody owns.** Searched while this was
written:

| Searched for | Rows carrying that exact title | Ratings on each |
|---|---|---|
| Final Fantasy VII | **7** | 1,633 · 42 · 18 · 9 · 0 · 0 · 0 |
| Resident Evil 2 | **6** | 1,440 · 604 · 0 · 0 · 0 · 0 |
| Hollow Knight | **2** | 2,248 · 0 |
| Assassin's Creed II | **2** | 3,221 · 30 |
| The Legend of Zelda: Ocarina of Time | **2** | 2,168 · 0 |

The extras are regional releases, console ports and re-releases. A matcher built on §M2 as written
would send nearly every popular row to be resolved by hand, which for a five-thousand-row import is
the same as not having a matcher.

The same figures contain the way out. In every case the row people actually track is one or two
orders of magnitude ahead of the stubs beside it — and where two rows both have a real following,
they are genuinely different games that their owners keep apart: Resident Evil 2's 1998 original and
2019 remake at 604 and 1,440, Shadow of the Colossus at 1,339 and 389, Doom's 1993 and 2016 entries
at 1,000 and 1,949.

### Three smaller findings from the same session

- **IGDB's search is not fuzzy.** "Resedent Evil" returns nothing at all. Any similarity threshold
  here governs how a returned title is *scored*, never whether a misspelled row finds anything.
- **IGDB folds numerals itself.** "Final Fantasy 7" and "Final Fantasy VII" return byte-identical
  results, so the search term does not need our normalisation to reach the right rows.
- **Dropping the leading article makes the results worse.** "Legend of Zelda Ocarina of Time" ranks
  the canonical row below four bundles and side editions; "The Legend of Zelda: Ocarina of Time"
  does not.

## Decision

### 1. Two keys, and only the conservative one may answer

`ImportTitle.Normalise` removes what is a difference between two spellings of one name: case,
accents, punctuation, ampersands, a leading article, roman numerals up to thirty. `WithoutEdition`
then also removes a trailing edition, remaster, cut or remake.

**Only the first may produce an automatic match.** The second exists to put a candidate in front of
somebody, and is allowed to be generous — including entries like `remake` and `redux` that name a
genuinely different release — precisely because nothing it produces can be chosen on their behalf.
"Dark Souls Remastered" therefore matches "Dark Souls: Remastered" outright and merely offers
"Dark Souls".

This is the whole safety argument, and it follows from the costs not being symmetric. A wrong
automatic match is pre-checked on the review screen and writes a game its owner never played into a
library they will not audit. A missed one costs a click.

The numeral fold stops at thirty for the same kind of reason. Every letter of a roman numeral is
also an ordinary letter — `MIX` is a canonical 1009, `CIV` a canonical 104 — so an unbounded fold
rewrites real words. Stopping at thirty covers every sequel number and needs only `i`, `v` and `x`.

### 2. The numbers in a title are compared as a set of their own

"Dark Souls" and "Dark Souls 3" share nine of their eleven letter pairs; "FIFA 14" and "FIFA 15"
differ by one character. A character-similarity score ranks both pairs as near-identical, which is
exactly backwards. So the integers in a normalised title are compared separately, and a candidate
whose numbers are not the query's is penalised past the floor — a rejection written as arithmetic,
because "Dark Souls 3" is not an unrelated string to "Dark Souls", it is a wrong answer that looks
like a right one.

### 3. How many people rate a row is what tells a release from a stub

Among identically titled candidates that the year has not ruled out, one may still be the answer —
but only when the others are not rivals at all. `ImportMatching.DominantFollowing` is ten: every
stub measured is more than thirty times behind its canonical row, and every pair of genuinely
different games is within four. `MinimumFollowing` is twenty-five, so that one rating against none
is not a landslide; the least-followed canonical row measured, Wario Land 4, has seventy-nine.

`GameDto.RatingCount` is IGDB's `total_rating_count`, and it is used here as a measure of **how many
people track this row**, not of how good the game is. That is a different claim from the one
[0016](0016-scores-carry-their-sample-size.md) makes about scores, and it is why no score is read.

The same floor gates a second thing, which the first live run found. A candidate reached only by
**loosening** — an edition suffix stripped, or a near miss scored — must clear `MinimumFollowing`
to be offered at all. An exact title is exempt, so a genuinely obscure game still matches on its
own name. See the run below for what that is protecting against.

### 4. The search term is the user's own spelling

IGDB decides which candidates exist; we only rank them. So the term sent is
`ImportTitle.Tidy` — the raw title with trademark symbols, control characters and repeated
whitespace removed and nothing else — rather than the key the matching compares on. Stripping
articles or rewriting numerals before searching is guessing at somebody else's tokeniser, and the
Ocarina of Time measurement above is what guessing wrong costs.

### 5. Truncating a candidate list manufactures confidence

The dominance rule in decision 3 can only weigh what it has been shown, so **a short list does not
degrade to "ask the user" — it degrades to a confident wrong answer.** Searching for "Resident
Evil" puts the 1996 original at position thirteen behind six bundles and four re-releases; shown ten
results the matcher sees only the 2002 remake among unrated neighbours, finds it dominant, and
resolves the row to a game nobody played. Shown twenty it sees the original as well, finds two
comparable releases, and asks.

So `ImportMatcher.CandidatePool` is twenty — the page the browse listing already asks IGDB for — and
`ImportMatching` makes its decision over **everything** that cleared the floor, cutting to §M3's
five only afterwards. The two are one rule at two scales, and both are tested.

### 6. A pass is bounded, repeatable and asked for — which is why there is still no queue

§M6 says matching runs as a background job and never inside the upload request. The second half
stands and is kept: the upload still makes no network call at all, for 0037's reason. The first half
is answered differently.

`POST /api/import/jobs/{id}/match` resolves at most `ImportMatcher.MaxLookups` distinct titles and
answers with **the rows it examined and nothing else**. The client merges them into the review it
already holds and calls again until a pass examines nothing. That gives §C4's resumability — a pass
is its own transaction, so closing the tab costs only the rows nobody had looked at yet — without a
queue, a second state machine, or a second `BackgroundService` beside the one
[0038](0038-where-scheduled-work-lives.md) argues should stay alone. Twenty lookups is about five
seconds at IGDB's four-a-second, which is a request a person will sit through.

Answering with the whole refreshed review was the first shape, and it is quadratic in a way that
only shows at the size this feature exists for. A five-thousand-row id-less export is about two
hundred and fifty passes; rebuilding the review on each means re-reading five thousand rows,
deserialising five thousand payloads and re-serialising a growing response every time — on the
order of a gigabyte of JSON produced, sent and parsed to import one file. A pass answers for what
it touched, which is what it knew anyway.

It also gives the client something exact to stop on. Diffing a count between two snapshots infers
that the server is still working; a pass that hands back no row it moved states it.

It is a `POST` although it reads like a search, because it writes to the rows, moves the job's
retention clock and spends a third party's rate limit ([0033](0033-what-the-api-refuses.md)).

### 7. "Not looked at" and "looked at, nothing found" are different states, so they are two states

`ImportMatchKinds` gains `unlooked`, and a row whose file named no game is created with it. Without
that distinction the two are indistinguishable, and every pass would spend its whole IGDB budget
re-asking the same unanswerable questions instead of reaching the rows behind them.

It belongs on `MatchKind` rather than on the candidate list, which is the first place it was put.
`MatchKind` is already the column that holds what we made of a row, so inferring a fourth state
from a null somewhere else made it the one state that could not be counted, rendered or recounted
like the other three: the summary had to count it off entities while everything beside it counted
DTOs, the client could not recompute it at all after a local edit, and the export published a null
that only made sense with this record open. One `const string` retires all three.

`ImportRow.Candidates` is then only ever the ids a pass offered, and is an ordinary
`integer[] NOT NULL` — a list of ids rather than a document, with nothing to serialise on the way
past.

### 8. An IGDB failure is a failure, not an empty result

The matcher does not swallow one. "Nothing matched" is a sentence somebody acts on by giving up on
their import; "IGDB is unreachable" is one they act on by trying again later. The exception travels
and becomes the 502 `UpstreamFailureHandler` makes of every third-party failure
([0034](0034-failing-in-one-shape.md)), and because a failed pass writes nothing, repeating it is
free.

## What the first run against real IGDB showed

`scripts/make-matcher-fixture.mjs` emits a Grouvee-shaped export with no ids and twenty-seven rows
chosen to land on a different branch each, together with the outcome predicted for every one. Run
through the whole pipeline — upload, two matching passes, commit — it came back **14 matched, 6
ambiguous, 7 unmatched against a predicted 14/6/7**, and every matched row reached the id this
record names.

Two rows landed elsewhere, and they cancelled out in the totals:

**"Ocarina of Time" was answered with "Ocarina of Time Redux" — a ROM hack with no ratings — as its
only candidate.** Stripping `redux` collapses that title onto the famous name, while the real
game's own title is too far from the bare subtitle to score. Decision 1 argued the edition list
could be generous *because nothing it produces can be matched automatically*, and that was true:
this was offered, not chosen. What it missed is that IGDB's long tail is full of hacks, bundles and
fan projects wearing famous names, and a **sole plausible wrong answer is worse than none** — it is
what teaches somebody clicking through six hundred rows to stop reading them. The same search
padded the Shadow of the Colossus picker with two zero-rating editions and the Ratchet & Clank one
with a 2026 entry. Hence the second use of `MinimumFollowing` in decision 3.

**"Portal 2 Game of the Year Edition" was unmatched rather than ambiguous**, because IGDB returns
nothing resembling Portal 2 for that whole string. A recall limit rather than a scoring one, and
not something this end can fix.

The run also confirmed what the pool size is for. The canonical Ocarina of Time sits **sixth** in
IGDB's results and Super Mario Bros. 3 **seventh**; both matched correctly at twenty, and both
would have resolved to an unrated stub at ten.

And it confirmed the two rows worth arguing about when the similarity floor is retuned: "Ocarina of
Time" and "Pokemon Red" both fail it with the right game present in the results — the first against
"The Legend of Zelda: Ocarina of Time", the second against "Pokémon Red Version".

The commit half held too, against PostgreSQL rather than the in-memory provider the unit tests use:
no `UserGameEvents` written, no `StatusChangedAt`, no playthroughs from rows whose
`seconds_played` is 0 and whose dates are `"None"`, and no `ImportRow`s left behind
([0039](0039-an-imports-rows-die-with-its-review.md)).

Re-run after the following floor was extended to loosened candidates, the same file on a fresh
account gave exactly what the change predicted and nothing more: "Ocarina of Time" fell back to
unmatched, Shadow of the Colossus lost the two zero-rating editions padding its picker, and all
fourteen matched rows reached the same ids as before. **Ratchet & Clank kept all four of its
candidates, including a 2026 entry with no ratings** — every one of them is titled exactly "Ratchet
& Clank", and an exact title is exempt. That is the exemption doing its job rather than a gap in
the rule, and it is the shape of what the rule costs: IGDB's placeholder future entries can pad a
picker whenever they share a name exactly. Worth watching when a real id-less export arrives, not
worth narrowing the exemption for — dropping it fails eleven tests, all of them about games nobody
has rated still being matchable under their own name.

## Consequences

**`ImportMatchKinds` went from two states to four.** 0037 left `ambiguous` out on the grounds that
*"a state nothing writes is a state nothing tests"*. Something writes it now: the review screen
renders its candidates with cover art and year, and choosing one resolves and selects the row in a
click. `unlooked` joins it for decision 7's reason. The client's `IMPORT_MATCH` gained both, and a
migration rewrites the rows that used to say `unmatched` when they meant `unlooked` — before it
there was no other way for a row with no game to exist, so the backfill is exact rather than a
guess.

**`IGameCacheService` gained `StoreAsync`.** A pass has the candidate games in hand from the search,
and the review screen reads every game back through the cache; without warming it, the read straight
after a pass would ask IGDB again for up to a hundred ids that were in hand a moment before. Only
the games a result actually names are stored — a search returns twenty and most of them lose.

**The similarity floor is the one number here that is reasoned rather than measured**, because no
export without ids has been read. It is a named constant with a test on each side of it, and the
first real HowLongToBeat or Backloggery file should be used to move it with an argument. Everything
about following and candidate-pool size came off live IGDB and is quoted with its figures above.

**§M4's inline search is not built.** A row the matcher could not place is still resolved only by
its owner going elsewhere for an id. The endpoint to search IGDB already exists and the decision
endpoint already accepts a chosen `GameId`, so this is a screen rather than a mechanism — but it is
not done, and a preset whose rows mostly fail to match would need it.

**§M7 is still open.** A re-imported file matches from scratch, because nothing keys a resolved
match to a title across jobs. Playthroughs are already idempotent by their own key, so a second
import does not duplicate runs; it does duplicate the matching work.

**Backloggery's rows remain the hard case, and §9's open question 2 now has an answer.** A title-only
match is worth offering: the following signal resolves a single-IGDB-row game outright even with no
year at all, which is what Hollow Knight demonstrates. What it cannot do is separate two well-tracked
releases of one name without a year, and those rows become candidate pickers rather than guesses.
