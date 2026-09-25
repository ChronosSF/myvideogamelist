# 0004. Upcoming releases are built on `release_dates`

**Status:** Implemented

## Context

`GetUpcomingReleasesAsync` filtered IGDB's `games` endpoint on `first_release_date`. That
field is a single date for the whole title, so a game already released on one platform never
appeared when it reached another: a title out on PC but launching on Switch next week was
missing from the upcoming releases entirely.

Measured against live IGDB, roughly **6%** of entries in a 30-day window were affected — for
example a game released in August 2025 arriving on Switch 2 a year later.

## Decision

Build the upcoming releases from IGDB's **`release_dates`** endpoint, which is per-platform and
per-region.

The implementation deliberately avoids deep field expansion (reaching `game.cover.image_id`
from a release row), because multi-level traversal is unreliable. Instead it fetches release
rows carrying raw `game` and `platform` ids, collects the distinct game ids, fetches full
details through the existing cached by-ids path, and joins in memory.

Rows collapse to one entry per **(game, date)**, carrying only the platforms releasing on
that date. A staggered launch therefore appears on each of its dates with the correct
platforms.

## Consequences

- A game can legitimately appear more than once in the response, on different dates, so
  anything that shows each game once has to choose among them. The Releasing soon rail keeps
  the soonest.
- Two IGDB round trips instead of one, both cached.
- Where a release row has no platform, or names one absent from the game's platform list,
  the entry falls back to the game's full platform list rather than rendering empty.
- The window widened from 14 to 30 days, and pagination is capped at 10 pages (5000 rows)
  with a warning logged when the ceiling is hit. The previous `while (true)` loop was
  unbounded against a rate-limited API.
