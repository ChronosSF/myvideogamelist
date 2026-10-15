# 0059. A request is known by its trace from the page to the API's log, and a build by its commit

**Status:** Implemented. OpenTelemetry and the alarms are still
[#103](https://github.com/ChronosSF/myvideogamelist/issues/103); this is the part of it that needs no
change to the environment.
**Amends:** [0034](0034-failing-in-one-shape.md) §5, whose `traceId` was ASP.NET's request identifier

## Context

#103 asks for structured logs carrying a correlation id from the SSR server into the API, OpenTelemetry
through the ADOT collector, alarms, and a `/version` endpoint. The tracing needs a collector beside the
tasks, and the alarms are among what [0044](0044-what-the-deployment-walkthrough-settled.md) left for after
the first deploy, on [#109](https://github.com/ChronosSF/myvideogamelist/issues/109): both are changes to
the environment. The issue's point about the rest is that it makes a deploy debuggable, and before this
change it was not:

- **Nothing joined a page to the API's log.** The SSR server's calls to the API carried nothing of the
  page's. [0034](0034-failing-in-one-shape.md) §5 put a `traceId` in every error body "so a user's
  report can be matched to a log line", but its value was `HttpContext.TraceIdentifier`, a connection id
  and a request number such as `0HNPALQ7VHNMD:00000001`, which named one API request and nothing the page
  or its reader could see.
- **The page had nothing to quote.** A 502 said "Failed to load game.", and the 502 is the failure a
  reader is most likely to report.
- **The log was the simple console formatter.** Each entry takes two lines and an exception's stack
  twenty more. CloudWatch makes an event of every line, so a deployed stack trace arrives as twenty
  events with nothing to say they belong together, and no field can be queried.
- **Nothing said which commit was running.** "Which SHA is live" was a question for ECR and the
  workflow's history, not for the site.

Three facts, measured on .NET 10.0.11, shaped the answer:

- **ASP.NET already starts an `Activity` for every request and continues a W3C `traceparent`.** A
  request that arrives with one runs under the caller's trace id, with the caller's span as its parent.
- **.NET 10's default propagator is W3C-only.** `DistributedContextPropagator.Current` is the
  `W3CPropagator`, so a legacy `Request-Id` is ignored and most malformed headers are dropped. Not all
  of them: see §3.
- **The API sends no trace headers out.** In a bare application with nothing listening to the HTTP
  client's activities, which is the API's case, an outbound call carried no `traceparent`, `tracestate`
  or `baggage`, whatever its caller had sent.

## Decision

### 1. The id is a W3C trace id, and it starts at the SSR server

Every request React Router routes draws a trace in the root's `middleware`, before any loader runs: a
128-bit trace id and a 64-bit span id, from the platform's cryptographic source. That covers a document,
a `.data` navigation and a resource route alike, and each is a trace of its own. Every call a loader makes
to the API goes through **`loaderFetch(context, path)`**, which sends
`traceparent: 00-{trace id}-{span id}-01`, and the API continues it. One render, one id: on the
document's `X-Trace-Id`, on every line the API logs while serving the render's calls, and in any
`ProblemDetails` it answers them with. The few requests React Router answers before any middleware runs,
a method it does not route or an action from another origin, carry no `X-Trace-Id`, and a failure logged
about one says `trace none` rather than name an id that is on no response.

- **`traceparent` rather than a header of our own.** ASP.NET reads it with no code at all, and it is what
  an OpenTelemetry SDK reads and writes. When #103's tracing arrives, the API's activity is the span the
  .NET SDK exports, and nothing here changes. On the SSR side, a Node SDK's HTTP instrumentation injects
  the header itself; `loaderFetch` then takes the active span's context instead of drawing one, and the
  two must not both set it.
- **The one place is `loaderFetch`, and the lint enforces it.** ESLint refuses an import of `apiUrl`
  anywhere but `loaderFetch`'s module; `apiFetch`, which the browser calls, sits beside `apiUrl` in
  `@/lib/api`. Refused at the import, a URL kept in a variable first is refused as well. A call made any
  other way would reach the API under a trace of its own, and the page would name an id the API's log
  never saw.
- **The trace lives in React Router's context, not in `AsyncLocalStorage`.** Middleware and context are
  React Router 8's documented way to hand a loader a per-request value. A loader that forgets the
  argument is a type error rather than a silent miss, and nothing reaches for `node:async_hooks`. The
  module is `trace.server.ts`, which React Router refuses to put in a browser bundle.
- **A viewer's own `traceparent` is ignored.** The trace starts here, and a reader does not choose what
  our logs call the render behind their page.
- **Sampled, `-01`.** The SSR server does keep the id: on the response, and in its own log when a render
  fails or a call never reaches the API. And an OpenTelemetry SDK's default sampler follows the parent's
  flag, so under `-00` the API's own SDK would record none of the spans a render causes.

### 2. A browser's own call is the root of its own trace

The client's fetches after hydration go to the API directly, through the edge's `/api/*` behaviour, and
send no `traceparent`. The API starts a trace for each, answers with its id in `X-Trace-Id` and, when it
fails, as `traceId`. The SSR server is not in that path and does not need to be.

### 3. What the API does with it

- **`ProblemDetails.traceId` is the request activity's trace id**, set in one place,
  `Errors/ProblemDetailsShape.cs`. That reaches everything 0034 §5 requires to go through
  `IProblemDetailsService` or MVC's problem details factory: the 403 from the write guard, the 429, a
  validation 400, the 502 and 503 handlers, and the framework's 500.
- **`X-Trace-Id` is on every answer the application writes**, set when the response starts, for the
  reason `SecurityHeadersMiddleware` sets its headers then: the exception handler clears the headers
  before it writes a 500.
- **Every activity is forced into the W3C format** (`Activity.ForceDefaultIdFormat`). Most malformed
  headers are dropped by the propagator, and the request starts a trace of its own: garbage, upper-case
  hex, an all-zero trace or span id, version `ff`, a version-00 header with extra fields. One kind gets
  through. The recommendation lets a later version carry more fields than version 00 does, so the
  propagator passes such a header on, the activity's parser refuses it, and the activity falls back to
  the hierarchical format. Its trace id is then all zeros, while the `TraceId` scope on every log line
  is the header's own text: the body and the log name the request differently, and the log carries
  whatever the caller wrote. Forced, that request starts a trace of its own too, which is what the
  recommendation asks of a receiver that cannot read what it was sent. Measured both ways, and
  `ApiPipelineTests`, which runs the real `Program.cs`, fails without it.
- **A caller can choose the id their own request is logged under, for now.** CloudFront's `/api/*`
  behaviour forwards every viewer header, so a browser's `traceparent` reaches the API, which continues
  it as it continues the SSR server's. Nothing keys on the id and it authorises nothing, so what that buys
  is lines planted under an id somebody else will search for, a public one from a shared page included.
  The place to refuse it is the edge, not here: only browsers come through `/api/*`, and the SSR server
  reaches the API inside the VPC, so an origin request policy that drops `traceparent`, `tracestate` and
  `baggage` on that behaviour costs nothing. That is a change to the environment, and it is on #103 to be
  made before OpenTelemetry samples on the parent's flag, which would otherwise let a caller decide what
  is traced.

### 4. The API logs one JSON object per line, outside Development

`AddApiConsole` switches the console to the built-in JSON formatter wherever the environment is not
Development: every scope, a UTC timestamp to the millisecond, one line per entry, and an exception's
stack inside its own line. The encoder is the relaxed one, which still escapes quotes, backslashes and
control characters but leaves `<`, `>` and `+` alone, so that a stack frame of an async method reads as
written in the raw stream rather than as `<QueryAsync>d__12`. Development keeps the plain
console a person reads. Activity tracking is stated (`TraceId`, `SpanId`, `ParentId`) rather than
inherited from the host's default, because the correlation rests on it, and it must not grow `TraceState`
or `Baggage`, which are a caller's text.

So every line written while serving a request carries, as scopes, its `TraceId`, its `SpanId`, a
`ParentId` that is the SSR server's span when a render made the call, and the `RequestPath` and
`RequestId` that ASP.NET adds. Printing scopes at all is new, since the plain console never showed them,
so what they hold was checked: those, the connection id, MVC's action, and the HTTP client's URL with its
query already redacted. Nothing of ours opens one.

**The status is on a line of its own, because it cannot be a scope.** A scope is opened before there is
a response to have a status. Each request leaves one line once it is answered,
`{Method} {Path} answered {StatusCode} in {ElapsedMilliseconds} ms, trace {TraceId}`, from middleware
placed above the exception handler, beside the forwarded headers, because it has to see the status that
handler ends a failed request with. That line is also what an id finds when nothing went wrong.
`/healthz` writes none, because the balancer asks every few seconds. ASP.NET's own "Request starting" and
"Request finished" lines are written at `Information` and stay switched off, by the `Warning` that
`Microsoft.AspNetCore` is held at: they print each request's whole URL, query included, which was
checked. A test holds both settings files to that, asking the category that writes them.

**What a line may contain, and what it may not:**

- The method, the path and the status, the duration, and the trace ids. A path can carry a username,
  which is a public handle (0027).
- **Never a query string.** A search term is whatever somebody typed, an email address included.
  Outbound calls log their URL with the query already redacted (`?*`): .NET does this by default,
  checked. IGDB's credentials travel in a form body and its queries in POST bodies, and neither is
  logged.
- **Never a header**, so never a cookie or a token. Nothing here reads one.
- **Never a constraint violation's detail.** That detail names the key, which on the email index is an
  address. Npgsql leaves it out of the exception unless the connection string says
  `Include Error Detail`, checked against a duplicate address, and no environment's connection string
  says it. It must not.
- The path goes through `LogText` like every other value from a request.

### 5. Each process says which commit it was built from

| | API | SSR server |
|---|---|---|
| Path | `GET /api/version` | `GET /version` |
| Answer | `{ "sha": "…", "builtAt": "…" }` | the same |
| Read from | `Build:Sha`, `Build:Time` (env `Build__Sha`, `Build__Time`) | env `BUILD_SHA`, `BUILD_TIME` |
| Caching | `no-store` | `private, no-store`, and `noindex` |

Both Dockerfiles take `GIT_SHA` and `BUILD_TIME` build arguments, default `unknown`, and turn them into
those variables, with the OCI `revision` and `created` labels beside them. The deploy workflow passes the
full commit it checked out and one build time for the release. Compare the two answers by `sha`:
`builtAt` is each image's own, and a re-run that finishes a half-pushed release builds the second image
later. Without the arguments, on a developer's machine or in a bare build, each says `unknown`. Neither
endpoint asks anything of anything else, so each answers whenever its process does. That is the promise
`/healthz` makes.

- **The arguments come last in each final stage.** A build argument that changes misses the cache for
  every `RUN` after its declaration, and these change on every commit. Anywhere earlier, every build
  would reinstall the packages above them.
- **The API's is under `/api/`, unlike `/healthz` and `/readyz`, and is a controller like every other
  API endpoint**, uncached by the attribute the others use. One hostname serves both processes, and the
  balancer sends every path it does not name to the SSR server. At the same path the two would collide:
  the API's could be reached through the distribution only by a listener rule, and that rule would hide
  the SSR server's. Under `/api/` it is routed like every other API call. So "which commit is live" is
  one request to each, through the door, with no infrastructure change.
- **What it reveals.** The repository is public, so a commit tells an attacker exactly which fixes are
  deployed. Dev is behind basic auth. Production decides whether both stay reachable, as it decides for
  `/readyz` (0044, D-5).

### 6. The error page shows the id when the failure carries it

A loader whose call to the API failed throws `upstreamFailure(context, message)`: an uncached 502 whose
body is `{ message, traceId }`. The root's error boundary shows the sentence and, under it, "If you report
this, quote …" with the id.

- **The id travels in the error rather than in the root's loader data.** The error page is also what a
  client-side navigation lands on. That request was a `.data` fetch with a trace of its own, and the root's
  data, loaded with the document, would name the wrong request. Revalidating the root on every navigation
  would fix the name at the cost of a request on every navigation to a page that has no loader.
- **The id always finds a line.** React Router never logs a `Response` a loader throws, so the 502 is not
  logged as such. If the API answered, it logged the failure itself under the same id. If the call never
  reached it, `loaderFetch` logs that, with the cause and the path but not its query, because nothing
  else would.
- **A 404 shows none.** It is an answer, not a failure anybody needs to report.
- **An unexpected exception shows none.** In production React Router replaces it with a generic error
  before the page sees it, and the page cannot say which request produced it. Its id is still on the
  response's `X-Trace-Id`, and on the line `entry.server.tsx`'s `handleError` writes for it:
  `{METHOD} {path} failed, trace {id}:` with the error, as React Router's default logs it but with the
  trace. A part of a streamed page that fails after the shell is logged the same way.
- **On a page the edge shares, the id names the render that filled the cache.** That render's calls
  produced what every later reader sees, so it is still the id to report. It is not a validator and not
  the content policy, so 0053's rules are untouched, and a HEAD carries it too.

## Consequences

- **A loader calls the API with `loaderFetch` and nothing else.** Loaders take `context`, and a test that
  calls one directly passes a `RouterContextProvider`.
- **Middleware above the exception handler is now the request log as well as the forwarded headers.**
  `.claude/rules/backend.md` says so, and anything else added there needs the same reason.
- **One line per request reaches CloudWatch**, a few hundred bytes of JSON each, which at dev's traffic
  is nothing. If production's volume makes it a cost, the balancer's access logs to S3 are the cheaper
  record of the same facts, and this line can go to `Debug`.
- **The SSR server's own log stays plain text.** It writes almost nothing but failures, and the first
  line of each carries its trace id; a stack's other lines still arrive in CloudWatch as events of their
  own.
- **The id on a shared page is public.** It names a render, and nothing secret follows from it.
- **Left for #103:** OpenTelemetry through ADOT, which needs no change on the API side; the alarms on the
  5xx rate, p99 latency, task restarts, database connections and the IGDB failure rate, which the request
  line's status and duration can feed; the edge dropping a viewer's trace headers on `/api/*` (§3); the
  SSR server's stacks kept to one event; and a deploy check that `/version` and `/api/version` answer the
  `sha` that was deployed.
