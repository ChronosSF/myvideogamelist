# 0028. A game's community view: every score counts, only published reviews are listed, and neither is server-rendered

**Status:** Implemented

## Context

ROADMAP §7 named the next step after [0027](0027-usernames-and-public-profiles.md): *"a site-wide
score histogram and a game-page review list are the same missing thing viewed twice: an aggregate
over everybody's rows for one game, where everything built so far aggregates one person's rows
across all games."* [0016](0016-scores-carry-their-sample-size.md) had parked the histogram, and
[0025](0025-playthroughs-and-reviews.md) and 0027 had each parked the review list, on that one
missing query shape.

Building it surfaced four things.

**The shape had no index.** Every index on `UserGameEntries` leads with `UserId`, so "this game, for
everybody" could only be answered by walking the whole table. The community completion times already
did exactly that: their comment explains the join side of the access path, and nothing served the
side that selects a game's entries.

**Consent pulls one way and an anonymous aggregate the other.** 0025 and 0027 hold that a default is
not consent and that a private profile publishes nothing. But the community completion times have
always counted every member's playthroughs, profile or no profile, because an aggregate names nobody.

**Crawlability pulls one way and the game page's cache policy the other.** 0027 §9 puts a profile's
reviews in the route loader because *"reviews are the text a crawler came for"*. The game page, by
[0013](0013-http-caching-policy.md), is edge-cached for an hour and servable stale for a day.

**The review form was no longer telling the truth.** Its hint still read *"'Anyone' means this will
appear on your public profile once profiles launch. Nothing is published today either way."* Profiles
launched with 0027, so an author with a public profile was being told that a published review was
unpublished.

## Decision

### 1. One index serves every read about one game

`UserGameEntries (GameId, Score)`, not unique. `GameId` leads, so the member reviews and the community
completion times can select a game's entries and join in from them. `Score` rides along, so the score
read touches no table row: against PostgreSQL 18, `EXPLAIN` shows an Index Only Scan on the new index.
That was checked with sequential scans disabled, because the local table is too small for the planner
to prefer any index. The composite foreign keys from 0025 already index the join side.

It is asserted on the model in `EntryKeyTests`, since nothing the in-memory provider does would notice
it missing.

### 2. The scores count every member; the reviews list only what was published

The two reads cross different gates, and the difference is whether a row names somebody.

**The scores name nobody**, so every score counts, whatever the profile visibility of the account
that gave it — the basis the community times have always had. What a private profile withholds is
somebody's reading of their own library *attached to their name*; a mean over one game attaches to
nobody.

**The reviews name their authors**, so a review is listed only when it is marked public *and* its
author's profile is public. The narrower gate wins, exactly as it does on the profile (0027 §6), and
both conditions are in the query predicate rather than filtered afterwards. The total counts only
what is listed — "3 reviews" over one visible card would announce the other two.

It follows that the author's name can always be linked: there is a profile behind it.

### 3. A mean out of 100, with its count, and a floor of five in front of both it and the distribution

**Mean, not median.** 0025 chose the median for playtime because self-reported hours have a long
idle tail. Scores are bounded to ten values and have no tail to resist. A median of ten discrete
values also moves in whole points, which is ten at a time on a scale out of 100.

**Out of 100, in a `ScoreBadge`.** It is an average of other people, which is what a percentage means
here ([0021](0021-one-control-for-a-score.md)); the badge's new `members` kind sits in the hero after
the critics' and the players'.
Each member's own score stays `N/10` beside their review, on the scale they entered it on.

**`MIN_MEMBER_SCORES` is 5, in the client**, where 0016 puts every display floor: the API reports
the count faithfully and each caller sets its own bar. It is higher than the playthrough floor of 3
because the two pools differ in depth. A counted playthrough needs a type and a duration typed in
after the game is over, while a score is one tap on a star.

**The distribution goes behind the same floor.** Below it, the columns are a handful of individuals'
scores laid out one by one, which says less than the count does and more about each of them than a
reader needs. So under the floor the page says how many members have scored the game and shows
neither a number nor columns. A game with scores under the floor and no reviews shows no section at
all, since "too few to show" would be its only content.

The arithmetic is the profile's. `ScoreSummary` holds the count, mean and distribution for both, so
the two cannot come to disagree about a corrupt score. The document is not the profile's:
`CommunityScoresDto` is its own type, for the reason 0027 §8 gives about public documents.

### 4. Fetched after hydration and never in the loader — the reverse of the profile, on purpose

0027 §9's argument for the loader is sound for a profile and does not carry to a game page, for three
reasons, the first of which decides it.

- **A withdrawal has to take effect when it is made.** `CACHE_GAME` is an hour fresh and a day stale.
  Review text rendered into that HTML would outlive its author making it private, deleting it, or
  making their profile private by up to a day. The profile's own window is five minutes and an hour,
  and 0027 accepted even that only pending ROADMAP D14. D14 invalidates one URL per author; had game
  pages carried review text, it would have had to invalidate every game page an author has ever
  reviewed on each privacy change.
- **The text is already crawlable at its canonical address.** The author's profile renders it on the
  server. A second copy on the game page would add duplicate content, not a page.
- The member most likely to look is the one who has just scored or reviewed the game, for whom an
  hour-old page reads as a failed write. And a public page's time to first byte stays free of a
  database query that crawlers do not need.

### 5. No cache on the server, and the API says so to anything in front of it

**No `IMemoryCache`**, unlike the community times, which cache for five minutes and are evicted by the
playthrough writes beside them. Eviction is per instance (0025 §6), so a cache would keep serving a
withdrawn review from every other instance until its TTL expired. The scores follow the argument
[0023](0023-profile-statistics-derived-at-read-time.md) §1 makes against caching a figure the reader
has just changed. Both reads are bounded by the index.

The scores are counted in C# over one small column, following 0023 §2, so the tests exercise the
arithmetic exactly as it ships. That reads one row per member who scored the game. Revisit it once a
game's scored entries reach the tens of thousands: at that point move the count into SQL and verify it
against PostgreSQL, or cache it.

**Both endpoints send `no-store`**, via `[ResponseCache(NoStore = true, Location = None)]`. On the
wire that is `Cache-Control: no-store,no-cache` and `Pragma: no-cache`. They are the first API
endpoints to state a policy, and the reason is where they are called from: the browser, through
whatever fronts `/api`, and nothing has configured that yet (D12). A response carrying withdrawable
text fails closed on its own, as 0013's root policy does, rather than relying on a cache behaviour
being set up correctly later.

**And the client sends no cookie to either.** Both requests say `credentials: 'omit'`. Leaving the
option unset does not do that: `fetch` defaults to `same-origin`, which sends the sign-in cookie to
our own `/api`. The responses do not vary by reader, so the cookie has nothing to do there — and a
request that never carries one cannot come to depend on it. The community completion times say the
same.

### 6. One hook for both halves, keyed on the game

`useGameCommunity` is called by the page, so the hero's badge and the section share one pair of
requests. The two requests settle together, so the section appears once rather than growing twice.
It sits low in the main column, so what it pushes down when it arrives is below it.

The page stays mounted when a link goes from one game to another, so the hook takes the shape
[0022](0022-entry-surrogate-key-and-the-wishlist-axis.md) settled on for account-scoped state:

- The game id lives in reducer state beside what was fetched for it.
- The change of game is applied during render.
- Every completion is stamped with the game it was started for, and one that no longer matches is
  dropped.

**The reader's own writes ask for it again.** The panel beside it takes an `onCommunityChange`, which
the page wires to the hook's `reload`, and calls it after a score saves, after a review is saved or
deleted, and after everything recorded about the game is deleted. Without that, the member score and
the review list on the same page go on showing the game as it was, which is exactly the look of a
failed write that §4 fetches after hydration to avoid. A reload keeps what is on screen until the new
answer lands, keeps a half that fails to refresh, and starts the review list again from its first page.

### 7. Further pages follow a cursor, never an offset

Further pages come from a button, not links. The profile's pages are URLs so a crawler can reach
them; these are rendered by no server, so a URL per page would name nothing a crawler could read.

**The first cut paged by offset, and an offset can lose a review for good.** Rows move while
somebody reads. Say a reader has page 1 open and a review on it is withdrawn: every later review
moves up one place, so `page=2` now starts one review too late and the review that crossed the
boundary is never shown. Or say a review the reader has not reached is rewritten: it jumps to the
top under most-recently-rewritten ordering, and the same thing happens. The first cut de-duplicated
repeats but could do nothing about skips.

So each page ends with a cursor, `next`, and the button asks for `?after=` it:

- **The order is by `CreatedAt`, newest first**, not by the last rewrite. A review's place in the list
  never changes, so "everything written before the last review I was shown" means the same thing on
  every request. A rewritten review keeps its place, which is a change from the first cut and from
  the profile's order.
- **The review's id breaks a tie** between two reviews written in the same instant, because it is
  the other key that never changes. The next cut tried the author's name, which the page already
  shows, and review found the flaw: a rename — a case-only one skips the cooldown — can carry an
  author across the cursor between two requests, skipping one tied review or showing another twice.
  Every key a cursor is built on has to be immutable, not merely unique.
- **The cursor is encrypted, with ASP.NET Data Protection,** because the id must not reach the
  client: it counts every review ever written site-wide, private and deleted ones included, which is
  why the DTO leaves it out. Protection authenticates as well as hides, so a cursor cannot be forged
  to a position that was never a page boundary. The endpoint's `[RegularExpression]` checks only the
  token's shape, base64url and bounded, before a decryption is spent on it. A token that is shaped
  right but does not decrypt is a 400 too, raised by the service and put beside the parameter by the
  controller, as `EntriesController` does for a playthrough id.
- **A cursor lives as long as the key ring**, exactly as the sign-in cookie does. Where keys are not
  shared or persisted, a cursor issued by one instance fails on another and the reader's next page
  fails until they reload — the same requirement ROADMAP §5 already sets for the cookie, and the
  same fix covers both.
- **A page is one row over-read**, so the last page reports no `next` without a second count.

On the client, a page's answer is stamped with the cursor it continued from as well as with the game.
If the list no longer ends at that cursor, the answer is dropped. That covers a page asked for before
a reload replaced the list, and a double click whose second page would repeat the first.

### 8. The review form says what "Anyone" does for this author

The hint now depends on the author's own profile setting, which the page passes down:

- With a public profile, it says the review shows on the game's page and on the profile.
- With a private one, it says the review is shown nowhere until the profile is public.

The narrower gate is the one that is easy to forget is there.

## Consequences

**The game page carries the community signal Tier 2 asked for**: a member score beside IGDB's two, a
distribution, and the reviews, with spoilers behind a control. Helpful votes are still open. They need
a `ReviewVotes` table, and a per-game list is what they would be ordered in.

**A small sample is readable in the API, as it already was for the completion times.** The endpoint
returns the distribution and its count whatever the size, as 0016 requires. So a game scored by one
member exposes that member's score, unattributed, to anyone who reads the JSON. The client floor keeps
it off the page, but that floor is a presentation rule and not a privacy boundary. This was accepted on
the basis the community medians have always stood on.

If it should become a boundary, the change is a server-side floor on both community endpoints. That
would contradict 0016's "report the count faithfully" for those two endpoints, which is why it is a
decision to make deliberately rather than a fix to slip in.

**Member review text is not indexed from game pages.** Accepted in §4: it is indexed where it
belongs. If game pages ever need that text for search, the price is a short `CACHE_GAME` or D14
invalidating game pages, and either one is a new decision.

**Every reader gets the same responses, including a review's own author.** An author sees their review
in the list only once it is published, and the "You" beside it is a client-side comparison of names.
`friends` would end that: whether a review is visible would depend on who is reading, so neither
endpoint could stay reader-independent. The `no-store` already makes a per-reader response safe to
serve.

**Three pieces are shared now rather than copied.** `ReviewCard` holds the spoiler rule for both
review lists, `ScoreColumns` draws both distributions, and `ScoreSummary` does both histograms'
arithmetic. The CSS moved with them, out of the two profile stylesheets.

**The community completion times got faster for free.** They select a game's entries through the new
index instead of a table walk, with no change of their own.
