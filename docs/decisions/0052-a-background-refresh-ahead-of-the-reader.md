# 0052. A background refresh: cached games an hour before a reader would, Steam feeds before they expire

**Status:** Implemented
**Extends:** [0038](0038-where-scheduled-work-lives.md), whose shape both jobs copy;
[0035](0035-a-local-copy-of-what-igdb-said.md) §2, whose refresh on read becomes the fallback; and
[0012](0012-steam-news-without-a-database.md), whose deferred N3 this is

## Context

Both caches that sit between a page and a third party were refreshed by whoever needed them first.

A `CachedGames` row is rewritten when a reader's request finds it a day old
([0035](0035-a-local-copy-of-what-igdb-said.md) §2), and that reader pays the IGDB round trip on
their page load. 0035 called a background job "the better long-term shape" and left the
`RefreshedAt` index it would need. The Steam feeds are cache-on-miss in memory
([0012](0012-steam-news-without-a-database.md)), so the first request after a feed's thirty minutes
pays Steam's round trip — for the home page, a dozen of them at once.

0012 deferred the job because "a per-instance job would duplicate the same work across every ECS
task". [0038](0038-where-scheduled-work-lives.md) has since answered that for work on the database,
with a hosted service serialised on a transaction-scoped advisory lock, and issue #102 asked for the
job in that shape. It left one question open: how fast to spend IGDB's four requests a second
([0034](0034-failing-in-one-shape.md)), which browse and search spend too.

## Decision

### 1. Two jobs, because the two caches are different kinds of thing

`CachedGames` is one table every task shares, so one task should refresh a row and the others
should not pay IGDB for it again. `GameCacheRefreshService` is 0038's shape exactly: a singleton
with a scope per tick, a catch per tick, a batch in its own transaction inside
`CreateExecutionStrategy()`, serialised on `pg_try_advisory_xact_lock`.

The Steam feeds are each process's own `IMemoryCache`. A lock there would let one task warm its own
copy and leave every other task's to go cold, so `SteamNewsRefreshService` takes no lock and runs in
every task. That is also the answer to 0012's objection, and it does not need the lock: the job
refreshes only the feeds *this task's* readers have read since they were fetched — feeds this task
would otherwise have fetched for its next reader anyway. Per-instance caching already implies
per-instance fetching; the job moves the fetch ahead of the reader, it does not add one.

Both are registered by `ScheduledWork.AddScheduledWork`, still the only place that configures
`HostOptions`.

### 2. A cached game is refreshed an hour before a reader would refresh it

The issue says the job refreshes rows "past a day old", and that no page load should pay the round
trip. Those disagree by one interval: a day old is exactly when a reader's own request refreshes the
row, so a job that waited for it would leave every row to the next reader until its next tick. So
the job's threshold is `RefreshAfter` less a lead of an hour — a row is due at twenty-three hours —
and the request path keeps `RefreshAfter` unchanged, as the fallback for a game nobody has cached
yet or for a job that is behind.

An hour, because it has to cover a burst as well as an interval: rows written together fall due
together — one cold shelf is one write — and at the default pace the job works through 3,000 rows
an hour, so a burst that size is still reached before any of it reaches a reader. The cost is a row
rewritten every twenty-three hours instead of twenty-four: about four percent more requests, against
a budget the job uses under half of one percent of (§3).

Oldest first, as the issue asks and as `IX_CachedGames_RefreshedAt` was added to serve, with ties
broken on the id — every row one request wrote shares one `RefreshedAt`, and 610 of the local
table's 682 rows were written in the same instant, so without it `Take` would pick from an order the
database is free to change. **A tombstone is selected like any other row**: "IGDB had no such game"
is as perishable as any answer, and a game restored to IGDB comes back only by being asked about
again.

### 3. The cadence: one request a minute, fifty ids

| | |
|---|---|
| IGDB allows | four requests a second, 345,600 a day — a limit on requests, not on ids, which IGDB caps at 500 a response |
| The job asks | one request per tick, so **1,440 a day per task**: 0.42% of the allowance |
| Which keeps fresh | 50 × 1,440 = **72,000 rows a day per task** |
| The table holds | 682 rows locally |
| One request takes | fifty ids 0.9 to 1.2 seconds, 182 ids 1.8, five hundred 2.9 — measured, less the second or so a process's first request spends fetching the token |
| A whole table from stale | 682 rows in fourteen ticks at fifty, and in two at five hundred, measured |

**One request at a time is the point, more than the average.** The limiter is a bucket of four
tokens, one back every 250ms (0034). A job that takes one token a minute never has the bucket down
by more than one, so a reader's request is never queued behind it — where a tick that sent its
batches back to back would empty the bucket for every browse and search page arriving in that
second. That is also why the pace is a request per interval rather than a number of batches per
tick with a pause between: one knob that means one request is easier to reason about than three
that mean the same thing.

**Fifty, not five hundred, though five hundred is cheaper on the budget.** IGDB counts requests,
so ten times the ids per request is a tenth of the requests, and the time does not grow tenfold —
five hundred took 2.9 seconds against fifty's one. What a bigger batch costs is that the job holds
its lock and a transaction open for as long as the request takes (§4). Fifty is the conservative
choice: every request about a second long and the transaction with it, and 72,000 rows a day, a
hundred times the table. When that stops being enough the answer is configuration, not code, and
the measurement says five hundred is a safe step to take.

**Both are configuration.** `GameCacheRefresh:BatchSize` (1 to 500, IGDB's response cap) and
`GameCacheRefresh:Interval` (ten seconds to an hour — no longer than the lead, or a row falling due
just after a tick could reach a reader before the next). A value outside either stops the host at
startup, through `ValidateOnStart`, rather than surfacing as a table quietly going stale. The right
numbers move with the size of the table, and the warning in §6 says when they have moved.

**In a fleet the pace is per task.** Tasks started together stay in step, so one of them takes each
minute's batch and the rest find the lock held: about one request a minute in all. Out of step, each
task's tick can land after another's commit and find the next batch due, so the ceiling is one a
minute each. Either way no two tasks pay for the same row, which is what the lock is for.

### 4. The lock is held across the IGDB request

A batch takes the lock, selects its rows, asks IGDB, writes the answer and commits, all in one
transaction. Releasing the lock before the request would let a second task select the same rows —
still due, since nothing has been written — and pay IGDB for them again. Holding it costs one pooled
connection idle in a transaction for as long as IGDB takes, which the resilience pipeline bounds at
thirty seconds and which measured about one at fifty ids.

The lookup is `IIgdbService.GetGamesByIdsUncachedAsync`, new for this. `GetGamesByIdsAsync`
remembers each set of ids for half an hour, which suits a page asking for the same shelf twice; the
job asks for a different set every tick and is there to fetch a fresh answer, so every game it
refreshed would have stayed in memory for half an hour under a set of ids nobody will ask for again
— fifteen hundred at the defaults, and ninety thousand at the largest batch and shortest interval
allowed, for as long as a backlog that size lasted.

A row is written through `GameCacheService.Apply`, the same method a reader's refresh uses, so the
two cannot come to write a row differently — including the tombstone for an id IGDB leaves out.

### 5. The stopping token bounds the work, not the write

What issue #96 asks of the retention sweep, done here from the start. Everything up to IGDB's
answer runs on the stopping token, so a shutdown abandons the request and the transaction rolls back
with nothing written. Once IGDB has answered, the request has been paid for, and cancelling the
write would throw the answer away to ask for it again on another task a minute later — so the save
and the commit run on `CancellationToken.None`, bounded by the database's command timeout instead.
Pinned by a test that cancels the stopping token in the same moment IGDB answers and finds the
answer saved.

An IGDB failure is caught inside the batch and logged as a warning; nothing is written, so the rows
keep the answer they had, stay due, and are first in line on the next tick. Stamping them as
refreshed with nothing would hide them from the job for a day.

### 6. Behind is a warning, hourly, and never a `/readyz` failure

Every tick counts the rows past `OverdueAfter` — twenty-five hours, an hour beyond the reader's own
threshold and two beyond the job's — and warns while there are any, at most once an hour, with one
line when it has caught up. A tick that could not take the lock counts too, and its warning names
the lock: `pg_try_advisory_xact_lock` is false when *any* session holds the key, so a lock taken by
hand stops every task at once, and only counting what is waiting tells that apart from contention
(0038).

The retention sweep's own rule — six skipped ticks with work waiting — does not carry over. Here
work is almost always waiting, because rows fall due a few at a time all day, and a fleet in step
skips N−1 ticks in N while one task refreshes. What does not happen while anybody is refreshing is a
row going two hours past due, so that is the signal, whatever the cause: the lock held by something
that is not a refresh, IGDB failing for hours, or more rows falling due than the pace can take. The
count is an index range over `RefreshedAt`, empty whenever the job keeps up.

Never a `/readyz` failure, for 0038's reason: the instance serves every request, with rows a little
older, and taking it out of rotation would turn a stale cache into an outage.

### 7. A Steam feed somebody is reading is fetched again before it expires

`SteamNewsService` notes, in memory beside the cache, when each feed was last asked for, and each
cached feed carries when it was fetched and when it expires. Once a minute the refresh fetches again
every feed within three minutes of expiring **that somebody has read since it was fetched**. A feed
read only by the request that fetched it is left to expire and forgotten: kept warm for nobody,
every game page a crawler visits once would cost a Steam request every half hour for ever. A feed
read again is back on the next tick.

At most twelve feeds a tick — one aggregate's fan-out, so the job never asks Steam for more at once
than a cold home page already does — in parallel, each bounded by the Steam client's eight seconds.
More than that falling due in one minute means the rest are taken on the next two ticks, and past
that expire and are fetched by their readers, which is no worse than before. Three minutes of lead
on a one-minute tick gives a failed fetch two more tries before the copy runs out, and **a failure
keeps the copy it has**: a reader whose own fetch fails caches an empty feed so as not to ask a
failing Steam on every render, and the refresh doing the same would blank a good feed to spare
nobody anything.

### 8. The aggregate asks each feed for what one game can contribute

`GetLatestNewsAsync` asked every feed for three times the whole page, though with a per-game cap a
game contributes at most the cap. It now asks for three times the cap — the factor still covers the
items de-duplication and mapping drop — and three times the count only when there is no cap, as on
one game's panel. Measured on the running API:

| Caller | Page | Per game | Asked of each feed, before | After |
|---|---|---|---|---|
| `/news` | 20 | 3 | 60 | **9** |
| The home rail | 8 | 2 | 24 | **6** |
| A game's panel | 5 | — | 15 | 15 |

`/news` still filled its twenty items, from eight games.

## Consequences

- **A reader pays IGDB only for a game nobody has cached yet, or while the job is behind.** Verified
  against a copy of the local database. From a table whose 682 rows were all past due, the job caught
  up in fourteen ticks and said so; afterwards bob2870's five lists, 31 games, rendered in 135ms and
  his wishlist in 30ms with no IGDB request at all. With the lock held from `psql` it skipped, warned
  naming the key, and refreshed on the first tick after the lock was released; with a wrong IGDB
  secret it warned, wrote nothing — the table's checksum unchanged — and caught up on the next run.
  On the Steam side, twenty-four feeds read since they were fetched were fetched again in two ticks,
  twelve at a time, before they expired; read after the copies they replaced had expired, the three
  pages made one Steam request between them, for the one feed nobody had read and the job had let
  go.
- **Every row costs a request slot every twenty-three hours, including rows nobody tracks any more**
  — a game taken off every list, or a candidate an import offered and nobody chose. The sitemap
  treats every row with a payload as a game somebody here tracks, so the job does too. At fifty to a
  request, ten thousand such rows are two hundred requests a day, 0.06% of the allowance; whether the
  table should keep them at all is its own question, not this job's, and is #253.
- **A batch that fails is retried whole**, which is right for an outage and wrong for a game IGDB
  answers in a shape the mapping cannot read: that would stop the job at the head of the queue, as it
  already fails every shelf holding the game. §6's warning says so within two hours.
- **The home page's other memos still expire on a reader.** The Steam job keeps the feeds warm, but
  the composed payload (fifteen minutes), the trending list (hourly) and the games behind the news
  (half an hour) are still fetched by whoever recomposes the page after they lapse — and the last of
  those by `/news` and a game's panel too. Not in #102; it is #252.
- **Not verified: two tasks contending for the lock** (one instance here, as with 0038), and the
  strategy wrapper under `EnableRetryOnFailure`, which 0038 verified for the sweep and which this
  copies line for line.
