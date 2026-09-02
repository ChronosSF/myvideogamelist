# 0023. Profile statistics are derived at read time, and split by what they depend on

**Status:** Implemented

## Context

[0018](0018-append-only-status-event-log.md) shipped `UserGameEvents` on the argument that history
is the one gap in the schema that cannot be closed later. Nothing had read it since. The profile
page showed an email address, a theme toggle and a platform filter — so the log was accumulating
data for a feature that did not exist, which is exactly the state that eventually gets a log
deleted as dead weight.

The roadmap's Tier 1 entry asks for "total games, total hours, mean score, score distribution,
completion rate, games-per-month chart, most-played platform, most-played genre". Two of those
cannot be built as written: nothing records hours, and nothing records play time per platform or
genre, so "most-played" has no data behind it in either case.

## Decision

**1. Derived at read time. No rollup table, and no cache either.** The no-table half follows
[0012](0012-steam-news-without-a-database.md) and 0018, which both say that regenerable aggregates
do not belong in PostgreSQL. The no-cache half narrows 0018, which anticipated one: every figure on
this page changes the moment the user moves a game, and a stats page that disagrees with the list
the user has just changed reads as a bug rather than as a stale cache. A TTL short enough to avoid
that is short enough to be pointless, and correct invalidation is work with no measured problem
behind it. What 0018 ruled out was a table; there is none.

**2. Aggregated in C#, not in SQL.** Four queries — the status lookup, the user's entries, their
wishlist count, their events — and every figure computed from those lists. Three reasons, in
increasing order of importance:

- The data is small per user. 0018 sizes a heavy user's log at roughly 600 rows a year and says
  never to prune it. Reading one user's history costs less than the round trips a set of `GROUP BY`
  queries would take.
- Active time needs an ordered walk over each game's transitions, carrying an open interval. That is
  window functions no ORM writes for you, so the real choice was between "all in C#" and "half in
  each", and one place is easier to reason about than two.
- **The tests would otherwise prove nothing.** The suite runs on the EF in-memory provider, which
  does not translate what PostgreSQL would run. A `GROUP BY` verified there says nothing about
  production. The same arithmetic in C# is exercised by the tests exactly as it ships, which is why
  there are twenty-six of them against the metric definitions rather than against the queries.

Worth revisiting if one user's log reaches tens of thousands of rows, which at that rate is decades
away.

**3. The page is split by what each figure depends on, not by what is convenient.** Everything
derived from our own tables comes from `/api/user/stats`. The platform and genre breakdowns — the
only figures that need a game's metadata, which means IGDB — are counted on the client from the
lists it has already loaded.

The reason is a failure mode, not tidiness. `/readyz` already treats a degraded IGDB as a 200
because stored lists still work, and a statistic about the user's *own behaviour* has no business
going dark because a third party is down. Computing the breakdowns server-side would have meant
either an IGDB call per profile view or a metadata cache that does not exist yet, and either way one
outage would take the whole page. As it stands an outage costs two rows, which say so, while every
figure above them stands. The client-side half is free besides: `ListsProvider` is mounted at the
root and already holds every entry with its `GameDto`.

**4. The metric definitions are the substance, so they are written down.** Each of these is a place
where a plausible-looking number would mean something other than what the label says.

- **Completion rate is finished over everything terminal**, so the denominator is finished plus
  dropped and a backlog game is in neither half. Both sets come from 0018's flags rather than a list
  of keys: `IsTerminal` is the denominator and `CountsAsCompletion` the numerator, which is the
  distinction that third flag was added for.
- **A rate with an empty denominator is null, not zero.** A user who has finished nothing and
  dropped nothing has no completion rate; rendering "0%" would be a claim about them. The UI shows
  an em dash and says why.
- **Active time, not elapsed time.** 0018 called this out and this is the code that honours it: only
  intervals whose target status was `playing` are summed, so somebody who plays for two weeks,
  shelves a game for eight months and returns for three days reads as three weeks rather than nine
  months. Measured up to the *first* finish, because a game picked up again afterwards is a second
  playthrough.
- **Games finished without ever being played are excluded from it, not counted as zero.** Marking an
  old favourite as finished straight from the backlog says nothing about how long it took, and a
  zero would drag the median. The response carries the sample count so the median cannot be read as
  resting on more than it does.
- **"Started" means started for the first time.** Replaying a game is not picking up a new one, and
  counting it as one would make revisiting a favourite look like broadening a library.
- **Finishes are distinct games per month.** Finishing a game twice in one month is one finish;
  finishing it again next year is a finish next year too.
- **The chart never reaches back before the user's first event.** The log shipped in August 2026 and
  was **not backfilled**, so months before it hold no events whether or not anything happened in
  them. Padding to a fixed twelve would draw those as bars of zero, which reads as "you did nothing"
  rather than "nothing was recorded" — so the API sends the log's start date and the page says what
  it means.
- **A streak survives a quiet current month.** Anchored to this month if it has a finish and to last
  month otherwise, because otherwise every streak in the app breaks at midnight on the first and
  comes back later the same day.
- **Months are UTC**, matching how the timestamps are stored. An event at 23:30 on the 31st in a
  positive offset belongs to the next month here, and that is a convention rather than a bug, so it
  is stated.
- **No "total hours".** Nothing records hours. Approximating them from status timestamps would give
  a number that looks like play time and is not.
- **"Most of your games are on", never "most played".** A game with four platforms counts towards
  all four, so those totals deliberately sum to more than the library; and with no hours recorded,
  "played" is a word the data cannot support.

**5. The mean of the user's own scores is printed on the 1–10 scale.** Not as stars, because
[0021](0021-one-control-for-a-score.md) forbids stars on an aggregate; not as a percentage, because
in this app a percentage means a score averaged from *other people*. This is a third case those
records did not cover, and the answer follows from both of them: a plain number against the scale it
was entered on.

## Consequences

**One status key is hardcoded, and it is the only one.** Active time is by definition time spent
playing, and no combination of the three flags picks that status out — `IsStarted` also covers On
Hold, which is precisely the interval not to count. 0018 makes `Key` permanent and explicitly safe
to use in code, so naming `playing` is fine where naming a *set* of keys would not be; the service
says so at the line that does it.

**The month labels are ours, not the browser's.** `toLocaleString({ month: 'short' })` is numeric in
some locales, and the axis rendered as "01" on the machine this was written on. A localised month
inside otherwise English copy would read as a bug even where it worked, so the names are a constant
and the assertions do not depend on the machine's locale.

**`useUserStats` has no account-change guard**, which every provider added one for in
[0022](0022-entry-surrogate-key-and-the-wishlist-axis.md). Those live at the root and survive a
sign-out; this hook is mounted only inside the signed-in branch of the profile route, so signing out
unmounts it. **If it is ever lifted somewhere that outlives a sign-out it needs the guard**, because
the fetch would then be in flight across the change — the hook says so in its own comment.

**The local development database has almost nothing in it.** Seventeen events across two accounts,
spanning three days in August, most of them seconds apart from manual testing. Every figure renders
and the empty and thin states are the ones on display: one or two months of chart, and an active
time of "under an hour". That is the feature working, not the feature broken, but it is worth
knowing before judging the design from a screenshot.

**What this unblocks.** H6's stats strip on the home page reads the same endpoint. Public profiles
need this page to exist before there is anything worth sharing. "Yearly wrapped" is this
aggregation over a fixed window.

**What it deliberately leaves.** Hours and playthroughs, which need the Tier 1 per-entry tracking
data; completion rate per genre, which needs the metadata split to move server-side and so waits on
the local metadata cache; and a personal activity feed, which needs game titles for arbitrary ids
and is therefore a metadata feature rather than a stats one.
