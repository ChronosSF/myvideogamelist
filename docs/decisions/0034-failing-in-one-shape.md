# 0034. Failing in one shape: IGDB is retried and broken, and every error says so the same way

**Status:** Implemented

## Context

Game data comes from IGDB ([0001](0001-igdb-as-source-of-truth.md)) and every call to it was one
attempt followed by `EnsureSuccessStatusCode`. Three things followed from that:

- **A single dropped connection was a 500 on somebody's game page.** No retry, and the client's
  own 100-second default timeout, so a hung call held a request open for a minute and a half before
  failing.
- **A bad afternoon at IGDB was thousands of them**, each one paying the full wait, and each one
  adding to whatever IGDB was already struggling with.
- **Nothing paced the calls**, though IGDB documents a limit of four a second and
  `GetUpcomingReleasesAsync` pages ten times in a row to fill a month of upcoming releases.

Meanwhile an unhandled exception left as a raw 500 — an HTML developer page in Development that a
JSON client cannot read, an empty body everywhere else — and a reader who navigated away
mid-request produced the same 500, because every controller takes a `CancellationToken` and the
cancellation unwound as an exception.

The mismatch worth naming: the front end already calls an unreachable API a **502** in its own
loaders, deliberately, because `fetch` rejecting is not the same as the app being broken. The API
described the identical situation — a third party that did not answer — as a 500.

## Decision

### 1. A resilience pipeline on the IGDB client, outermost first

| Strategy | Setting | Why |
|---|---|---|
| Total timeout | 30s | The ceiling on everything below, retries and queueing included |
| Retry | 2 attempts, 1s base, exponential with jitter | The caller is a page somebody is watching. This is for riding out a dropped connection or one 429, not persistence |
| Circuit breaker | 50% of a 30s sample, 8 minimum, 15s break | Retrying into an outage turns one failure into three, and each holds a request open here |
| Rate limiter | Token bucket: four tokens, one back every 250ms, queue 64 | IGDB's documented ceiling. A burst queues rather than failing; past the queue's depth it is refused, which §3 turns into a 503 |
| Attempt timeout | 10s | A page that is going to fail should fail while the reader is still there. Innermost, so waiting for a permit is not charged to it |

**The order is the design, and the obvious arrangement is wrong.** The first version of this record
had the rate limiter outermost, which paced *operations* rather than requests: one permit covered a
call and both of its retries, so four permits a second admitted up to twelve requests a second at
IGDB — three times the limit the limiter exists to keep. Raised in review on the pull request that
introduced it, and fixed before merge.

So retry is outermost and the limiter sits below it, where every actual attempt takes a permit of
its own. **The breaker stays above the limiter** deliberately, which the review did not ask for:
below it, a call that an open circuit is going to refuse would first consume a permit and make real
calls queue behind a failure already decided. The cost of the new order is latency — three attempts
may each wait for a permit — so the total timeout bounds the operation from the outside.

**The limiter is a token bucket rather than a window**, which is the second thing review caught
here, and measurement settled it. A sliding window of four a second over four segments hands out
all four permits at once and returns them together a second later: acquisitions landed at 0, 0, 0,
0, 1003, 1003, 1003, 1003ms — an average of four a second made of bursts, not the pacing the code
claimed. A bucket of four tokens gaining one every 250ms measured 0, 0, 0, 0, 264, 512, 760ms from
idle and ~247ms apart under sustained load.

A capacity of one, the strict pacing the review suggested, was measured too and rejected: it
charges 250ms to the second and third call of every cold games page and home composite, which are
the pages that have to be fast for a crawler, and it buys nothing — four calls inside one second is
what a limit of four a second allows.

**Retrying a POST is safe here**, which is worth stating because it usually is not. IGDB's query
protocol is a POST with the query in the body, and this app makes no IGDB writes at all, so a
repeated request cannot duplicate anything.

### 2. Somebody else's failure is a 502, not a 500

`HttpRequestException`, a broken circuit, a Polly timeout and a timed-out task become **502** with a
sentence that says which part of the page is affected and which is not — game data comes from
IGDB; lists, scores and playthroughs are ours and are unaffected. Anything else is left to the
framework's 500, which is the honest answer to a bug here: retrying it would not help.

The circuit breaker makes this the common case rather than a rare one. Once it opens, every request
fails immediately with no HTTP call at all, which is the point.

### 3. Our own throttle is a 503

Past the limiter's sixty-four-deep queue the call is refused, and that refusal used to leave as a
500 — an application fault, which it is not. It is this app protecting IGDB's documented limit
under a load spike, so it answers **503** with a sentence that says browsing is busy and the
reader's own data is unaffected, and passes on `Retry-After` when the limiter supplies one.

503 rather than 429, which the review raising this offered as the alternative: a 429 tells callers
*they* asked too often, and they did not. The queue they are behind is everybody's.

### 4. A reader who navigates away is not a server error

A cancellation raised while `RequestAborted` is cancelled is swallowed with **499** and no body —
there is nobody to write one to. Left as a 500 it would be logged as a server error and would fire
the 5xx alarm this deployment is going to have, on people changing their minds.

A `TaskCanceledException` with the request still live is the opposite case — a timeout on our side
of the call — and falls through to the 502 above. Treating it as a disconnect would hide a real
upstream failure behind a status nobody alarms on.

### 5. One shape for every error body

`ProblemDetails` everywhere, carrying `traceId` so a user's report can be matched to a log line.
The exception itself is included **in Development only**, which is what the raw 500 was worth
reading for; putting it in a deployed answer would hand out stack traces.

**Everywhere means through `IProblemDetailsService`, not into the shape by hand.** The rate
limiter's 429 was serialised directly at first and so was the one error in the API with no
`traceId` — on the response somebody is most likely to report. Review on #89 caught it; the
customisation only reaches responses written through the service.

The client already read `title` and `detail` on the game page; `AuthProvider` learned to, so the
one place where the fallback would be actively misleading — a rate-limited login reading as
"Login failed" — says what actually happened.

## Consequences

- **The security headers had to move to the response's start.** `UseExceptionHandler` clears the
  response, headers included, before writing its own, so headers set on the way in were gone by the
  time a 500 or a 502 went out. They are registered with `OnStarting` now. Found by testing the
  failure path rather than the healthy one, which is the second time in this codebase that
  `docs/decisions/0013-http-caching-policy.md` has made the same point.
- **`/readyz` is unchanged and still returns 200 when IGDB is down**, because the health check
  catches every non-cancellation exception, a broken circuit included. Verified: degraded, 200.
  Browsing breaks during an IGDB outage; stored lists, stats and the export never touch that client.
- **The rate limiter is per process.** Two instances double what IGDB sees. The shared limit belongs
  with the distributed cache, which is also the thing that would stop two instances asking the same
  question twice.
- **The retry budget is inside the user's wait**, and so is the queueing. Worst case for one call is
  the thirty-second total timeout, rather than one attempt that could hang for a hundred seconds.
  The composite `/api/home` fans out, so its cold path is bounded by the slowest of those, not their
  sum.
- Error responses are uncacheable without anything of ours doing it: the framework's handler sets
  `no-store` on them. That happens to be exactly what 0013 requires, but it is the framework's
  behaviour rather than ours, so a route that degrades to a **200** still has to say `no-store`
  itself.
