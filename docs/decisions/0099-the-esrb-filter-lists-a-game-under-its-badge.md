# 0099. The ESRB filter lists a game under the rating its badge shows

**Status:** Implemented
**Amends:** [0032](0032-each-browse-order-carries-its-own-floor.md), decision 2

## Context

[0032](0032-each-browse-order-carries-its-own-floor.md) left an ESRB filter out of the browse page,
because the age-rating mapping read fields IGDB had removed. The mapping now reads `organization` and
`rating_category`, and #114 asked for the filter.

Everything below was read from live IGDB on 17 October 2026.

- **The ids.** `age_rating_categories` lists seven categories under organization 1, the ESRB:
  `1 RP`, `2 EC`, `3 E`, `4 E10+`, `5 T`, `6 M`, `7 AO`. The other six boards' categories run from 8
  to 40, so a category names its board as well as its rating.
- **Every condition on `age_ratings` is matched against one row.** Monster Train 2 holds a PEGI row
  and two ESRB rows, E10+ and T.
  - `organization = 2 & rating_category = (4)` finds nothing for it, and neither does
    `rating_category = (4) & rating_category = (5)`.
  - `rating_category != (5)` still finds it, because its E10+ row differs.
  - `= !(5)` and `!(…)` are syntax errors, and an exact array is refused.

  A query can ask for a row of a rating, but it cannot ask for a rating to be absent.
- **A game can hold two ESRB ratings.** Three of about 3,500 rated games did: Trove (E10+ and E),
  Monster Train 2 (E10+ and T), and Sonic X Shadow Generations (E10+, E and E). The badge showed
  whichever ESRB row came first, and rows do not come back in id order. So which rating it showed was
  nobody's decision.
- **Rating Pending is stale data under the browse floors.** No game rated RP reaches Top rated. The
  five that reach Popular are released games whose row was never updated.

## Decision

1. **The badge shows the strictest ESRB rating a game holds.** A pending rating counts only when there
   is no other. The strictest rating is the one somebody choosing by age needs to know. One table,
   `IgdbService.EsrbRatings`, holds each rating's id, code and key, in the order the rating is chosen
   by, and both the badge and the filter read it.
2. **The filter lists a game under the rating its badge shows, and no other.**
   - The query asks for an ESRB row of the chosen rating:
     `age_ratings.organization = 1 & age_ratings.rating_category = (id)`.
   - `GetGamesAsync` then drops from the page any game whose strictest rating is a different one.
   - This is the one browse filter that is not wholly in the `where` clause (0032, decision 2),
     because the clause cannot say "and no stricter rating".
   - Without the drop, a page filtered to E10+ would carry Monster Train 2 under a T badge.
3. **A short page is not refilled.** `hasMore` is still whether IGDB's page was full. The client pages
   by offset in IGDB's numbering, so a dropped game costs that page one card and skips nothing.
   Refilling would make one request read two IGDB pages and shift every later offset.
4. **One rating at a time, named in the URL by a key**, as the order is: `?esrb=ec|e|e10|t|m|ao`.
   - **Single-select**, as the platform filter is.
   - **A key rather than IGDB's id.** The URL is shared, and IGDB has already replaced once the fields
     its age ratings are read from. If that happens again, one table on the server changes, not every
     link.
5. **Every rating IGDB lists under the ESRB, except Rating Pending**, which says a game has no rating
   yet. A game with no ESRB rating at all never matches the clause. The line under the controls says
   so, whatever is chosen.

### Rejected

- **IGDB's ids in the URL**, as platform and genre use. Their ids come from lists the server loads at
  run time. The ESRB ratings are a fixed set the client can name for itself, and an id in a shared
  link is a number IGDB can change.
- **A ceiling** ("T and younger"). It expresses as `rating_category = (2,3,4,5)` plus the same drop,
  and it may be closer to what a parent asks. But it answers a different question from a list of
  ratings: suitable for an age, rather than rated this. The labels would have to say so. If it is
  wanted, it goes beside this filter as a choice of its own; it does not replace this one.
- **Matching any row, with no drop.** A game would be listed under each rating it holds, and under one
  of them its badge would contradict the page.

## Consequences

- **About one game in a thousand is dropped from a filtered page**, so a page is now and then a card
  short.
- **A first page could in principle come back empty while there is more to load.** That needs twenty
  games in a row holding a stricter second rating, which at that rate does not happen. What would make
  it happen is the age-rating fields leaving `GameListFieldList`, and `GetGamesAsyncTests` guards
  against that.
- **Rows already in `CachedGames` keep their first-row badge until they are refreshed**, which takes a
  day at most ([0035](0035-a-local-copy-of-what-igdb-said.md)).
- **Top rated filtered to EC or AO is empty**, because no game with either rating has eight critic
  reviews. The empty page already says that Popular and Newest reach further.
- **`esrb` is the ninth name in the CloudFront page cache policy's allowlist**, and a policy holds ten
  by default. The next browse parameter fits. The one after it needs a quota increase.
- **If IGDB adds a category under the ESRB**, the badge ignores it until it is in the table, and the
  filter cannot offer it.
