# Spec — Profile statistics tiers

Status: **proposed — the split is decided (2026-09-24, and the home strip on 2026-10-25), the build is #149**
Relates to: ADR [0010](../docs/decisions/0010-monetization-model.md) (the free/paid line), ADR
[0023](../docs/decisions/0023-profile-statistics-derived-at-read-time.md) (how every figure is
derived), ADR [0027](../docs/decisions/0027-usernames-and-public-profiles.md) §8 (the public
document is assembled field by field), ADR
[0029](../docs/decisions/0029-favourites-are-an-axis-and-a-showcase.md) (favourites are the
showcase). #149 builds it; #142 (Stripe) supplies the real entitlement.

---

## 1. Why this exists

0010's rule is *sell depth, convenience and quiet, not access*: the core tracking loop stays
unlimited and free, and the paid tier is what a tracker can tell you about yourself once it has
your data. The statistics page is exactly that depth — the completion rate, the score histogram,
the monthly chart, the longest streak, the median time to finish, the hours by platform — and 0010's
table has always had it on the paid side. What the table never said is *where the line falls*,
figure by figure, and 0010's last consequence says that line has to be drawn before launch,
because drawing it afterwards is the retroactive tightening Trakt was punished for.

The full page ships free today, so this is the one free-tier limit that removes something rather
than adds it. That costs nothing now: nobody but the owner has an account. It would cost trust
later.

Privacy is not on this line and never was. A profile is private by default and stays free to keep
private ([0027](../docs/decisions/0027-usernames-and-public-profiles.md) §5); the plan's old table
row that sold a private profile as paid is gone.

## 2. The two tiers

One rule decides every figure, so a figure added later lands on the right side without a debate:

- **Basic** — where the account stands now: a *count* of things as they stand — games, per status,
  on the wishlist, favourited, reviewed — and the three running totals the home strip shows: games
  finished this year, hours logged, and the current finishing streak. Counting is not analysis, and
  a total so far is the figure somebody checks on the way in.
- **Full** — anything that reads the history back: a rate, a mean, a distribution, a median, a
  series over time, a record such as the longest streak, a duration such as the time to finish, a
  breakdown by platform or genre.

The three running totals were full until 2026-10-25, when the strip they make was kept as it is for
every account (§3.3). They are the whole exception, and named one by one so that it does not grow:
a total over another period — finished this month, started this year — is a slice of the monthly
series, and full.

Applied to everything the two documents carry today:

| Figure | Where it comes from | Tier |
|---|---|---|
| Games tracked, and recorded in all | `LibraryStatsDto.Tracked`, `Recorded` | Basic |
| Count per status — playing, backlog, on hold, finished, dropped | `LibraryStatsDto.ByStatus` | Basic |
| Wishlist size | `LibraryStatsDto.Wishlisted` | Basic |
| Favourites — the count and the showcase | `UserFavourites` | Basic |
| Public reviews — the count and the list | `Reviews` | Basic (reviews are content, not statistics) |
| Tracking here since | `ActivityStatsDto.LogStartedAt` | Basic |
| Completion rate | `LibraryStatsDto.CompletionRate` | Full |
| Mean score and the score distribution | `ScoreStatsDto` | Full — the scored count appears only as the mean's caption, so it goes with it |
| Finished this year | Counted from `ActivityStatsDto.Months` today; a field of its own on a basic document (§4) | Basic — a running total, on the home strip |
| The current finishing streak | `ActivityStatsDto.CurrentStreakMonths` | Basic — a running total, on the home strip |
| Hours logged — total, playthroughs, how many carried hours | `PlaytimeStatsDto` | Basic — the total is on the home strip, and the other two are counts |
| Started / finished / dropped by month | `ActivityStatsDto.Months` | Full |
| The longest finishing streak | `ActivityStatsDto.LongestStreakMonths` | Full — a record |
| Status changes, all time | `ActivityStatsDto.Transitions` | Full |
| Time to finish — median and longest active time | `ActivityStatsDto.TimeToFinish` | Full, **owner only** (0027 §8) |
| Most played on — hours by platform | `PlaytimeStatsDto.ByPlatform` | Full, **owner only** (0027 §8) |
| Library composition by platform and by genre | Counted on the client from the lists (0023) | Full |
| Yearly recap | Not built (#136) | Full, as 0010 already has it |

Nothing here is a new figure and nothing is computed differently. The tier decides what is
*copied out* of the documents 0023 already derives, in the same place 0027 §8 already decides
what is copied out for a visitor.

**The owner's history is not in this table yet.** `/api/user/history` (ADR
[0062](../docs/decisions/0062-the-history-is-three-rows-unioned-and-what-has-no-moment-has-no-item.md))
lists the owner's own records back to them, each with its date: a move, a score, a run's start or
finish. It derives no figure from them, beyond two counts of what it cannot list. So it is neither of
§2's kinds, and where it falls is question 5 in §8. It is on the owner's page only, never a visitor's.

## 3. Where each tier shows

### 3.1 The owner's own page — `/user`

**Paid.** The page as it is today: six tiles (games tracked, completion rate, mean score, finished
this year, hours logged, month streak), *Where your games sit*, *How you score*, *What you start and
finish*, *How long games take you*, *Most played on*, *Most of your games are on*, *And they tend to
be*.

**Free.** The favourites showcase (already above the section), four tiles — *games tracked*,
*finished this year*, *hours logged* and *month streak*, the streak's hint without the best, which
is full — and *Where your games sit* with its wishlist caption: every one of them basic. In place
of the full sections, one panel that says plainly what the paid tier adds, as a list of the figures
by name. No blurred chart, no sample data, no figure the account is not entitled to: the server
does not send them (§4), so the client could not fake them if it tried.

### 3.2 The public page — `/u/{name}`

**The owner's entitlement decides, never the viewer's.** The statistics are the owner's showcase,
like the favourites; a visitor who has paid sees nothing extra on somebody else's page. A private
profile stays the same 404 for everyone, whatever the tier.

**Public, owner paid.** The page as it is today, which is 0027 §8's set and nothing more: the four
tiles (games tracked, completion rate, mean score, hours logged), *Where their games sit*, *How
they score*, *What they start and finish* with the streaks, and the reviews. The exclusions 0027
§8 makes — identity, time to finish, hours by platform — stay excluded on both tiers; this spec
adds nothing to what may be published.

**Public, owner free.** The header with *tracking here since*, the favourites showcase, the
*games tracked* and *hours logged* tiles, *Where their games sit* with the wishlist caption, and the
reviews. No completion rate, no mean score, no histogram, no monthly chart, no streaks. The current
streak is basic, but this page states it only in the monthly chart's caption, beside the longest,
so it goes with the chart; and the page has never shown *finished this year*, which stays the
owner's own figure. The page has fewer sections; it does not have empty ones, and it does not
advertise the paid tier to a visitor — the visitor is not the customer.

### 3.3 The home page strip

`HomeStatsStrip` shows finished this year, hours logged and the current streak, all three basic
(§2), so **the strip is the same on both tiers**: it is the free tier's baseline as it stands,
decided on 2026-10-25 (open question 1). It never shows a figure the account cannot see on its own
page — each of the three is a tile on `/user` on both tiers, which is why *finished this year*
became one there.

### 3.4 What this does not touch

- **The export** — a user's data, not statistics; free and complete ([0024](../docs/decisions/0024-the-ownership-contract.md)).
- **The sitemap** — lists public, non-empty profiles whatever their tier ([0036](../docs/decisions/0036-what-a-crawler-is-told.md)).
- **The community figures on a game page** — aggregates over everybody, gated by nothing here ([0028](../docs/decisions/0028-a-games-community-view.md)).
- **Reviews, favourites, list names** — content the owner chose to show, not statistics.

## 4. The entitlement

**One question, asked in one place.** `IEntitlementService.HasAsync(userId, Entitlement.Statistics)`
— a named entitlement rather than a boolean "is paid", because 0010's table has several paid
things and they will not all be sold together for ever. Every caller, the two documents and
anything later, asks that service and nothing else; the client renders the tier the server
states and never derives it.

**Enforced on the server, in the copy.** A basic document does not *contain* the full-tier
fields: `UserStatsDto` and `PublicProfileDto` each carry a `Tier`, and the full-tier fields are
null on a basic one. Most go a whole section at a time — the scores, the completion rate — but two
sections are split by §2: the activity keeps its current streak and loses its months, longest
streak, transitions and time to finish, and the playtime keeps its total and its two counts and
loses its breakdown by platform. *Finished this year* is counted from the months, so a basic
document carries it as a figure of its own rather than the series it comes from, and so does a full
one, so that the strip reads one field on both tiers: the UTC calendar year, as the strip counts it
now. For the public document this is a second condition on 0027 §8's field-by-field copy — a field
reaches a visitor when somebody wrote it into the record *and* the owner is entitled. Hiding the
sections on the client alone would leave the figures one request away.

**Where the answer comes from.** 0010 decided that entitlement is persisted locally and never
inferred from Stripe per request, and #142 builds that table. Until it exists, the service reads
configuration: every account is entitled in the Development environment, so local work keeps the
full page, and elsewhere a named list of account ids is — which lets the owner's own account keep
its statistics on a deployment before there is a way to pay. #142 replaces the implementation and
touches no caller.

**Caching.** The public page is shared-cacheable for five minutes plus an hour stale
([0027](../docs/decisions/0027-usernames-and-public-profiles.md) §10). A change of tier changes
the page, and the window is acceptable in both directions: a new subscriber's statistics appear
within minutes, and a lapsed one's linger for at most the window — a figure, not a consent, so it
is not on #99's invalidation list. `/api/user/stats` is `no-store` already.

## 5. Server work

| ID | Item |
|---|---|
| S1 | `IEntitlementService` and `Entitlement.Statistics`; the configuration-backed implementation; a test that Development grants all and any other environment grants only the named list |
| S2 | `UserStatsDto.Tier` and `ActivityStatsDto.FinishedThisYear`; `StatsService` (or its controller) nulls the full-tier fields for a basic account (§4) — one endpoint, tier-shaped, so `useUserStats` and the home strip need no second call |
| S3 | `PublicProfileDto.Tier`; `PublicProfileService` copies `CompletionRate`, `Scores` and the `Activity` months and both streaks only when the owner is entitled; the counts, `Playtime` (which has no breakdown in this document), `TrackingSince`, `Reviews` and `Favourites` always |
| S4 | Tests: a free owner's public document carries the counts and null full-tier fields; an entitled owner's carries both; `StatsService` likewise |

## 6. Client work

| ID | Item |
|---|---|
| C1 | `tier` on the `UserStats` and `PublicProfile` types, with the full-tier sections optional, so a render cannot assume them |
| C2 | `ProfileStats` renders by tier: the four basic tiles and status breakdown, then the panel of §3.1 |
| C3 | `ProfilePage` renders by tier: fewer sections, no placeholders; `meta` and the sitemap test unchanged |
| C4 | `HomeStatsStrip` and the *finished this year* tile read `FinishedThisYear` rather than counting the months, which a basic document does not carry, and the strip and the page tell an empty account from the counts rather than from `transitions`, which it does not carry either; the strip is otherwise unchanged (§3.3) |
| C5 | Tests for each, including that a basic document never renders a full-tier section |

## 7. Blocked on

Nothing, for the seam and both pages: the configuration-backed entitlement is enough to build and
verify the split. The real entitlement is #142.

## 8. Open questions

1. **The free strip.** *Decided 2026-10-25: the strip as it is.* Finished this year, hours logged
   and the current streak are basic, by name (§2), and the strip is the same on both tiers (§3.3).
   The proposal had been three plain counts — playing now, finished, on the wishlist — which kept
   §2's rule a single sentence and could have been widened later at no cost; the strip was judged
   worth giving every account from the start, and drawn before launch it takes nothing away from
   anybody. The owner's page gained a *finished this year* tile with it, so that the strip shows
   nothing the account cannot find there.
2. **The owner's panel.** Fewer sections, or the panel of §3.1? Proposed: the panel, once and
   plainly — the owner's page is the one place the paid tier is sold to somebody who already
   tracks.
3. **Before Stripe.** A configuration list of entitled accounts, or pull the `Subscriptions` table
   forward from #142? Proposed: configuration — the table's shape is Stripe's lifecycle to decide,
   and the seam is what matters.
4. **Mean score.** The one full-tier figure people compare across profiles. Proposed: full — it is
   depth, and the histogram beside it plainly is.
5. **The owner's history** (ADR 0062). A list of the owner's own records, not a figure. Proposed:
   basic, on every tier. The free export already carries every record it shows (0024), and putting
   it behind a subscription would sell access to the owner's own data rather than depth. The case
   for full is 0024 §5's own: a nicer presentation of the export's data is convenience, which 0010
   sells. Until #149 ships, the whole page is free, and the history with it.
