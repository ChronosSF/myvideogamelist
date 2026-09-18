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
  `GetUpcomingReleasesAsync` pages ten times in a row to fill the calendar.

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
| Rate limiter | 4 per second, quarter-second segments, queue 64 | IGDB's documented ceiling. Outermost, so waiting for a permit is not charged to an attempt's timeout and a burst queues rather than failing |
| Retry | 2 attempts, 1s base, exponential with jitter | The caller is a page somebody is watching. This is for riding out a dropped connection or one 429, not persistence |
| Circuit breaker | 50% of a 30s sample, 8 minimum, 15s break | Retrying into an outage turns one failure into three, and each holds a request open here |
| Timeout | 10s per attempt | A page that is going to fail should fail while the reader is still there |

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

### 3. A reader who navigates away is not a server error

A cancellation raised while `RequestAborted` is cancelled is swallowed with **499** and no body —
there is nobody to write one to. Left as a 500 it would be logged as a server error and would fire
the 5xx alarm this deployment is going to have, on people changing their minds.

A `TaskCanceledException` with the request still live is the opposite case — a timeout on our side
of the call — and falls through to the 502 above. Treating it as a disconnect would hide a real
upstream failure behind a status nobody alarms on.

### 4. One shape for every error body

`ProblemDetails` everywhere, carrying `traceId` so a user's report can be matched to a log line.
The exception itself is included **in Development only**, which is what the raw 500 was worth
reading for; putting it in a deployed answer would hand out stack traces.

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
- **The retry budget is inside the user's wait.** Worst case for one call is now roughly two
  retries plus backoff inside a ten-second attempt ceiling, rather than one attempt that could hang
  for a hundred seconds. The composite `/api/home` fans out, so its cold path is bounded by the
  slowest of those, not their sum.
- Error responses are uncacheable without anything of ours doing it: the framework's handler sets
  `no-store` on them. That happens to be exactly what 0013 requires, but it is the framework's
  behaviour rather than ours, so a route that degrades to a **200** still has to say `no-store`
  itself.
