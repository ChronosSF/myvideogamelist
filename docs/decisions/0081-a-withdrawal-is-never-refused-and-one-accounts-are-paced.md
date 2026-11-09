# 0081. A withdrawal is never refused: one account's are paced on their way to the edge, and only what lets the urgent ones repeat is limited

**Status:** Implemented. Settles [#321](https://github.com/ChronosSF/myvideogamelist/issues/321), which
[0058](0058-a-withdrawal-leaves-the-edge-when-it-is-made.md) §6 left open. Amends 0058 §4: a request
now carries one account's withdrawals over a pace, rather than one event's. Amends
[0033](0033-what-the-api-refuses.md) §2: two writes are limited per account, alongside the per-address
limit on the two that take a password.

## Context

0058 takes a withdrawal off the edge when it is made, and bounds what that costs with a daily ceiling
of invalidation paths per task, `CloudFront:DailyPathLimit`, 500. Its §6 said what the ceiling does
not do: it bounds the bill, not who spends it. Measured against the code as it stood:

- A script switching one profile between public and private, a request a second, spends two paths a
  cycle, and the day's 500 in about eight minutes.
- A change of a public username's letter case skips the rename's thirty-day cooldown
  ([0027](0027-usernames-and-public-profiles.md)) and sends three paths, both spellings and the
  sitemap files. A script cycling the case spends the day's 500 in under three minutes.
- Writing a private review and deleting it, or adding a game and deleting it, spends a path a cycle
  on a public profile, because 0058 §1 has both deletes invalidate whatever they read.

After that, every other account's withdrawal that day keeps the TTL window. The basic auth in front
of the dev environment is all that stops any of this today, and it comes off at launch.

The issue named two shapes, a per-account debounce on the invalidation and a per-user limit on the
endpoints that withdraw, and each fails on its own.

**A limit on the endpoints refuses withdrawals.** A refused privacy switch leaves the profile public
at the origin as well as at the edge, which is strictly worse than the stale edge the limit was meant
to protect against. 0058 §3 refuses to let a CloudFront failure fail a withdrawal for that reason, and
a rate limit is no better a reason. A limit loose enough for somebody cleaning up their library a game
at a time, sixty an hour say, also lets one account through 1,440 times a day.

**A debounce alone does not bound the paths, and would delay the one withdrawal that must not
wait.** A case change names a spelling the last one did not, so a debounced invalidation carries one
more path for every spelling, and pacing the requests does not pace the paths. The privacy switch,
debounced behind its owner's own review deletions, would wait as long as they do.

Three constraints came with the work. A limit partitioned by address anywhere a loader reaches would
throttle the whole site (0033 §2). A withdrawal must never be visible for longer than 0058 promises:
coalescing invalidations is fine, dropping one is not. And
[#307](https://github.com/ChronosSF/myvideogamelist/issues/307)'s moderation adds an admin's hide,
which also invalidates, so the mechanism has to serve it.

## Decision

A combination, split by whether a withdrawal can be repeated freely.

### 1. A withdrawal is never refused, and nothing here drops one

Making a profile private, renaming it, deleting the account, making a review private, editing a public
review, deleting a review, deleting everything recorded about a game, and rewriting or clearing a
profile detail all succeed as they did. What this record changes is when their invalidation reaches
CloudFront, for some of them, and which writes that *publish* can be refused.

### 2. An account's withdrawals are paced, and go together while they wait

`WithdrawalHold` sits in front of the invalidator, whichever is registered (CloudFront, or the logger
when no distribution is configured), and keys on the account's id:

- **The first goes at once.** Somebody who withdraws one thing sees no change from 0058.
- **More within a minute of the last send wait for the minute, and go together.** One invalidation,
  carrying every path any of them named, sent after the last of them committed, so it covers them all.
  Every path here is the profile's own wildcard, so one path covers any number of withdrawals.
- **Twenty at that pace, then one every fifteen minutes.** Each account has a bucket of twenty sends,
  refilled at one every fifteen minutes. Somebody deleting a game a minute for twenty minutes never
  waits more than the minute. A script withdrawing all day gets twenty, then the refills, and each of
  its withdrawals waits at most fifteen minutes.
- **Nothing is dropped.** What waits is sent when the pace allows, or with the account's next
  at-once withdrawal (§3), or when the host stops: `ApplicationStopping` hands it to the queue before
  any hosted service stops, so before the queue's own five-second drain (0058 §5). An invalidation
  that waited carries the time of the latest write it covers, and the sender retries it until
  sixty-five minutes after that write, as 0058 §5 retries any other.
- **Not even by a task that dies outright.** A process killed without a stop (out of memory, a
  crash) never raises `ApplicationStopping`, and its held withdrawals, like its queue (0058 §5), die
  with it, up to fifteen minutes of an account's instead of the second or so a queued one waited. So
  **every task starts by invalidating `/u/*` and the sitemap files**, queued ahead of anything else.
  Whatever a dead task held was written before it died, so the start of the task that replaces it
  covers all of it: the withdrawal reaches the edge when the task is replaced, not when its TTL runs
  out. It costs two paths a start, against the ceiling like any other, and every profile's cached
  copy, which a deploy's `/*` (0046 §5) takes anyway; 0058 §2 rejected `/u/*` for every review edit,
  not for a task's start. It closes 0058 §5's own gap for a dead task's queue as well.

This paces the five that can be repeated with nothing limited in between: a review made private, a
public review edited, a review deleted, everything recorded about a game deleted, and a profile
detail rewritten or cleared. Each is re-armed by a write nobody would limit: writing a review,
publishing it, adding a game, setting a bio.

**By account id, not by path.** Keyed by path, a rename would hand an account a fresh bucket under
its new name. The id is on `EdgeInvalidation` for that and is never written to a log.

**Why fifteen minutes is coalescing and not a drop.** A held withdrawal reaches the edge at most
fifteen minutes after it was made, well inside the sixty-five-minute window an invalidation that
never came would leave. And only an account that has already sent twenty in the last few hours waits
that long.

### 3. Three go at once, and take whatever their account has waiting

The privacy switch, a rename and a deletion skip the pace. They are the consent acts 0027 and 0058
were written for, and a profile made private must not wait behind its owner's review deletions. Each
merges in whatever its account had waiting, since a send after the later write covers the earlier
ones too, and spends nothing of the account's pace.

None of the three can be repeated without something in between that is limited or impossible:

- A profile can be made private again only once it has been made public again (§4).
- A full rename waits thirty days.
- A change of letter case is limited (§4).
- An account is deleted once.

**A moderator's withdrawal belongs here too.** When #307's hide lands, it should be sent with
`AtOnce`: the author cannot repeat an admin's hide, and an admin taking down an abusive review should
not wait behind the abuser's own loop. `ProfileWithdrawals.Send` takes the choice as an argument for
that reason.

### 4. Only what re-arms the three is refused, per account, and it says so plainly

Two writes are limited, over a sliding day, per account:

| Write | Allowance | Paths it re-arms |
|---|---|---|
| A profile made public | ten a day | two, when it is made private again |
| A public profile's username changed in letter case only | three a day | three, at once |

A private profile's case change sends nothing and is not counted. Making a profile private is never
counted and never refused. A use is counted before the save, so two requests at once cannot both take
the last one, and handed back if the save does not happen: a lost race answered with a 409, or a
failure, publishes nothing and costs nothing (`RepublishPermit`). Ten is far above somebody trying both settings to see how the page looks,
and three covers putting right a name capitalised wrongly.

- **Per account, not per address.** No loader calls either write, and the server render is never one
  bucket, so 0033 §2's objection does not apply.
- **Checked in the action, not as a rate-limiting policy.** The privacy switch takes both directions
  on one endpoint, so a middleware policy could not tell the request it may refuse from the one it
  must never refuse.
- **A sliding log, not the framework's sliding window.** `System.Threading.RateLimiting` takes no
  `TimeProvider`, and a day's window has to be testable without waiting a day.

A refusal is a 429 with the wait in `Retry-After`, built by MVC's problem-details factory, so it
carries the trace id like every other error (0034). Its detail is the sentence the settings page
shows, beside the switch or under the name, through the reader it already has for every refusal:

> A profile can be made public 10 times a day, and yours has been. You can make it public again in
> about 3 hours. Making it private is never limited.

### 5. What one account can spend now

| | Paths a day, at most |
|---|---|
| Paced withdrawals: twenty, then one every fifteen minutes, one path each | 116 |
| The profile made private, ten times | 20 |
| Changes of case, three | 9 |
| A full rename, at most monthly | 3 |
| The account deleted, once | 2 |

A task's start adds two paths of its own, once per task rather than per account.

**About 150 in all, under a third of the ceiling**, and only by withdrawing without a pause for the
whole day. Before this, the cheapest loop took eight minutes. One account can no longer spend the
day's allowance.

The ceiling stays as the backstop it is. What it is left to stop is several accounts working
together: four would spend it. That needs an account each, each behind the per-address limit on
registration (0033). Past that, volume belongs at the edge, with a WAF (0044's deferred list), and the
ceiling's own error says when it is met.

### 6. Rejected

- **Refusing withdrawals at the endpoints**, the issue's second shape as written. See the context.
- **A debounce alone**, the first. See the context.
- **A share of the daily ceiling for each account**, past which its withdrawals keep the TTL window.
  That is a drop by design: a looping account's own withdrawals would stop reaching the edge, which is
  what 0058 exists to prevent.
- **Deciding the deletes from what they read**, so that deleting a private review or a game with no
  review cost nothing. It would remove the free loop rather than pace it. But it reopens the race 0058
  §1 closed, where the author's own request publishes a review between the delete's read and its
  commit. Closing that again needs either a lock on every delete or a record of each account's recent
  publications that every path publishing a review has to keep. The pace bounds that loop without
  touching either.

## Consequences

- **A withdrawal can now reach the edge up to a minute late,** when the same account sent one less
  than a minute before. Past twenty in a few hours, the delay can be up to fifteen minutes. The
  privacy switch, a rename and a deletion are never late. 0058's "when it is made" now reads "when it
  is made, or with its account's next send".
- **Per task, in memory.** The pace and the allowances are per process, as the auth limiter's
  partitions are (0033) and the queue is (0058 §4). Two tasks during a deploy give an account twice of
  each, as the ceiling is per task too. A task that dies outright loses what was waiting and its
  queue, and the task that replaces it invalidates every profile as it starts (§2). A shared store is
  [#101](https://github.com/ChronosSF/myvideogamelist/issues/101)'s.
- **0033's "only login and register" is no longer the whole story.** `CLAUDE.md` and the backend
  conventions say so. The new limit is partitioned by account, sits in two actions, and touches
  nothing a loader calls.
- **The log.** A withdrawal that waits is logged once per wait, at Information, with its paths and how
  long. Each one that joins it is at Debug, so a paced loop cannot fill the log as fast as it saves.
  Its later send is the sender's usual line, whose "after the write" is now measured from the write.
- **Tested with a clock moved by hand:**
  - which events go at once, and that each carries its account;
  - the minute, the bucket, and the merge, with its paths, reasons and write time;
  - a day of withdrawals every thirty seconds, which reaches the edge at most 116 times, with nothing
    waiting past fifteen minutes;
  - the hand-off on stop, through the registration, before the queue drains;
  - the every-profile invalidation a task sends before anything else when it starts;
  - an edge that throws from the timer;
  - both allowances, their windows, per account and per act, and the refusal's status, header and
    sentence, with the profile still private and nothing sent;
  - a use handed back when the save it allowed is refused as a lost race, for both writes.

  Not tested: the pace against a real CloudFront, which 0058's
  [#319](https://github.com/ChronosSF/myvideogamelist/issues/319) covers.
