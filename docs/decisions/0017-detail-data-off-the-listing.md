# 0017. Detail-only game data stays out of the listing payload

**Status:** Implemented

## Context

The game detail page grew a lot at once: completion times, a screenshot gallery, similar games,
expansions and DLC, the parent title, game and multiplayer modes, themes, perspectives, engines,
series and language support. Almost all of it comes from fields on IGDB's `/games` endpoint that
we were simply not requesting.

One field list served every game query — the browse listing, the trending rail, the upcoming
timeline, the id lookups behind a user's lists, and the detail page. Adding the new fields to
that shared list would have added them everywhere. The cost is not theoretical: Elden Ring alone
returns 10 screenshots, 29 language-support rows, and three sets of ten related games with their
covers. Multiplied by a page of twenty results, the browse endpoint would carry several hundred
rows of data to render a grid of cover art that uses none of it.

Splitting the DTO into `GameDto` and a separate `GameDetailDto` was the obvious alternative. It
was rejected because every listing consumer — `ListService`, the trending rail, the news joiner —
already takes `GameDto`, and a parallel type would either duplicate sixteen fields or force
inheritance through positional records for no gain in expressiveness.

## Decision

Two field lists, one DTO, and an explicitly nullable detail half.

`GameListFieldList` is what every query asks for. `GameDetailFieldList` is the extra set, and
only `GetGameByIdAsync` concatenates the two. On the DTO this shows up as one nullable member:

```csharp
public record GameDto(… , GameDetailsDto? Details);
```

`Details` is `null` on every listing response and populated on `/api/games/{id}`. The client
mirrors this exactly: `details: GameDetailsDto | null`, so a component reaching for a screenshot
in a listing context has to acknowledge the null and TypeScript makes it.

The nullable member is the honest encoding of what is true — the same entity, retrieved at two
different depths — and it keeps the shape of a listing response unchanged for every existing
consumer.

**Completion times are a separate request.** `game_time_to_beats` is its own IGDB endpoint, so
the detail page costs two calls rather than one. It is wrapped in its own try/catch and degrades
to no completion-times section: the times are supplementary, and losing the whole game page
because one auxiliary endpoint faltered would be a bad trade. Both responses are cached together
under the existing game cache entry.

Inside `GameDetailsDto`, collections are always empty rather than null, so the client iterates
without guarding each one. Only genuinely singular things — `TimeToBeat`, `ParentGame`,
`MultiplayerModes` — are nullable, and each nullability means "IGDB has nothing", which the UI
renders as an absent section rather than an empty heading.

## Consequences

Coverage of completion times is thin in absolute terms — roughly 9,100 rows against IGDB's whole
catalogue — but concentrated in the games people open. Measured against the games our own
surfaces produce: 19 of the top 20 browse results and 18 of the top 20 trending rail entries have
data. Deep-catalogue pages will show no completion times at all, which is why the section hides
itself rather than rendering zeros.

Adding a field to the detail page from now on means editing `GameDetailFieldList`, and the fact
that this does *not* silently inflate every listing response is the whole point. The trap to
watch is the reverse: a new field that a *listing* needs must go in `GameListFieldList`, and
putting it in the detail list instead produces a field that is mysteriously null in grids and
populated on one page.

IGDB's multiplayer rows are per-platform, so the API folds them into one summary — any platform
supporting a capability counts, and each ceiling is the most generous on offer. Per-platform
differences are therefore not recoverable from the response. If the UI ever wants "split screen
on Switch only", the fold has to be undone rather than worked around.
