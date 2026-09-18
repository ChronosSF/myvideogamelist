# 0033. What the API refuses: guessing, volume, forged writes, and unattributed addresses

**Status:** Implemented

## Context

Everything in this app so far has been about what it can do for somebody signed in. None of it
said what happens when the request is not theirs.

Concretely, before this record: `PasswordSignInAsync` was called with `lockoutOnFailure: false`,
so Identity counted nothing and a password was guessable as fast as a client could ask; nothing
limited the rate of anything; not one response carried a security header, so a browser was free to
sniff a JSON body into a script and any page anywhere was free to frame ours; and cookie
authentication with no second factor on a write meant a form on another site could act as the
signed-in user with their own browser's cookie attached. `SameSite=Lax` withheld the cookie from
the plainest version of that attack, which is why the gap never showed, but a browser default is
not a rule this app states.

Two facts about the deployment shape it is heading for ([0003](0003-two-process-deployment.md),
[0007](0007-aws-target-architecture.md)) change what a correct answer looks like:

- **The front end renders on a server of its own.** Every loader fetch reaches this API from that
  one process, so "requests from one address" is not a proxy for "requests from one visitor".
- **A load balancer terminates TLS.** The address and the scheme the app sees are the balancer's,
  not the caller's, unless it is told to believe a header — and believing that header from an
  unnamed source is worse than not believing it at all.

## Decision

### 1. Lockout counts failures; the rate limiter is the half that may speak

Five wrong passwords locks an account for fifteen minutes.

A locked account answers **exactly as a wrong password does** — the same 401, the same sentence.
Saying "this account is locked" would make five deliberate failures against any address a way to
ask whether that address has an account here, which is the same question the shared
"invalid email, username or password" message already exists to refuse. A person who really is
locked out gets no explanation from this endpoint, and that is the cost.

What they do get is the other half. Ten attempts per address per five minutes, and the eleventh is
a 429 that says plainly that there have been too many attempts. That is safe to say because the
limit is keyed on the caller's address: it reveals nothing about which accounts exist.

The two cover different attacks and neither replaces the other — the lockout is what stops one
account being guessed from many addresses, the limiter is what stops one address working through
many accounts.

### 2. The limit is on the two endpoints that take a password, and nowhere else

Not the whole API, and not even the whole of `/api/auth`. Login and register are called by browsers
directly and by nothing else, which is what makes the client address a meaningful partition for
them. `/api/auth/me` is excluded because every page load calls it; anything a loader touches is
excluded because, per the context above, the SSR process would be a single bucket holding every
visitor — a limit there throttles the site as one abusive client.

Volume control for the rest belongs at the edge, with the CDN and its WAF, where the viewer's
address is known before anything of ours is reached.

**A sliding window rather than a fixed one**, decided by measurement rather than preference: the
fixed-window limiter does return `Retry-After`, but the figure is the whole window rather than the
time remaining, so it overstates the wait for everyone who did not arrive exactly at a boundary,
and it lets twice the budget through across one. The sliding limiter reports no `Retry-After` at
all, so the message is vague on purpose. The code still honours the metadata if a future limiter
supplies it.

### 3. A write must carry a header only our own code can set

Every `POST`, `PUT`, `PATCH` and `DELETE` must carry `X-MVGL-Request`. Its value is never read.

What it proves is where the request came from. A form on another site can post anywhere but cannot
add a header. Script on another site can add one, but that makes the request non-simple, so the
browser asks this API for permission first — and this API answers no CORS preflight, because no
cross-origin policy is configured. **A permissive CORS policy would hand the missing header
back**, which is why that is written where the check lives and not only here.

A token in a cookie echoed in a header is the other standard answer, and it was rejected because it
buys nothing here. What makes the double submit work is precisely that an attacker cannot write the
header; this relies on that directly, and has no token to mint, store, rotate, or hand to a
server-rendered page.

On the client every write goes through `apiFetch` in `@/lib/api`, which adds the header and the
session cookie. A write sent with bare `fetch` is refused in local development exactly as it would
be in production — a loud way to find out, rather than a quiet one.

### 4. Forwarded headers are opt-in, and turning them on without a trust list is a startup failure

Off by default, because `dotnet run` serves the browser directly. A deployment behind a proxy turns
the section on and names that proxy by address or CIDR. Enabling it without naming one throws at
startup rather than doing either wrong thing quietly — ignoring the header (the default, since only
loopback is trusted) or believing anyone who sends it, which would let a caller choose the address
this app rate-limits and logs them under.

`ForwardLimit` is configuration because the right value is a fact about the deployment: one proxy
appending to the header is 1, a CDN in front of it is 2. It cannot be settled in a source file
before the topology exists.

Only the address and the scheme are honoured. `X-Forwarded-Host` stays ignored: the host is what
link generation and cookie domains key on, and `AllowedHosts` already states it.

### 5. Two sets of security headers, because two processes serve different things

| | API (ASP.NET) | Documents (SSR) |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | `nosniff` |
| `Referrer-Policy` | `no-referrer` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` | `DENY` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` | `frame-ancestors 'none'` |

The API's is the strictest policy there is, because JSON loads nothing and frames nothing. The
OpenAPI document and the Scalar UI are exempt from that one directive, being the only thing this
process serves that is a page.

**The document headers are applied in `entry.server.tsx`,** which the app now owns for that reason
alone. It is the only place every document response passes through: a route's `headers` export is
bypassed by a thrown `Response`, so 404s and 502s — the answers least worth sending bare — would
otherwise go out without them. Verified against a live 404. The file is otherwise
`react-router reveal`'s output and says so, because it now has to be re-diffed on a React Router
major.

**A policy naming `script-src` is the valuable half of CSP and is deliberately absent.** React
Router hydrates from an inline script, so restricting scripts means a per-request nonce handed to
`<Scripts nonce>`, and a wrong nonce is a blank page rather than a warning. That is a change of its
own, not a line in this one.

HSTS ships alongside: a year, subdomains included, deployed only. Preload stays off — submission to
the browsers' preload list is slow and awkward to undo, and belongs to whoever owns the domain
rather than to a default in a source file.

## Consequences

- **Calling a write endpoint by hand needs the header**, `curl -H 'X-MVGL-Request: 1'` included, and
  so does Scalar's "try it". That is the price of the guard being uniform rather than exempting the
  environment where it would otherwise never be exercised.
- **A CORS policy cannot be added casually.** `Access-Control-Allow-Headers` admitting
  `X-MVGL-Request` from an arbitrary origin undoes §3 completely. If cross-origin access is ever
  needed it has to be a named origin, and this guard re-thought alongside it.
- **CloudFront must forward `X-MVGL-Request`** on the behaviours that carry writes, or every write
  fails with a 403 that looks like a bug in the app.
- **The rate limiter's partitions live in one process's memory**, so two instances mean twice the
  budget per address. The lockout does not have that problem: it is a column in the database. A
  shared limit belongs with the distributed cache in the roadmap's §5.
- **`ForwardedHeaders` must be configured as part of the first deployment**, and its `ForwardLimit`
  revisited when the CDN lands. Left off behind a TLS-terminating balancer, `UseHttpsRedirection`
  redirects every request that already arrived over HTTPS.
- Identity's lockout applies to `PasswordSignInAsync` only. When social login or a password reset
  ships, each needs its own thought about counting and about what it admits.
