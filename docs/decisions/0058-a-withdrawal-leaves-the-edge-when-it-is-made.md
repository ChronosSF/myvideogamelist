# 0058. A withdrawal leaves the edge when it is made, and its retry stops when the TTL would have

**Status:** Implemented; nothing deployed. Closes the window
[0027](0027-usernames-and-public-profiles.md) records for a withdrawn profile (ROADMAP D14,
[#99](https://github.com/ChronosSF/myvideogamelist/issues/99)), for the page and for the profile
sitemap file [0036](0036-what-a-crawler-is-told.md) §5 gave the same window.

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
the sitemap files on the first three. Four things it left open, or did not know:

- **What the paths are.** The cache key holds more than the path. And the sitemap path the issue
  gives, `/sitemaps/profiles-*.xml`, is one CloudFront would read literally.
- **Inline or queued, and whether a failure is retried.**
- **What a failed invalidation does to the write that needed it.**
- **What the application stack hands the task, and in what order CloudFormation builds it.**

## Decision

### 1. Six events, each decided where its write is made

| Event | Where | Paths | Sends nothing when |
|---|---|---|---|
| Profile made private | `UserController.UpdatePrivacy` | `/u/{name}*`, `/sitemaps/profiles-*` | it was not public before the save |
| Profile renamed | `UserController.UpdateUserName` | `/u/{old}*`, `/u/{new}*`, `/sitemaps/profiles-*` | the profile is private, or only the letter case changed |
| Account deleted | `UserController.DeleteAccount` | `/u/{name}*`, `/sitemaps/profiles-*` | the profile was private |
| Review made private | `ReviewService.UpsertAsync` | `/u/{name}*` | the review was not public before the save, or the profile is not public now |
| Review edited | `ReviewService.UpsertAsync` | `/u/{name}*` | the same |
| Review deleted | `ReviewService.DeleteAsync`, and `ListService.DeleteEntryAsync` when the entry carried a public review | `/u/{name}*` | the same |

**Only a write that takes back something published counts.** The before-state decides it. A first
review, or a private one made public, publishes, and reaches the page when the TTL runs out like
any other new content. A favourite removed, a score changed, a statistic that moved: those are the
profile's content changing, and keep the window, as
[0029](0029-favourites-are-an-axis-and-a-showcase.md) and the statistics tiers' spec already say.

**Any rewrite of a public review is an edit,** whatever changed, because a rewrite also moves the
review to the top of the profile's newest-first list, so every page of the list has changed.
Telling the words apart to save one path is not worth a branch.

**A change of letter case is not a rename here.** It releases no name, and `/u/alice` and
`/u/Alice` render the same public page before and after it, so the edge is stale only as content
is.

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
- **It does not cover other letter case.** The lookup ignores case, so `/u/ALICE` renders this
  profile. Invalidation paths are case-sensitive. The site links only to the name as its owner
  wrote it, in its pages, its sitemap and its canonical URLs, so a copy under another case exists
  only if somebody typed it. That copy keeps the old window. `/u/*` would close the gap, at the
  price of emptying every profile from every edge on every review edit, anybody's. It was rejected
  for that. It is a one-line change in `ProfileWithdrawals.Profile` if the gap ever matters.

**The sitemap path is `/sitemaps/profiles-*`, not `/sitemaps/profiles-*.xml`.** CloudFront honours
a `*` only as the last character of a path, and its documentation says one anywhere else is matched
as a literal asterisk. The path as the issue wrote it would have been taken as the name of a file
nobody has, and invalidated nothing. One path covers every file, because a withdrawal moves every
later name into a different file. The sitemap index lists file names and nobody's name, and is left
alone.

### 3. After the commit, and never able to fail it

Each call is made once the write has committed. A refused write sends nothing. Every call goes
through `ProfileWithdrawals`, which catches and logs whatever the invalidator throws, deliberately.
A withdrawal that reached our tables has taken effect for every request that reaches the origin.
Answering it with an error because CloudFront did not answer would report a consent change that
happened as one that failed, and the user would try again at a change already made. The tests pin
this with an invalidator that throws, for every write: the write stands and the answer is a
success.

For the three review events, `ProfileWithdrawals` reads the author's name and visibility after the
write, so that a rename landing between the two is answered under the name the profile has now. It
reads them **without the request's cancellation token**. That token is cancelled when the reader
closes the tab, and passing it would let a closed tab cancel the invalidation of something the
database already holds. This is the one place the rule that every call takes the request's token
is broken, and the method says why.

### 4. Queued, sent from the background, one request per event

`IEdgeInvalidator.Invalidate` returns at once. The CloudFront implementation puts the paths on a
bounded in-memory queue and a `BackgroundService` sends them. Inline was rejected for two reasons.
A slow CloudFront would hold a privacy switch open for the whole of the SDK's retries, and a call
made on the request's token is cancelled by the reader leaving, the trap above. Fire-and-forget on
a thread-pool task was rejected because it gives a failure nowhere to be retried from, and nothing
bounds how many are in flight.

- **One request per event**, carrying all of that event's paths, never split and never merged
  with another event's. Each request has a caller reference fixed when it is queued. CloudFront
  answers a repeated reference with the same paths by returning the invalidation it already made,
  per the SDK's own documentation of `CallerReference`. So a retry after a response lost on the way
  back cannot create, or bill, a second one. Merging events would need a fresh reference per merged
  batch and lose that.
- **One at a time, at most one a second.** CloudFront's quotas page lists 150 paths a second and
  one wildcard invalidation a second, and every event carries a wildcard. A burst drains at the
  quota rather than throttling itself into the retry path.
- **It copies [0038](0038-where-scheduled-work-lives.md)'s shape.** A singleton with nothing scoped
  in it, so no scope factory. Every failure of an attempt is caught, because an exception escaping
  `ExecuteAsync` stops the host under the `StopHost` that `ScheduledWork` sets. It is registered by
  `AddEdgeInvalidation`, not `AddScheduledWork`: it runs on a queue rather than a schedule, and
  touches no `HostOptions`. It runs once per ECS task without the sweep's advisory lock, because
  each task's queue holds only what its own requests withdrew, so no two tasks ever hold the same
  work.

### 5. Retried until the window closes, and not a moment after

A failed attempt is retried after two seconds, doubling, to a ceiling of five minutes: about twenty
attempts in all. They stop **sixty-five minutes after the write**, `CACHE_PROFILE`'s five minutes
and its hour. By then every copy an edge fetched before the withdrawal has expired by itself. An
invalidation sent later would remove nothing, and giving up costs exactly the window the site had
before this existed. The horizon is restated on the server rather than shared, because the policy
is the client's. A comment beside `CACHE_PROFILE` says that lengthening it should lengthen the
horizon too.

**Every failure is retried, a refusal that will never succeed as much as a brownout.** One cannot
always be told from the other from here. A misconfiguration, such as a wrong id or a missing
permission, fails every attempt loudly anyway: a warning per attempt and an error when the window
closes. A permanent-error list would have to be kept right, and getting it wrong drops a
withdrawal that would have succeeded a minute later.

**What a stopping task holds is lost with it, and is logged with its paths.** The usual reason a
task stops is a deploy, and the pipeline invalidates `/*` once the new task is serving (0046 §5),
which covers it. A task that dies another way loses its queue, and those withdrawals keep the old
window. A durable queue was not worth its own table for that.

The queue holds a thousand. That is far more than this site withdraws in the hour a failing
CloudFront could keep them waiting. What it bounds is memory. One that does not fit is logged with
its paths, and its write is unaffected.

### 6. Without a distribution id, nothing AWS is registered

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

### 7. The application stack passes the id and grants one action on one distribution

The API container gets `CloudFront__DistributionId` from the distribution's `Ref`, because every
resume creates a new distribution with a new id. Its task role gets `cloudfront:CreateInvalidation`
on that distribution's ARN, through `Distribution.GrantCreateInvalidation`, and nothing else. It
does not get `GetInvalidation`, because nothing waits for one to finish.

The references run one way: the task definition and the role's policy wait for the distribution,
the distribution waits for the balancer, and neither refers back to a task or a service. The
synthesised application template has no cycle among its 28 resources, checked by walking every
`Ref`, `GetAtt`, `Sub` and `DependsOn` in it. The `Dns`, `EdgeCert`, `Data` and `Migrate`
templates are byte-for-byte what master synthesises.

## Consequences

- **A resume starts the API later.** The API service now waits for the distribution, which it did
  not before, so on a resume it starts only once the distribution exists, after several minutes,
  and the resume takes about as much longer as the service takes to become stable. A release that
  updates the stack is unaffected: the distribution already exists.
- **Cost.** An event is one to three paths, and a wildcard is one path. The first 1,000 paths a month
  are free across the account, the deploy pipeline's `/*` included, and each path after that is
  $0.005, per AWS's pricing page as read in October 2026.
- **What the task can now do.** Invalidate any path on this one distribution, as fast as the quota
  allows. Code running in the API task could empty the edge and spend money a path at a time. The
  grant names the action and the distribution, not paths: the paths are whatever the application
  sends. The budget alarms (0044) are the backstop. The deploy role could already invalidate
  every distribution in the account.
- **The log lines an operator has.** Information for each invalidation accepted, with its paths,
  its reason, CloudFront's id for it, how long after the write it went and on which attempt. A
  warning for each failed attempt, with the exception and the next delay. An error when the window
  closes, when the queue is full, or when the hand-off itself threw. A warning naming what a
  stopping task never sent, and, outside Development, for each withdrawal no distribution was
  configured to receive.
- **The paths name the account,** so the log keeps the name for the log group's two weeks.
  CloudFront keeps every invalidation in the distribution's list, which cannot be edited, so a
  deleted account's name stays readable there to whoever can read the distribution, for as long as
  the distribution lives. In dev that ends with every park.
- **The AWS SDK's core moves from 4.0.3.17 to 4.0.102.8** with the CloudFront package, and the key
  ring's Systems Manager client runs on it too. The proof 0043 asks for, a session surviving a
  redeploy, should be repeated on the first deploy of this.
- **Not tested, and not testable here:** whether CloudFront accepts the request, whether the task
  role may make it, and what an invalidation does at the edge. The queue, the retry, the horizon and
  the request built are unit-tested against a substitute client, and the AWS client itself is not
  unit-tested. By hand, against a local database: the six events, with no distribution configured,
  each logged the paths above. Then the API ran with a distribution id, made-up credentials and the
  SDK's endpoint pointed at a local stand-in for CloudFront. That run showed the request on the
  wire, a refused first attempt retried two seconds later under the same caller reference, and a
  stand-in that hung for twelve seconds. The reader's write still answered in under a second; the
  SDK timed the hung call out at ten seconds and its own retry was accepted. Only a deploy shows
  the rest. The check is: make a public profile private on dev and read `x-cache` on its next
  request.
