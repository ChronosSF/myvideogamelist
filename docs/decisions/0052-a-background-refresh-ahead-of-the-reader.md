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
should not pay IGDB for it again. `GameCacheRefreshService` is 0038's shape: a singleton with a
scope per tick, a catch per tick, a batch in its own transaction inside `CreateExecutionStrategy()`,
serialised on `pg_try_advisory_xact_lock`.

The Steam feeds are each process's own `IMemoryCache`. A lock there would let one task warm its own
copy and leave every other task's to go cold, so `SteamNewsRefreshService` takes no lock and runs in
every task. That is also the answer to 0012's objection, and it does not need the lock: the job
refreshes only the feeds *this task's* readers have read since they were fetched — feeds this task
fetches for its readers anyway. Per-instance caching already implies per-instance fetching; the job
moves the fetch ahead of the reader, and adds at most one per feed after its last read (§7).

Both are registered by `ScheduledWork.AddScheduledWork`, still the only place that configures
`HostOptions`.

### 2. A cached game is refreshed an hour before a reader would refresh it

The issue says the job refreshes rows "past a day old", and that no page load should pay the round
trip. Those disagree by one interval: a day old is exactly when a reader's own request refreshes the
row, so a job that waited for it would leave every row to the next reader until its next tick. So
the job's threshold is `RefreshAfter` less a lead of an hour — a row is due at twenty-three hours —
and the request path keeps `RefreshAfter` unchanged, as the fallback for a game nobody has cached
yet or for a job that is behind. Both write a row through `GameCacheService.Apply`, so they cannot
come to write one differently — the tombstone for an id IGDB leaves out included.

An hour, because it has to cover a burst as well as an interval: rows written together fall due
together — one cold shelf is one write — and at the default pace the job works through 3,000 rows
an hour, so a burst that size is still reached before any of it reaches a reader. The cost is a row
rewritten every twenty-three hours instead of twenty-four: about four percent more requests, against
a budget the job uses under half of one percent of (§3).

Oldest first, as the issue asks and as `IX_CachedGames_RefreshedAt` was added to serve. **No
tie-break**, though ties are the rule: every row one request wrote shares one `RefreshedAt`, and 610
of the local table's 682 rows were written in the same instant. Which fifty of a tie a batch takes
does not matter — whichever it takes move to the back of the queue when written, and the next batch
takes fifty others — and the index cannot serve a second sort column. Measured with five thousand
rows tied at the head of the queue: ordered by `RefreshedAt` and the id, PostgreSQL read all five
thousand to return fifty; ordered by `RefreshedAt` alone, it read fifty. **A tombstone is selected
like any other row**: "IGDB had no such game" is as perishable as any answer, and a game restored to
IGDB comes back only by being asked about again.

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

**In a fleet the pace is per task.** Each task's timer runs from its own start, and the lock is
held for about a second a tick, so two tasks only meet when their ticks land within that second.
While rows are due, N tasks therefore send up to N requests a minute, one each, each batch the next
fifty; when nothing is due they send none. Either way no two tasks pay for the same row, which is
what the lock is for.

### 4. The lock is held across the IGDB request, for at most fifteen seconds

A batch takes the lock, selects its rows, asks IGDB, writes the answer and commits, all in one
transaction. Releasing the lock before the request would let a second task select the same rows —
still due, since nothing has been written — and pay IGDB for them again.

What holding it costs is a pooled connection idle in a transaction, and a lock on `CachedGames`:
the ordinary one any read takes, which nothing a request does conflicts with, but which a migration
altering the table has to wait for — with every reader of the table queued behind the migration.
The resilience pipeline bounds a call at thirty seconds, and a process's first batch makes two, the
token and the query, so the job bounds its own wait at **fifteen seconds**, five times the slowest
batch measured; past it the request is abandoned like any other failure to answer (§5).

The lookup is `IIgdbService.GetGamesByIdsUncachedAsync`, new for this. `GetGamesByIdsAsync`
remembers each set of ids for half an hour, which suits a page asking for the same shelf twice; the
job asks for a different set every tick and is there to fetch a fresh answer, so every game it
refreshed would have stayed in memory for half an hour under a set of ids nobody will ask for again
— fifteen hundred at the defaults, and ninety thousand at the largest batch and shortest interval
allowed, for as long as a backlog that size lasted.

**The wrapper is the sweep's; what a retry needs is not.** The sweep deletes with
`ExecuteDeleteAsync` and carries nothing from one attempt to the next. This writes tracked rows, and
`SaveChangesAsync` accepts what it wrote even when the commit after it fails — so under a retrying
strategy the retried query would hand back the rows as they were saved, not as the rolled-back
database holds them, `Apply` would change nothing but `RefreshedAt`, and the old payload would be
stamped fresh for a day. Each attempt therefore clears the change tracker first. The strategy does
not retry today; the clear is for the day it does, and a retried attempt asks IGDB again.

### 5. What a batch does when IGDB fails it

**The stopping token bounds the work, not the write.** What issue #96 asks of the retention sweep,
done here from the start. Everything up to IGDB's answer runs on the stopping token, so a shutdown
abandons the request and the transaction rolls back with nothing written. Once IGDB has answered,
the request has been paid for, and cancelling the write would throw the answer away to ask for it
again on another task a minute later — so the save and the commit run on `CancellationToken.None`,
bounded by the database's command timeout instead. Both are pinned against PostgreSQL by the
integration suite's `GameCacheRefreshJobTests` ([0057](0057-the-api-is-tested-over-a-real-postgresql.md)),
which stops the host in the moment IGDB answers and finds the answer committed — and which fails
with the commit moved onto the stopping token.

**IGDB not answering** — a host not reached, a broken circuit, a timeout, our own throttle, a body
cut off, missing credentials; the list `UpstreamFailureHandler` and `UpstreamBusyHandler` already
keep — writes nothing: the rows keep the answer they had, stay due, and are first in line on the
next tick. Stamping them as refreshed with nothing would hide them from the job for a day. It is a
warning the first time, Debug while it lasts, and one line when IGDB answers again: a warning a
tick through an afternoon's outage, from every task, is noise, and a failure that lasts is said
hourly by §6 anyway.

**IGDB answering something this code cannot read** — a field in a shape the model does not expect,
a mapping that meets a null — is different, because it may be one game's. Retried on the next tick it
would be retried for ever: nothing is written, so the batch stays the oldest thing due, and one game
would stop the refresh of the whole table. So that batch is **held back for an hour**, logged as an
error naming its ids, and the queue moves on; its rows fall back to their readers, as before this job
existed. Splitting the batch to find the one game would refresh the other forty-nine as well, at the
cost of state the job does not otherwise need; not done.

**The database refusing what IGDB said** is held back the same way, which Copilot's review of the
pull request found missing: a title longer than `CachedGames.Title`'s 512 characters is read and
mapped without complaint and only fails at the save, after the hold-back above has been passed, so
the batch rolled back unwritten and was the oldest thing due on every tick again. What counts is
PostgreSQL's classes 22 and 23 — a value too long, a character it will not store, a constraint —
which are refused alike however often the same rows are written. Anything else from the save, a
dropped connection or a timeout, is a failed tick like any other, and the next one tries again.

### 6. Behind is a warning, hourly, and never a `/readyz` failure

Every tick counts the rows past `OverdueAfter` — twenty-five hours, an hour beyond the reader's own
threshold and two beyond the job's — and warns while there are any, at most once an hour, with one
line when it has caught up. A tick that could not take the lock counts too, and its warning names
the lock: `pg_try_advisory_xact_lock` is false when *any* session holds the key, so a lock taken by
hand stops every task at once, and only counting what is waiting tells that apart from contention
(0038).

The retention sweep's own rule — six skipped ticks with work waiting — does not carry over. Here
work is almost always waiting, because rows fall due a few at a time all day, and a task can skip a
tick while another refreshes. What does not happen while the refresh keeps up is a row going two
hours past due, so that is the signal, whatever the cause: the lock held by something that is not a
refresh, IGDB failing for hours, a batch held back, or more rows falling due than the pace can take.
The count is an index range over `RefreshedAt`, empty whenever the job keeps up.

Not in a task's first two hours, though — the time between a row falling due and going overdue. A
task started after a deploy, or after the environment was parked, inherits a backlog nothing was
refreshing, and that is not the job falling behind; a backlog that outlasts those two hours is.

Never a `/readyz` failure, for 0038's reason: the instance serves every request, with rows a little
older, and taking it out of rotation would turn a stale cache into an outage.

### 7. A Steam feed somebody is reading is fetched again before it expires

`SteamNewsService` notes, in memory beside the cache, when each feed was last asked for, and each
cached feed carries when it was fetched and when it expires. Once a minute the refresh fetches again
every feed within three minutes of expiring **that somebody has read since it was fetched**. A feed
read only by the request that fetched it is left to expire and forgotten: kept warm for nobody,
every game page a crawler visits once would cost a Steam request every half hour for ever. A feed
read again is back on the next tick. What the job adds over its readers is the copy fetched ahead
of an expiry that nobody then reads: at most one request per feed after its last read.

At most twelve feeds a tick — one aggregate's fan-out, so the job never asks Steam for more at once
than a cold home page already does — in parallel, each bounded by the Steam client's eight seconds,
soonest to expire first. More than that falling due in one minute are taken on the next two ticks,
and past that expire and are fetched by their readers, which is no worse than before. Three minutes
of lead on a one-minute tick gives a failed fetch two more tries before the copy runs out, and **a
failure keeps the copy it has**: a reader whose own fetch fails caches an empty feed so as not to ask
a failing Steam on every render, and the refresh doing the same would blank a good feed to spare
nobody anything. **That stand-in itself is never refreshed**: it exists so that a failing Steam is
not asked again for ten minutes, and refreshing it ahead of its expiry would ask three times in its
last three, through an outage, for every feed anybody reads.

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
  up in fourteen ticks; afterwards bob2870's five lists, 31 games, rendered in 135ms and his wishlist
  in 30ms with no IGDB request at all. With the lock held from `psql` it skipped, warned naming the
  key, and refreshed on the first tick after the lock was released; with a wrong IGDB secret it
  warned, wrote nothing — the table's checksum unchanged — and caught up on the next run. On the
  Steam side, twenty-four feeds read since they were fetched were fetched again in two ticks, twelve
  at a time, before they expired; read after the copies they replaced had expired, the three pages
  made one Steam request between them, for the one feed nobody had read and the job had let go.
  Those runs were of the first build. Review then added the two-hour grace of §6, the quieter
  logging and the held-back batch of §5, the fifteen-second bound of §4, the change-tracker clear and
  the stand-in rule of §7, all unit-tested; run again against the reviewed build, a wrong IGDB secret
  gave one warning and then a Debug line a tick, a backlog of 120 rows went in three ticks with no
  warning inside the grace, and the batch query as EF writes it, held-back exclusion and all, read
  fifty-three rows of a hundred thousand to return fifty — the three it skipped being the held-back
  ones.
- **Every row costs a request slot every twenty-three hours, including rows nobody tracks any more**
  — a game taken off every list, or a candidate an import offered and nobody chose. The sitemap
  treats every row with a payload as a game somebody here tracks, so the job does too. At fifty to a
  request, ten thousand such rows are two hundred requests a day, 0.06% of the allowance; whether the
  table should keep them at all is its own question, not this job's, and is #253.
- **A batch IGDB answers unreadably, or with a value the database refuses, costs its own rows, not
  the table**, held back an hour at a time until the code is fixed, and named in an error each time.
- **The distributed cache is no longer a pure swap for the Steam feeds.** 0012 says moving to
  `IDistributedCache` changes nothing else. The record of which feeds were read is per process, and
  the Steam job takes no lock because each process warms only its own copy; with the copy shared,
  every task would refresh the same feeds, which is the duplication 0012 objected to. The record has
  to move with the cache, and the job go under a lock. #101 owns that move.
- **The home page's other memos still expire on a reader.** The Steam job keeps the feeds warm, but
  the composed payload (fifteen minutes), the trending list (hourly) and the games behind the news
  (half an hour) are still fetched by whoever recomposes the page after they lapse — and the last of
  those by `/news` and a game's panel too. Not in #102; it is #252.
- **Run against PostgreSQL since:** the lock held by another session, the commit after a stop, and a
  refused write, by `GameCacheRefreshJobTests` — each checked by breaking the code it covers.
- **Not verified:** two application tasks contending for the lock (the suite holds it from a session
  of its own, which is the same refusal to the try-lock); the strategy wrapper and the
  change-tracker clear under `EnableRetryOnFailure`, which nothing here turns on; the fifteen-second
  bound against an IGDB slow enough to reach it; and the held-back batch against a real answer that
  cannot be read, since none is known — it is unit-tested with one that throws.
