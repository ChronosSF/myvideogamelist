# 0058. A withdrawal leaves the edge when it is made, and its retry stops when the TTL would have

**Status:** Implemented; proved only by a deploy. Closes the window
[0027](0027-usernames-and-public-profiles.md) records for a withdrawn profile (ROADMAP D14,
[#99](https://github.com/ChronosSF/myvideogamelist/issues/99)), for the page and for the profile
sitemap file [0036](0036-what-a-crawler-is-told.md) §5 gave the same window. Corrects the sitemap
path 0036 named.

## Context

A public profile is shared-cacheable: `CACHE_PROFILE` is five minutes fresh and an hour of
`stale-while-revalidate`, and the profile sitemap files keep the same policy so that a sitemap
cannot go on naming somebody for longer than their page could be served. 0027 accepted that
window for content and not for consent. A profile switched back to private, renamed or deleted, or
a review on it made private, edited or deleted, went on being served from the edge for up to
sixty-five minutes after its owner took it back. Shortening the TTL was rejected, because it narrows
the window without closing it. The fix 0027 named was CloudFront invalidation from the API on those
events, once a distribution existed. [0046](0046-the-balancer-answers-its-own-distribution.md)
built the distribution.

The issue settled the events and the shape: the page, its `.data` URL, both names on a rename and
the sitemap files on the first three. Five things it left open, or did not know:

- **What the paths are.** The cache key holds more than the path. And the sitemap path the issue
  and 0036 give, `/sitemaps/profiles-*.xml`, is one CloudFront would read literally.
- **Inline or queued, and whether a failure is retried.**
- **What a failed invalidation does to the write that needed it.**
- **What stops a signed-in account withdrawing in a loop and spending money a path at a time.**
- **What the application stack hands the task, and in what order CloudFormation builds it.**

## Decision

### 1. Six events, each decided where its write is made

| Event | Where | Paths | Sends nothing when |
|---|---|---|---|
| Profile made private | `UserController.UpdatePrivacy` | `/u/{name}*`, `/sitemaps/profiles-*` | it was not public before the save |
| Profile renamed, including a change of letter case only | `UserController.UpdateUserName` | `/u/{old}*`, `/u/{new}*`, `/sitemaps/profiles-*` | the profile is private |
| Account deleted | `UserController.DeleteAccount` | `/u/{name}*`, `/sitemaps/profiles-*` | the profile was private |
| Review made private | `ReviewService.UpsertAsync` | `/u/{name}*` | the profile is not public now |
| Review edited: its words or its spoiler warning changed | `ReviewService.UpsertAsync` | `/u/{name}*` | the review was not public before the save, it was saved again unchanged, or the profile is not public now |
| Review deleted | `ReviewService.DeleteAsync`, and `ListService.DeleteEntryAsync` when the entry carried a public review | `/u/{name}*` | the review was not public, or the profile is not public now |

**Only a write that takes back something published counts.** The before-state decides it. A first
review, or a private one made public, publishes, and reaches the page when the TTL runs out like
any other new content. A favourite removed, a score changed, a statistic that moved: those are the
profile's content changing, and keep the window, as
[0029](0029-favourites-are-an-axis-and-a-showcase.md) and the statistics tiers' spec already say.

**A review saved again unchanged is not an edit.** It moves to the top of the profile's
newest-first list, which is content. Nothing it said has been taken back. Treating it as an edit
would also give anybody a free way to spend money, a save button pressed in a loop.

**A change of letter case is a rename here**, though it releases no name and `/u/alice` and
`/u/Alice` render the same page. Invalidation paths are case-sensitive, and every later withdrawal
names the new spelling. The copies the edge holds under the old one would therefore be out of
reach of all of them. Those copies are the ones the site itself made: the old spelling was the
canonical URL, every link and the sitemap's entry until now.

**Deleting everything recorded about a game deletes its review**, through the cascade, and is the
same withdrawal. `ListService` asks whether the entry carries a public review before the row goes,
because afterwards there is nothing left to ask.

Game pages are not on the list and must not join it. They never carry review text, because
[0028](0028-a-games-community-view.md) §4 fetches member reviews after hydration for exactly this
reason.

### 2. One wildcard per profile, because the cache key holds query strings

React Router 8.4 asks for a document's data at the document's path with `.data` appended:
`/u/alice.data`, seen in the browser's network trace of a client-side navigation to a profile.
`singleFetchUrl` in its `single-fetch.js` makes `/u/alice?page=2` into `/u/alice.data?page=2`, and
the trailing-slash form into `/u/alice/_.data`. It adds `_routes` only when another matched route
with a loader is not being called, or has a client loader; on a profile the one other match is the
root, which has no loader.

The distribution's cache policy keys on `page`, `_routes` and the six browse parameters (0044).
CloudFront's documentation says that where it caches by query string, an invalidation must name
the query string, or end the path with `*` to cover every one. Naming `/u/alice` and
`/u/alice.data` alone would have left page three of somebody's reviews, with the review they
withdrew still on it, at the edge.

So each profile is one path, `/u/{name}*`. It covers the document, its `.data` URL, every query
string on either, and the trailing-slash forms. A wildcard path costs the same as any other path.

- **It also covers every name that starts with this one.** `/u/alice*` takes `/u/alice_2` with it.
  That costs those pages one trip to the origin. The alternative, counting pages of reviews before
  each write to name every `?page=N` exactly, costs a query and a path per page, and is wrong
  about any query string nobody thought of.
- **It does not cover a spelling the site never linked to.** The lookup ignores case, so
  `/u/ALICE` renders this profile, and the site links only to the name as its owner wrote it.
  After a change of case, both spellings are invalidated (§1). That leaves a copy made from a URL
  somebody typed, or from a link kept from before a change of case and followed since. Such a copy
  keeps the old window. `/u/*` would close the gap, at the price of emptying every profile from
  every edge on every review edit, anybody's, and was rejected for that. Redirecting every other
  spelling to the canonical one would close it properly. That is a change to 0036 §6's
  render-under-any-case, and it is left as its own issue.

**The sitemap path is `/sitemaps/profiles-*`, not `/sitemaps/profiles-*.xml`.** CloudFront honours
a `*` only as the last character of a path, and its documentation says one anywhere else is matched
as a literal asterisk. The path as the issue and 0036 wrote it would have been taken as the name of
a file nobody has, and invalidated nothing. One path covers every file, because a withdrawal moves
every later name into a different file. The sitemap index lists file names and nobody's name, and
is left alone.

### 3. After the commit, and never able to fail it

Each call is made once the write is stored, and the tests read the store at the moment of the call
to prove it. A refused write sends nothing. Every call goes through `ProfileWithdrawals`, which
catches and logs whatever the invalidator throws, deliberately. A withdrawal that reached our
tables has taken effect for every request that reaches the origin. Answering it with an error
because CloudFront did not answer would report a consent change that happened as one that failed,
and the user would try again at a change already made. The tests pin this with an invalidator that
throws, for every write: the write stands and the answer is a success. `ProfileWithdrawals` is a
class rather than an interface for that reason. It is where the guarantee lives, so it is not
something to swap out; the seam is `IEdgeInvalidator` beneath it.

For the three review events, `ProfileWithdrawals` reads the author's name and visibility after the
write, so that a rename landing between the two is answered under the name the profile has now. It
reads them **without the request's cancellation token**. That token is cancelled when the reader
closes the tab, and passing it would let a closed tab cancel the invalidation of something the
database already holds. This is the one place a request's token is deliberately dropped, and the
method says why.

One race is left. A render of the page that began before the commit can read the old rows and
reach the edge after CloudFront has processed the invalidation. It is then kept for the full
window. That needs a request for the same profile in flight at the moment of the commit, and slow
enough to finish after an invalidation that reaches every edge within a few seconds. A second
invalidation a minute later would close it, at twice the paths, and is not done.

### 4. Queued, sent from the background, one request per event

`IEdgeInvalidator.Invalidate` returns at once. The CloudFront implementation puts the paths on a
bounded in-memory queue and a `BackgroundService` sends them. Inline was rejected for two reasons.
A slow CloudFront would hold a privacy switch open for the whole of the SDK's retries, and a call
made on the request's token is cancelled by the reader leaving, the trap above. Fire-and-forget on
a thread-pool task was rejected because it gives a failure nowhere to be retried from, and nothing
bounds how many are in flight.

- **One request per event**, carrying all of that event's paths, never split. Each request has a
  caller reference fixed when it is queued. CloudFront answers a repeated reference with the same
  paths by returning the invalidation it already made, per the SDK's own documentation of
  `CallerReference`, so a retry after a response lost on the way back cannot create a second one.
- **An event whose paths are already waiting is not queued again.** The one waiting is sent after
  both writes, so it covers both. One account saving in a loop holds one place in the queue rather
  than filling it ahead of everybody else's withdrawals. Once an event is taken off the queue to be
  sent, the same paths queue anew, because the request may reach CloudFront before the next write
  commits.
- **One at a time, at most one a second, per task.** CloudFront's quotas page, as read in October
  2026, lists 150 paths a second and one wildcard invalidation a second, and every event carries a
  wildcard. The SDK still names the refusal `TooManyInvalidationsInProgress`, from an older quota
  on invalidations in progress. A burst drains at the quota rather than throttling itself into the
  retry path. Two tasks during a deploy can exceed it, and are retried.
- **It copies [0038](0038-where-scheduled-work-lives.md)'s shape.** A singleton with nothing scoped
  in it, so no scope factory. Every failure of an attempt is caught, and anything else that throws
  is caught per withdrawal, as the sweep catches per tick, because an exception escaping
  `ExecuteAsync` stops the host under the `StopHost` that `ScheduledWork` sets. It is registered by
  `AddEdgeInvalidation`, not `AddScheduledWork`: it runs on a queue rather than a schedule, and
  touches no `HostOptions`. It runs once per ECS task without the sweep's advisory lock, because
  each task's queue holds only what its own requests withdrew, so no two tasks ever hold the same
  work.

### 5. Retried until the window closes, and the window made a real one

A failed attempt is retried after two seconds, doubling, to a ceiling of five minutes, which comes
to about twenty attempts. A backoff that would land past the window is cut short to one last
attempt just inside it. The retries stop **sixty-five minutes after the write**, `CACHE_PROFILE`'s
five minutes and its hour. By then every copy an edge fetched before the withdrawal has expired, and
an invalidation sent later would remove nothing. Giving up costs exactly the window the site had
before this existed. The horizon is restated on the server rather than shared, because the policy
is the client's, and a comment beside `CACHE_PROFILE` says that lengthening it should lengthen the
horizon too.

**That is true only because `CACHE_PROFILE` now says `stale-if-error=0`.** Without it, CloudFront
answers a 5xx from the origin by serving the expired copy it still holds, up to the cache policy's
maximum TTL, which is a year here. A page whose invalidation failed could then come back during any
later outage, long after its owner withdrew it. CloudFront's documentation gives
`stale-if-error=0` as the way to have it return the error instead. The cost is that during an
outage a profile shows the error rather than a stale copy, which for a page about consent is the
right way round. This gap predates the change; 0027's window was never really an hour without it.

**Every failure is retried, a refusal that will never succeed as much as a brownout.** One cannot
always be told from the other from here. A wrong id or a missing permission fails every attempt,
loudly: a warning per attempt, an error once the backoff first reaches its ceiling, about eight
minutes in, while sending the paths by hand would still help, and another when the window closes.
A permanent-error list would have to be kept right, and getting it wrong drops a withdrawal that
would have succeeded a minute later.

**A stopping task spends five seconds sending what it holds**, then logs, as errors and with their
paths, whatever is left. A deploy is the usual reason a task stops, and the pipeline invalidates
`/*` once the new task is serving (0046 §5), which covers the rest. A task replaced for another
reason gets no `/*`, which is why the drain is there. A task that dies outright loses its queue,
and those withdrawals keep the old window. A durable queue was not worth its own table for that.

The queue holds a thousand, far more than this site withdraws in the hour a failing CloudFront
could keep them waiting. What it bounds is memory. One that does not fit is logged with its paths,
and its write is unaffected.

### 6. A day's ceiling on paths, because any account can withdraw in a loop

Switching a profile from public to private and back costs two paths a cycle. With the pacing as the
only limit, one script holds it at a request a second: about 7,200 paths an hour, $36 an hour, at
$0.005 a path past the free thousand a month. The budget alarms (0044) alert; they do not cap. So
each task sends at most `CloudFront:DailyPathLimit` paths in a UTC day, 500 unless configured,
which bounds that to $2.50 a day a task. Past it, a withdrawal keeps the TTL window. The first one
refused each day is an error naming the ceiling, and the rest are logged at Debug, so a loop that
met it cannot fill the log as fast as it saves. 500 is room for a few hundred withdrawals a day,
which is far more than the site makes; raise it when that stops being true.

The ceiling bounds the bill, not who gets the allowance: an account looping until the ceiling is
met leaves the rest of that day's withdrawals to the TTL. A limit per account on the endpoints that
withdraw is what would stop that, and belongs with the rate limiting the site does not otherwise
have on those endpoints (0033).

### 7. Without a distribution id, nothing AWS is registered

`AddEdgeInvalidation` registers the CloudFront client, the queue and the hosted service only when
`CloudFront:DistributionId` is set. Otherwise it registers `LoggingEdgeInvalidator`, which logs the
paths it would have sent, so Development and the tests have no AWS client to reach anything with.
It logs at Debug in Development, where nothing is in front of `dotnet run`. Anywhere else it logs a
warning, because there a missing id is a deployment withdrawing consent in the database and
leaving the edge to its TTL. A startup failure, as the key ring has, was considered and rejected.
A deployment without the id is no worse than the site was before this, and refusing to start would
make it far worse.

The client names `us-east-1` rather than reading the task's Region. CloudFront's API is global: the
SDK resolves `cloudfront.amazonaws.com` whether it is given `us-east-1` or `eu-central-1`, checked
locally with its own endpoint resolver, so naming one only keeps the client from depending on
`AWS_REGION` being set. It takes its credentials from the task role, as the key ring's client does.
Each HTTP request is limited to ten seconds, against `HttpClient`'s hundred, and each attempt, the
SDK's own retries included, to thirty.

### 8. The application stack passes the id and grants one action on one distribution

The API container gets `CloudFront__DistributionId` from the distribution's `Ref`, because every
resume creates a new distribution with a new id. Its task role gets one statement,
`InvalidateWithdrawnProfiles`: `cloudfront:CreateInvalidation` on that distribution's ARN, and
nothing else. It does not get `GetInvalidation`, because nothing waits for one to finish.

The references run one way: the task definition and the role's policy wait for the distribution,
the distribution waits for the balancer, and neither refers back to a task or a service. The
synthesised application template has no cycle among its 28 resources, checked by walking every
`Ref`, `GetAtt`, `Sub` and `DependsOn` in it. The `Dns`, `EdgeCert`, `Data` and `Migrate`
templates are byte-for-byte what master synthesises.

## Consequences

- **A resume starts the API later, and a park stops it first.** The API service now waits for the
  distribution, which it did not before. On a resume it starts only once the distribution exists,
  after several minutes, so the resume takes about as much longer as the service takes to become
  stable. A park deletes the API service before the distribution. A release that updates the stack
  is unaffected.
- **Cost.** An event is one to three paths, and a wildcard is one path. The first 1,000 paths a month
  are free across the account, the deploy pipeline's `/*` included, and each path after that is
  $0.005, per AWS's pricing page as read in October 2026. The application sends at most 500 a day
  a task (§6).
- **What the task can now do.** Invalidate any path on this one distribution. The grant cannot be
  narrowed to paths: AWS's service reference lists no condition key for `CreateInvalidation`, and
  CloudFront's only condition keys are tags. The daily ceiling binds the application, not code
  running in the task, which could invalidate as fast as the quota of 150 paths a second allows:
  about $65,000 a day, from a role that until now could only read and write the key ring. A Budgets
  action that attaches a deny to the role would make the alarm a cap. The deploy role could already
  invalidate every distribution in the account.
- **The log lines an operator has.** Information when the sender starts, naming the distribution and
  the ceiling. Information for each withdrawal queued, with its paths, its reason and the caller
  reference every later line repeats. Information for each invalidation accepted, with CloudFront's
  id for it, how long after the write it went and on which attempt. A warning for each failed
  attempt, the stack trace only on the first and the error's code and status after that, with how
  many are waiting behind it. Errors for: the backoff first reaching its ceiling, the window closing,
  the queue full or stopped, the hand-off itself throwing, the day's ceiling first met, each
  withdrawal a stopping task never sent, and anything unexpected while sending one. And, outside
  Development, a warning for each withdrawal no distribution was configured to receive. No line has
  an event id, as none in the application does; a metric filter matches on the message's opening
  words, such as `Gave up invalidating`.
- **The paths name the account.** The log keeps the name for the log group's two weeks. CloudFront
  keeps every invalidation in the distribution's list, which cannot be edited, so a deleted
  account's name stays readable there to whoever can read the distribution, for as long as the
  distribution lives. In dev that ends with every park. CloudTrail's event history probably holds
  the request too; that was not checked. Sending `/u/*` for a deletion alone would keep the name out
  of all of them, at the price of every profile's cached copy, and is the change to make if that
  matters before production.
- **The AWS SDK's core moves from 4.0.3.17 to 4.0.102.8** with the CloudFront package, and the key
  ring's Systems Manager client runs on it too. The proof 0043 asks for, a session surviving a
  redeploy, should be repeated on the first deploy of this.
- **Not tested, and not testable here:** whether CloudFront accepts the request, whether the task
  role may make it, and what an invalidation does at the edge. The AWS client itself is not
  unit-tested. The queue, coalescing, the retry schedule, the horizon, the ceiling, the drain and
  the request built are unit-tested against a substitute client.

  By hand, against a local database: the six events, with no distribution configured, each logged
  the paths above. Then the API ran with a distribution id, made-up credentials and the SDK's
  endpoint pointed at a local stand-in for CloudFront. That run showed the request on the wire, a
  refused first attempt retried two seconds later under the same caller reference, and a stand-in
  that hung for twelve seconds. The reader's write still answered in under a second; the SDK timed
  the hung call out at ten seconds and its own retry was accepted. Only a deploy shows the rest. The
  check is: make a public profile private on dev and read `x-cache` on its next request.
