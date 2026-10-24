# 0063. The showcases and sales for everybody: one answer for every timezone, and the panel gives way to the line

**Status:** Implemented — #128

Records what [`specs/release-timeline-and-calendar.md`](../../specs/release-timeline-and-calendar.md) §2.3
asks for and could not say on its own: how one shared, cached answer serves readers whose "today" is
three different days, why a signed-in reader does not see the panel, and what the home composite took
on by reading the admin page's tables.

## Context

The calendar's showcases and sales are the same for everybody (spec B2), but only the two-week line
showed them, and the line is for somebody signed in. §9's fifth question asked whether a visitor who
has not signed in gets nothing or the events on their own. The owner had meanwhile said the home page
is becoming one shared page for everybody, under the signed-in hero, rather than a pitch for one half
and a page for the other.

Shared means `/api/home` ([0012](0012-steam-news-without-a-database.md)): composed once for everybody,
kept in memory for fifteen minutes, server-rendered, and kept at the edge for five more and served stale
for ten ([0013](0013-http-caching-policy.md)). Three things about the events do not fit that shape as
they stand. A showcase is an instant, and which day it is on is the reader's to say (E4) — which a
render shared by every reader cannot. "The next two weeks" starts on the reader's today, and at any
instant the readers' todays span three UTC days. And the line already draws these same events, so a
signed-in reader would see a panel repeat it directly underneath.

## Decision

1. **The composite carries B2's answer, for a window a day wider at each end than the two weeks.** From
   UTC's yesterday to the fourteenth day after UTC's today, inclusive: every reader's two weeks at once,
   from twelve hours behind UTC to fourteen ahead. The page keeps the reader's own days, as the line
   keeps its own from B2. The day of slack is also what lets an answer composed just before UTC midnight
   serve out its fifteen minutes and the edge's fifteen after them — `HomeService.EventsWindow`, and a
   test that walks both ends of a UTC day.

2. **The server render counts from UTC's day; the hydrated page from the reader's.** The loader puts the
   day it ran on into its data, so the render that hydrates the page counts from exactly the day the
   server did, and only then does the panel ask the reader's clock — the `NewsCard` pattern of an
   absolute date replaced by a relative one, applied to a countdown. A showcase gives no time until then.
   The two days differ for hours of every day somewhere — from five in the afternoon in California, and
   until nine in the morning in Tokyo — and then more than the words change. The reader's two weeks
   start a day before or after UTC's, so an event at either edge appears or goes as the page hydrates,
   and when it is the only one the panel does, moving what is below it. No server render can know
   which; drawing the panel only in the browser would move the page for every reader rather than for
   some, at the edges of some fortnights.

3. **The panel gives way to the line.** While a signed-in reader's line is on the page, the panel is not
   rendered. The line is the more specific of the two — the same events on the same days, beside the
   reader's own releases — and it is what the spec specifies for a signed-in reader (L1–L3). Giving way
   the other way, a line without its bars, would undo #165 for no gain and lose the one view where a
   Nintendo Direct is seen beside the release it might be about. Both are keyed on the condition that
   swaps the hero, so the panel leaves in the render that brings the line.

4. **Its freshness is the composite's, not B2's.** B2 reads the curated events on every request so that
   an admin's edit is on the line at once. The composite keeps them with the rest for its fifteen
   minutes, so an edit reaches the home page within about half an hour with the edge's share. Sales are
   entered weeks ahead; saving at most those fifteen minutes on the rare one entered on its day was not
   worth a read of the admin page's tables for every visitor who reaches the API. IGDB's own events are
   kept for an hour by `IgdbService`, as they are for the line, so a showcase IGDB adds late reaches the
   line within the hour and the home page within about an hour and a half.

5. **The composite reads our tables now, and their failure costs the panel alone.** Until this panel
   `/api/home` read no table of ours, so a database failure there would have taken the front page down
   with it. The events are read inside a catch that degrades the composite instead — the deliberate kind
   the backend rules allow the home composite, said so in a comment. The calendar's service already
   degrades on its own when IGDB fails, keeping the sales. A caller leaving is still thrown, not cached,
   judged by the caller's token as `SteamNewsService` learned to: a timeout of somebody else's is a
   failure to degrade from, whatever its type. The events are asked for beside the rails rather than
   after them: when IGDB hangs, each waits out its thirty-second ceiling, and one after the other they
   would take a minute, which is as long as the edge waits for a page. `HomeService` became scoped to
   take the scoped calendar service; its cache is the process's `IMemoryCache`, so the composite is
   still made once for everybody.

6. **Nothing on is an answer; something missing is degraded.** The rails are empty only when an upstream
   failed, so the composite reads an empty rail as degraded. The panel is empty most of the year for a
   true reason — nothing entered, no showcase named — and is then not drawn. So the events are degraded
   only when they say so, and a quiet fortnight leaves the front page on the shared policy. The loader
   reads an answer without the events at all — an API older than the page, mid-deploy — as degraded too.

7. **Silent about what failed.** On the line a missing part says so, because the line is always there and
   its emptiness means something (L7). The panel comes and goes, like Trending and the news, which vanish
   without a word when their upstream does; it shows the sales it has, and the page is not kept.

## Consequences

- A visitor who has not signed in sees the showcases and sales, server-rendered, with no request of
  their own. A signed-in reader sees what they did before once the page knows who they are; until
  `/api/auth/me` answers the panel is drawn with the landing hero, and leaves with it (V2).
- `/api/home` now reads the database as well as IGDB and Steam, for one panel, and degrades rather than
  fails when it cannot (decision 5). Once per composition, not once per visitor.
- The panel and the line read the same events through two routes — the composite and B2 — with different
  freshness. An admin checking an edit sees it on the line and the calendar at once, and in the panel,
  signed out, later; that is the composite's ordinary staleness, not a bug.
- The panel's two weeks follow the line's (`LINE_DAYS`, `HomeService.EventDays`). Changing one means
  changing the other.
- When the landing hero goes, the panel stays where it is, first among the shared sections, and goes on
  giving way to the line, wherever the line ends up.
