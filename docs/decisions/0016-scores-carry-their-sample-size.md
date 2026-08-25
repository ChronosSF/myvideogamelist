# 0016. A score is never shown without its sample size

**Status:** Implemented

## Context

The browse listing rendered a green `100` badge on every game on its first pages. Nothing was
broken in the mapping or the UI — the query was asking IGDB for exactly those games.

`BuildQuery` sorted the un-searched catalogue with `sort aggregated_rating desc;` and no filter.
IGDB's `aggregated_rating` is a plain mean of critic reviews with no minimum, and its long tail
is full of DLC, special editions and console re-releases carrying a *single* review of 100/100.
Verified against live IGDB: the top ten rows of that sort were all `aggregated_rating: 100.0`
with `aggregated_rating_count: 1`.

This had already been diagnosed once. `GetTrendingAsync` exists because the same sort produced a
useless trending rail — its doc comment says `aggregated_rating` "surfaces obscure DLC and
re-releases carrying a single perfect review." The rail was fixed; the catalogue listing was not,
and the badge kept presenting one stranger's opinion as a verdict.

A second, quieter problem sat next to it. The field was named `MetacriticScore` and the UI
labelled it "Metacritic" and "MC". The number has never come from Metacritic — it is IGDB's own
critic aggregate. The name claimed a provenance the data does not have.

## Decision

**Every score travels with the count of opinions behind it**, end to end. `GameDto` carries two
pairs rather than two bare numbers:

| Field | Source | Meaning |
|---|---|---|
| `Rating` / `RatingCount` | `total_rating`, `total_rating_count` | Critics and users blended, out of 10 |
| `CriticScore` / `CriticScoreCount` | `aggregated_rating`, `aggregated_rating_count` | Critics only, out of 100 |

Three consequences follow from that shape:

**The headline score is `total_rating`, not `aggregated_rating`.** For Elden Ring the blend rests
on 2,260 ratings against the critic aggregate's 10. It falls back to the raw user `rating` when
IGDB publishes no blend, in which case no count is shown rather than a misleading one.

**The listing query requires eight critics** (`MinAggregatedRatingCount`) before it will rank a
game by critic score. Low enough to keep the catalogue deep, high enough that the first page is
Breath of the Wild and Elden Ring rather than a Switch 2 re-release with one review.

**A search is never filtered this way.** Search must reach every game in IGDB, however thinly
reviewed — a listing being tidy is worth a threshold, a search failing to find a real game is
not. Both halves are pinned by tests.

Display floors live in the client (`@/lib/score`), not the API. `MIN_CRITIC_REVIEWS` is 4 —
deliberately lower than the query's 8, because the two answer different questions: whether a
score is worth *ranking a catalogue by*, and whether it is worth *printing on a page you asked
for*. The API's job is to report the count faithfully and let each caller set its own bar.

`MetacriticScore` is gone. Nothing in the UI says "Metacritic" any more.

## Consequences

The browse listing is now a credible "best games" page, which is a change in what `/games`
*means* — it is no longer the whole catalogue in score order but the well-reviewed slice of it.
Games with fewer than eight critic reviews are reachable only by search, by the trending rail,
or by a direct link. If the listing should ever offer "everything, newest first", that is a new
sort mode rather than a relaxation of this threshold.

Every score in the UI is now conditional on its count, so a game can have a critic score in the
API response and no badge on screen. That asymmetry is intended and is the reason the threshold
sits in one shared module instead of being inlined at each of the three call sites.

The two counts cost two extra fields on every listing query, which is negligible next to the
cover art the same response carries.
