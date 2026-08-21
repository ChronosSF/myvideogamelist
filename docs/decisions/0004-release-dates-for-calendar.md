# 0004. The upcoming calendar is built on `release_dates`

**Status:** Implemented

## Context

`GetUpcomingReleasesAsync` filtered IGDB's `games` endpoint on `first_release_date`. That
field is a single date for the whole title, so a game already released on one platform never
appeared when it reached another: a title out on PC but launching on Switch next week was
invisible to the calendar.

Measured against live IGDB, roughly **6%** of entries in a 30-day window were affected — for
example a game released in August 2025 arriving on Switch 2 a year later.

## Decision

Build the calendar from IGDB's **`release_dates`** endpoint, which is per-platform and
per-region.

The implementation deliberately avoids deep field expansion (reaching `game.cover.image_id`
from a release row), because multi-level traversal is unreliable. Instead it fetches release
rows carrying raw `game` and `platform` ids, collects the distinct game ids, fetches full
details through the existing cached by-ids path, and joins in memory.

Rows collapse to one entry per **(game, date)**, carrying only the platforms releasing on
that date. A staggered launch therefore appears on each of its dates with the correct
platforms, and the timeline's platform filter stays meaningful.

## Consequences

- A game can legitimately appear more than once in the response, on different dates. React
  keys stay unique within a date group, which is the unit the timeline renders.
- Two IGDB round trips instead of one, both cached.
- Where a release row has no platform, or names one absent from the game's platform list,
  the entry falls back to the game's full platform list rather than rendering empty.
- The window widened from 14 to 30 days, and pagination is capped at 10 pages (5000 rows)
  with a warning logged when the ceiling is hit. The previous `while (true)` loop was
  unbounded against a rate-limited API.
- A month or grid view is still open; the timeline remains a single scrolling column.
