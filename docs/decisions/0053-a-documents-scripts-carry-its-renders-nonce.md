# 0053. A document's scripts carry its render's nonce, and a shared cache keeps the pair whole

**Status:** Implemented
**Amends:** [0033](0033-what-the-api-refuses.md) §5, whose document policy left out `script-src`

## Context

0033 §5 put the document security headers in `entry.server.tsx`, the one place every document
response passes through, and stopped short of `script-src`: React Router hydrates from inline
scripts, so a policy that restricts scripts has to name those, and one that names the wrong ones is a
page that never hydrates. This record is that change.

What a document's inline scripts are, read off the rendered HTML (React Router 8.4, React 19.2):

- **`<Scripts>` writes two.** The hydration context, `window.__reactRouterContext = …`, and a module
  script that imports the matched routes and the client entry — and in development the React Refresh
  runtime.
- **`<ScrollRestoration>` writes one.**
- **The loader data is in neither.** `<ServerRouter>` streams it after the shell, as one
  `streamController.enqueue(…)` script per chunk and a closing one.
- **React writes its own** when a suspended boundary finishes after the shell has gone: `$RC`, `$RV`,
  `$RT`. The loader data is such a boundary, and its first chunk is always read after the shell has
  been sent, so every streamed document has them. `curl` rarely sees them: `isbot` counts its default
  user agent as a crawler, the entry renders a crawler with `onAllReady`, and by then the boundary has
  finished and is written inline. Send a browser's `User-Agent` to see the streamed form.

Two facts about the deployment decide what a correct policy can be:

- **CloudFront shares most documents between readers** ([0013](0013-http-caching-policy.md)): the home
  page for five minutes, a game page for an hour and then a day stale, profiles, the static pages and
  the 404s. One render is the page for everybody who asks inside the window.
- **A streamed document's header goes out before most of its body.** `entry.server.tsx` builds the
  `Response` when the shell is ready, and the loader data and React's reveal scripts follow it down
  the stream.

## Decision

### 1. A nonce, not hashes

Each render draws a fresh nonce, 128 bits from the platform's cryptographic source as CSP3 §7.1 asks,
names it in the header, and hands it to both renderers: `<ServerRouter nonce>`, which passes it
through its context to `<Scripts>`, `<ScrollRestoration>` and the streamed loader data, and the
stream's `nonce` option, which covers React's own scripts. On a streamed document both are needed.
Without the first the loader data is refused; without the second the boundary holding it is never
revealed. Either way the page does not hydrate.

Hashes were the alternative. On a page the CDN shares they are the stronger of the two, because a hash
has no secret for a cache to give away. They were rejected because a streamed header cannot contain
them. The loader data is this request's data and is written after the header has been sent. So are
React's reveal scripts, and whether they are written at all depends on how fast the data arrives.
Hashing them means holding every document until its last byte and putting a parser of our own output
between React and the wire, whose one failure is a script it missed: a page that never hydrates.

§2 sends a shared document whole, which takes the first of those costs away for the shared pages.
The second stays. A private page still streams and still needs the nonce, so hashing the shared ones
would carry two mechanisms where one does.

### 2. What a shared cache does to it

The trap: a nonce belongs to one response, and a shared copy is one response served to many readers.
Two failures are possible, and only one of them is real.

**The second reader gets a nonce that does not match:** the header from one render, the body from
another, so nothing on the page runs. That cannot happen while the header and the body are stored and
replayed together, as every cache in the path stores them (RFC 9111 §3), CloudFront's and the
browser's alike. Three things would split them, and none may be added:

- **Anything at the edge that sets, rewrites or removes `Content-Security-Policy` on a document.** A
  CloudFront response headers policy with origin override makes CloudFront "ignore the header that it
  received from the origin" and send one that names no nonce, on every page. A remove-headers entry,
  a CloudFront Function or a Lambda@Edge on the response would split them as surely. A nonce-less
  replacement fails closed, with every page dead; a removal or a permissive one fails open, silently.
  #109's HSTS policy is the next edge change to be written, and it must leave this header alone.
- **A validator on a document**, an `ETag` or a `Last-Modified`. A 304 replaces the stored header
  fields and keeps the stored body (RFC 9111 §4.3.4), which pairs a new nonce with an old one. No
  document carries one today; React Router streams them and nothing adds one. Checked on the wire, in
  development and in the production build.
- **A HEAD's policy over a stored page.** A cache may freshen a stored GET from a HEAD's headers when
  there is no validator to compare (RFC 9111 §4.3.5); a HEAD naming a nonce of its own would then sit
  over the old body. So a HEAD carries the other headers and no content policy, which RFC 9110 §9.3.2
  allows for a field "determined only while generating the content", and a freshening cache keeps
  the stored one.

**The nonce protects nothing, because every reader can see it.** This one is half true, and which half
matters. A shared copy's nonce can be read by anybody for as long as the copy is served, which is not
what CSP3 means by unguessable. But the nonce exists to tell the browser which scripts the render
wrote and which were injected into it, and that is settled by when the nonce can be seen. It becomes
visible when the header is sent. Anything in the body that was fixed before then cannot carry it.

- **A shared document is sent whole.** `entry.server.tsx` renders any document a shared cache may
  store, any whose `Cache-Control` says neither `private` nor `no-store`, the way it renders a crawler:
  with `onAllReady`. The header then leaves only once the body is final. Without that, data a shared
  route deferred past the shell could be written by somebody who had already read the nonce from the
  header, if they were the one filling the cache, and every later reader would run it. No route defers
  data today; this makes the rule hold when one does. The cost is the cache-filling request's time to
  first byte, which while every loader awaits its data is the time to serialise what is already there.
- **A private document streams.** Its header goes out with the shell, but it is `no-store`: a nonce
  seen there is never on anybody else's page, and it has the full guarantee.
- **What a public nonce still gives away is markup injected in the browser after load**: a sink that
  parses a string as live HTML. An `innerHTML` never runs an inserted `<script>`, but it can insert an
  `<iframe srcdoc>`, whose document inherits this policy and runs a `<script>` carrying the nonce. The
  client has no such sink: no `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `srcdoc`, `DOMParser`, `createContextualFragment`, `setHTMLUnsafe` or
  `document.write` anywhere in `src/`. **Adding one that parses anything but a constant reopens this
  record.** Enforcing the rule rather than reviewing for it is #250.

### 3. The policy

```
script-src 'self' 'nonce-…'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';
img-src 'self' https://images.igdb.com https://gravatar.com …
```

`img-src` is [0056](0056-an-avatar-is-an-address-on-a-short-list-of-hosts.md)'s, which landed first
and wrote it into the fixed policy this record replaced. It needs no nonce, and `documentPolicy`
writes it with the rest. Its tests moved across with it.

- **`'self'`** admits the scripts loaded from files: the route modules a navigation imports and the
  module preloads. Nothing else on this origin answers with script. The API sends JSON under
  `nosniff`. The front-end server's resource routes send text and XML under the same. React Router's
  `.data` responses are labelled `text/x-script`, which a browser would run as a classic script
  without `nosniff`; the entry's `handleDataRequest` now gives them the resources' headers, so it
  will not.
- **No `'strict-dynamic'`.** It exists for pages whose trusted scripts load others from hosts nobody
  can list in advance. Every script here comes from our own origin. A third party that injects scripts
  of its own is the time to decide it, with §2 in view.
- **`base-uri 'none'`**, because a nonce is retargetable (CSP3 §7.3). A `<base>` injected above React
  Router's module script would resolve its relative imports against another host. A module's imports
  are fetched with its nonce: HTML's script fetch options carry it "for fetching any imported modules",
  and CSP checks the nonce before the URL. So `'self'` would not stop them.
- **`object-src 'none'`**, because `<object>` and `<embed>` answer to it rather than to `script-src`,
  and nothing here embeds one.
- **Not in it:** `style-src`, so style attributes and the styles Vite and Tailwind inject are
  unaffected. Nor a reporting endpoint or `form-action`, which bypass nothing here and are #251.

Checked in a browser: the policy refuses an injected inline script, an inline handler, an injected
`<base>` and a script from another origin, and runs a script that carries the nonce.

### 4. Every document, every error, both modes

- **Error documents** go through `entry.server.tsx` like any other. A thrown 404 or 502 and a loader's
  500 all carry the policy and hydrate under it.
- **A failed shell is a second render.** React Router calls the entry again with the same headers to
  render the error boundary. That call draws its own nonce, and its `set` replaces the first one's, so
  the header always names the nonce of the body that is sent.
- **The test is `entry.server.test.tsx`.** It renders each of these, plus a crawler, a private page
  whose data lands after the shell and a shared one that is sent whole, through React Router's own
  request handler and the real root route, as a server render with no DOM. It checks every script
  against the header.
- **The development server gets the same policy, and no Vite option.** Nothing Vite serves writes an
  inline script into our documents. React Router's plugin installs the React Refresh runtime as a
  virtual module, imported by the nonced module script above. Vite's client arrives as an import of
  the transformed modules. Both are admitted by `'self'`.
- **Vite's `html.cspNonce` does not apply here.** It is for `index.html`, which framework mode does not
  render documents from. Its client uses the nonce only for the `<style>` elements it injects, which no
  directive here governs, and for the build's preload links, which `'self'` admits.
- **The one inline script Vite writes is on its own error page**, served when an error escapes React
  Router altogether. That page never passes through `entry.server.tsx`, carries none of our headers,
  and still works. Checked with a module that does not parse, and the in-page overlay with the same
  module edited under an open page.
- **The strict policy in development is the point.** A violation shows up on a developer's machine,
  the way a write without `X-MVGL-Request` does (0033 §3).
- **Responses that render nothing get a policy that loads nothing.** The resource routes
  ([0036](0036-what-a-crawler-is-told.md)) and the `.data` responses send the API's policy,
  `default-src 'none'; frame-ancestors 'none'`, with the other headers. The static files and React
  Router's last-resort plain-text 500 still carry none of them; none of those has a script that could
  need a nonce.

### 5. `<Links>` takes an empty nonce

Since React Router's [#15170](https://github.com/remix-run/react-router/pull/15170), `<Links>` takes
the nonce from `<ServerRouter>` when it is given none, so every `<link>` it writes carries it. The
hydrating client has no nonce to render. A browser also blanks the attribute once it has read it, so
the server's `nonce="…"` arrives as `nonce=""` against a client that renders no attribute at all.

React 19 matches most links in the head by their key attributes and compares nothing else. A
stylesheet link without `precedence` is hydrated like any other element, though, and the stray
attribute is a mismatch. In development that is the critical-CSS link, on every page. In production
it is the route CSS, unreported only because production React does not compare attributes. React 19.3
reads the `nonce` property rather than the blanked attribute
([react#37030](https://github.com/facebook/react/pull/37030)). That stops a nonce rendered on both
sides being reported, and still reports one only the server rendered. React Router marks its scripts
`suppressHydrationWarning` and not these links.

The root renders `<Links nonce="">`, which is the same on both sides under either version. A link
needs no nonce under this policy: same-origin preloads are admitted by `'self'`, and no `style-src` is
set. A `style-src` that named the nonce would change that, and would have to solve this first.

### 6. The palette script (#208) is admitted by its hash

Its text never changes, so its hash is a constant, and two practical reasons make the hash the better
fit. It needs nothing threaded into the React tree: the nonce lives in `<ServerRouter>`'s internal
context, and reading it from the root would mean a context of our own provided by
`entry.server.tsx`, another change to that file. And it needs no exemption from hydration's checks,
which a nonce attribute would (§5).

Compute the hash from the same string constant the root renders: in a server-only module with
`node:crypto`, or as a constant that a test recomputes. `securityHeaders.ts` cannot import
`node:crypto`, because it reaches the browser in development, and Web Crypto's digest is
asynchronous. Then add the `'sha256-…'` source in `documentPolicy`. Rendering that constant with
`dangerouslySetInnerHTML` is the reviewed exception to §2's rule, since no string from outside
reaches it.

## Consequences

- **Nothing at the edge sets, rewrites or removes `Content-Security-Policy` on a document.** #109's
  HSTS policy is the first edge change since this record, and it never carries this header. A
  cache-hit check in `scripts/dev-check.mjs` is the only test that would see a split; it is listed on
  #109.
- **A document never carries a validator.** An `ETag` middleware added for speed would reopen the
  first failure in §2.
- **A HEAD never carries the content policy.**
- **A shared document is sent whole.** Making a private route shared means its documents stop
  streaming, and a shared route that defers data costs its cache-filling request the wait.
- **A sink that parses markup in the browser reopens §2.** Review one as a change to this record;
  #250 is the enforcement.
- **A third-party script needs a decision here first.** Google's tag (#242) and an ad provider each
  need their hosts or `'strict-dynamic'`; decide which when they arrive, with §2 in view.
- **A React Router major** re-diffs `entry.server.tsx` against `react-router reveal` as before; the
  file lists what differs. If `<Links>` stops putting a nonce on links, or marks them
  `suppressHydrationWarning`, §5 can go.
- **A React upgrade is checked in a fresh dev console.** Under 19.3, `nonce=""` on both sides still
  matches (§5). Upstream's open [#15603](https://github.com/remix-run/react-router/issues/15603) is
  about an app rendering an empty nonce on the client against a real one on the server, which this app
  does not do.
- **Nothing reports a violation from a reader's browser** (#251). A future script that misses the nonce
  breaks pages without a line in any server log; `entry.server.test.tsx` is what catches it first.
- 0033 §5's table: the documents' `Content-Security-Policy` is now the policy in §3.
