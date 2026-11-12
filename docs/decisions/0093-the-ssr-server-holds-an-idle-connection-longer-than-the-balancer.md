# 0093. The SSR server holds an idle connection longer than the balancer does

**Status:** Implemented. Whether the sporadic 502s are gone shows only on a deployed site, in the
balancer's `HTTPCode_ELB_502_Count`. [#439](https://github.com/ChronosSF/myvideogamelist/issues/439), part
of [#109](https://github.com/ChronosSF/myvideogamelist/issues/109).

## Context

- **The balancer reuses its connections to a target.** Between requests it keeps each one open for up to its
  idle timeout. Ours is 60 seconds (`IdleTimeout` in `infra/src/Infra/AppStack.cs`), which is also AWS's
  default.
- **The SSR server closed them after five.** The image ran `react-router-serve`, which builds its Express app
  and its Node HTTP server inside its own `run()` and returns neither. In `@react-router/serve` 8.5.0's
  `dist/cli.js` there is no option, environment variable or hook for the server's timeouts. So the server
  kept Node's default `keepAliveTimeout`: 5 seconds.
- **That is the 502 AWS describes.** The Application Load Balancer guide's troubleshooting page lists, under
  HTTP 502, "The target closed the connection with a TCP RST or a TCP FIN while the load balancer had an
  outstanding request to the target". Its advice is to check "whether the keep-alive duration of the target
  is shorter than the idle timeout value of the load balancer". The attributes page recommends that the
  application's idle timeout be "larger than the idle timeout configured for the load balancer". When Node
  closes a connection, the balancer can send a request down it before the close arrives. The viewer gets a
  502 that no log of ours records. It needs a request to arrive about five seconds after the previous one on
  the same connection, which is how a few people clicking around a quiet site behave.
- **The other hops are already the right way round.** Kestrel's `KeepAliveTimeout` defaults to 130 seconds,
  and `Program.cs` leaves it alone, so the API outlasts the balancer. CloudFront's keep-alive to its origin
  defaults to 5 seconds, so on that hop the client, CloudFront, gives up first, which is the safe side.
- **Node 24 runs TypeScript as it is.** It strips the types, with no flag, and 24.22 prints no warning. The
  image's `node:24-slim` is 24.22.3 today.

## Decision

### 1. A server of our own keeps an idle connection for 65 seconds

`server/index.ts` is the SSR server. The image runs it, and so do `npm start` and the harness that the smoke
test and the Lighthouse audit share. `server/serve.ts` sets two numbers on the server before it listens:

- **`keepAliveTimeout` is the balancer's 60 seconds plus 5.** The balancer is then always the side that
  closes an idle connection, so it never sends a request down one that is closing. Any value over 60 closes
  the gap. The 5 is a margin, not a measurement. Node also adds `keepAliveTimeoutBuffer` (one second by
  default, since 24.6) to the socket's own timeout. The `Keep-Alive` header still says 65.
- **`headersTimeout` is 66 seconds.** Node 24 times only a request whose headers have started to arrive, so
  an idle connection never meets this. Seen on 24.22.1: with `headersTimeout` at one second and the
  keep-alive at ten, an idle connection stayed open, while one that had sent half its headers got a 408 after
  a second. The value stays above the keep-alive anyway, as #439 asks, in case Node ever times it from
  somewhere else. Node's default, 60 seconds, would sit below the keep-alive. The cost is that a client
  sending its headers slowly is cut off at 66 seconds, not 60.

`BALANCER_IDLE_TIMEOUT_MS` restates the stack's 60, and the keep-alive is derived from it. Two checks keep
the two files in agreement. `server/serve.test.ts` reads `AppStack.cs` and fails when the numbers differ.
CI's Images job starts the built image and reads the `Keep-Alive: timeout=` it sends. The job fails unless
that value is above the stack's `IdleTimeout`. Raise the balancer's timeout alone and both fail. Lower the
server's alone and CI fails.

### 2. It is `react-router-serve`'s app, put together from the same packages

This changes nothing else the server does. `createApp` builds the Express app `react-router-serve` 8.5 built,
piece by piece and in the same order:

1. `x-powered-by` turned off.
2. Compression.
3. `/assets` immutable for a year, which `Edge.cs`'s cache behaviour for the bundles relies on.
4. The rest of `build/client` with Express's default policy.
5. `/.well-known` mounted as a root of its own.
6. Morgan's `tiny` line for each request that reaches the application.
7. `@react-router/express`'s handler for everything else.

`@react-router/serve` leaves the dependencies. The four packages it brought in join them instead:
`@react-router/express`, `express`, `compression` and `morgan`, at the versions the lock already held. Their
types are devDependencies. One build was served both ways, and every response header compared on eleven
paths: the home page, `/robots.txt`, `/version`, a bundle, a stylesheet, the favicon, three 404s, a 502 and
the route manifest. Apart from the date, the nonce and the trace id, they matched. The one difference was
`Keep-Alive: timeout=5` against `timeout=65`. The log lines matched too.

Four things it does differently, on purpose:

- **No `./public` served for an hour after `build/client`.** That path is relative to the working directory.
  The image has no `public/`, and Vite copies every file in it into `build/client`, which is served first.
  No request ever reached that handler.
- **No random port when 3000 is taken.** The server listens on `PORT`, or 3000 when it is unset. A port in
  use is an error, not a server on a port nobody asked for.
- **No `source-map-support`.** The server build has no source maps for it to read.
- **The build is found from the server's own location**, not from the working directory. In the image and
  in both harnesses the two are the same directory.

### 3. Node runs it as TypeScript

Nothing compiles the server, and it is not part of the build: the image copies `server/` beside `build/`, and
leaves out its test. `tsconfig.server.json` keeps the code to what Node can strip. It turns on
`erasableSyntaxOnly` and `verbatimModuleSyntax` and resolves modules as Node does, and `npm run typecheck`
checks it. `index.ts` sets `NODE_ENV` to `production` when it is unset, before anything loads React, as
`react-router-serve`'s own entry did. That is why it imports `serve.ts` dynamically.

### 4. Stopping ends the connections the long keep-alive would hold

On a stop signal, `server.close()` ends the connections that are idle and leaves the busy ones alone. A
connection that was busy goes idle once it has answered. It would then stay open for the whole 65 seconds:
seen on 24.22.1, with nothing ending it. ECS kills a Fargate container 30 seconds after asking it to stop,
unless the task definition's `stopTimeout` says otherwise, and ours does not. Five seconds of keep-alive hid
this. So `close` also ends idle connections every second until the last one has gone. `serve.test.ts` holds
this: a connection that is mid-response when the server closes ends within two seconds of its answer. The
image built from this stops in under a second while the balancer would still be holding a connection, and
exits 0.

## Consequences

- **Neither timeout moves alone.** The balancer's idle timeout and the server's keep-alive are one decision.
  CLAUDE.md says so, and both checks fail when the two drift apart.
- **A React Router major means re-reading `react-router-serve`'s `cli.ts`.** Anything it starts doing then
  does not reach this server on its own. This is the same kind of duty as re-diffing `entry.server.tsx`
  against `react-router reveal`'s output ([0053](0053-a-documents-scripts-carry-its-renders-nonce.md)).
- **The fix shows only on a deployed site.** No local setup has a balancer in front of the server. The
  `5xx-rate` alarm already counts the balancer's own 5xx responses (`Alarms.cs`), and `HTTPCode_ELB_502_Count`
  is where this particular 502 shows.
- **Not here:** the rest of #109's hardening.
