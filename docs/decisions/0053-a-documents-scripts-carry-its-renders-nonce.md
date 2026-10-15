# 0053. A document's scripts carry its render's nonce, and a shared cache keeps the pair whole

**Status:** Implemented
**Completes:** [0033](0033-what-the-api-refuses.md) §5, which left `script-src` out of the documents'
policy

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
  `$RT`. The loader data is such a boundary, so on a real connection most loads have them. `curl`
  rarely sees them, because it reads fast enough for the data to arrive inline.

Two facts about the deployment decide what a correct policy can be:

- **CloudFront shares most documents between readers** ([0013](0013-http-caching-policy.md)): the home
  page for five minutes, a game page for an hour and then a day stale, profiles, the static pages and
  the 404s. One render is the page for everybody who asks inside the window.
- **The header goes out before most of the body.** `entry.server.tsx` builds the `Response` when the
  shell is ready, and the loader data and React's reveal scripts follow it down the stream.

## Decision

### 1. A nonce, not hashes

Each render draws a fresh nonce, 128 bits from the platform's cryptographic source as CSP3 §7.1 asks,
names it in the header, and hands it to both renderers: `<ServerRouter nonce>`, which passes it
through its context to `<Scripts>`, `<ScrollRestoration>` and the streamed loader data, and the
stream's `nonce` option, which covers React's own scripts. Both are needed. Without the first the
loader data is refused; without the second the boundary holding it is never revealed. Either way the
page does not hydrate.

Hashes were the alternative. On a page the CDN shares they are the stronger of the two, because a hash
has no secret for a cache to give away. They were rejected because the header cannot contain them.
The loader data is this request's data and is written after the header has been sent. So are React's
reveal scripts, and whether they are written at all depends on how fast the data arrives. Hashing
those means holding every document until its last byte, which gives up streaming on every page, and
putting a parser of our own output between React and the wire. Its one failure is a script it missed,
which is a page that never hydrates. Every other script is the same for every request to a route in a
build and could be hashed. A policy that hashed those and gave the loader data a nonce would carry two
mechanisms for the protection of the weaker one.

### 2. What a shared cache does to it

The trap: a nonce belongs to one response, and a shared copy is one response served to many readers.
Two failures are possible, and only one of them is real.

**The second reader gets a nonce that does not match:** the header from one render, the body from
another, so nothing on the page runs. That cannot happen while the header and the body are stored and
replayed together, as every cache in the path stores them (RFC 9111 §3), CloudFront's and the
browser's alike. Two things would split them, and neither may be added:

- **A CloudFront response headers policy that sets `Content-Security-Policy` with origin override.**
  CloudFront then "ignores the header that it received from the origin" and sends one that names no
  nonce, on every page. #109's HSTS policy is the next one to be written, and it must leave this
  header alone.
- **A validator on a document**, an `ETag` or a `Last-Modified`. A 304 replaces the stored header
  fields and keeps the stored body (RFC 9111 §4.3.4), which pairs a new nonce with an old one. No
  document carries one today; React Router streams them and nothing adds one. Checked on the wire, in
  development and in the production build.

**The nonce protects nothing, because every reader can see it.** This one is half true, and which half
matters. A shared copy's nonce can be read by anybody for as long as the copy is served, which is not
what CSP3 means by unguessable. But the nonce exists to tell the browser which scripts the render
wrote and which were injected into it, and that is settled at render time. Anything an attacker put
into the HTML, stored or reflected, was chosen before the nonce was drawn, so it cannot carry it. What
a public nonce gives away is markup injected in the browser after load: a sink that turns a string
into live HTML, where an attacker could include the nonce they read from the shared copy.

The client has no such sink: no `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`,
`srcdoc`, `DOMParser` or `document.write` anywhere in `src/`. **Adding one reopens this record.** The
answer then is a sink that never parses markup, or a page that is not shared.

A private document is `no-store`, its nonce is never seen twice, and it has the full guarantee. So one
mechanism and one code path hold for both kinds of page. On a private page the nonce is a secret. On a
shared one it is a mark of the render that no injection in that render can forge.

### 3. The policy

```
script-src 'self' 'nonce-…'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
```

- **`'self'`** admits the scripts loaded from files: the route modules a navigation imports and the
  module preloads. Nothing else on this origin answers with script. The API sends JSON under
  `nosniff`, and the front-end server's own resources are text and XML under the same.
- **No `'strict-dynamic'`.** It exists for pages whose trusted scripts load others from hosts nobody
  can list in advance. Every script here comes from our own origin. A third party that injects scripts
  of its own, which an ad provider does, is the time to decide it, with §2 in view.
- **`base-uri 'none'`**, because a nonce is retargetable (CSP3 §7.3). A `<base>` injected above React
  Router's module script would resolve its relative imports against another host. A module's imports
  are fetched with its nonce: HTML's script fetch options carry it "for fetching any imported modules",
  and CSP checks the nonce before the URL. So `'self'` would not stop them.
- **`object-src 'none'`**, because `<object>` and `<embed>` answer to it rather than to `script-src`,
  and nothing here embeds one.
- **Not in it:** `style-src`, so style attributes and the styles Vite and Tailwind inject are
  unaffected, and a reporting endpoint, which would need somewhere to receive the reports.

Checked in a browser: the policy refuses an injected inline script, an inline handler, an injected
`<base>` and a script from another origin, and runs a script that carries the nonce.

### 4. Every document, every error, both modes

- **Error documents** go through `entry.server.tsx` like any other. A thrown 404, a loader's 502 and a
  500 all carry the policy and hydrate under it.
- **A failed shell is a second render.** React Router calls the entry again with the same headers to
  render the error boundary. That call draws its own nonce, and its `set` replaces the first one's, so
  the header always names the nonce of the body that is sent.
- **The test is `entry.server.test.tsx`.** It renders each of these, plus a crawler and late data,
  through React Router's own request handler and the real root route, and checks every script against
  the header.
- **A HEAD** carries a policy naming a nonce that no body uses. Nothing reads it.
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
- **Resource routes render no script** ([0036](0036-what-a-crawler-is-told.md)), so `resourceResponse`
  sends the API's policy, `default-src 'none'; frame-ancestors 'none'`, rather than a document's.

### 5. `<Links>` takes an empty nonce

Since React Router's [#15170](https://github.com/remix-run/react-router/pull/15170), `<Links>` takes
the nonce from `<ServerRouter>` when it is given none, so every `<link>` it writes carries it. The
hydrating client has no nonce to render. A browser also blanks the attribute once it has read it, so
the server's `nonce="…"` arrives as `nonce=""` against a client that renders no attribute at all.
React reports that as a hydration mismatch, on every page, in development. React Router marks its
scripts `suppressHydrationWarning` and not these links.

The root renders `<Links nonce="">`, which is the same on both sides. A link needs no nonce under this
policy: same-origin preloads are admitted by `'self'`, and no `style-src` is set. A `style-src` that
named the nonce would change that, and would have to solve this first.

### 6. The palette script (#208) is admitted by its hash

Its text never changes, so its hash is a constant. Compute it at server start from the same string
the root renders, and add the `'sha256-…'` source in `documentPolicy`. A hash needs nothing threaded
into the React tree and no exemption from hydration's checks, and it is the one kind of source whose
guarantee a shared cache cannot weaken.

The nonce would also work, but the root has no supported way to read it: `<ServerRouter>` keeps it in
an internal context. And the blanked attribute would need the same treatment as the links.

## Consequences

- **A CloudFront response headers policy never sets `Content-Security-Policy`** on a behaviour that
  serves documents. #109's HSTS policy is the first such policy, and this record is why it carries
  HSTS and nothing else.
- **A document never carries a validator.** An `ETag` middleware added for speed would reopen the
  first failure in §2.
- **A sink that parses markup in the browser reopens §2.** Review one as a change to this record.
- **A third-party script needs a decision.** An ad provider's scripts need their hosts or
  `'strict-dynamic'` here; decide which when it arrives, with §2 in view.
- **A React Router major** re-diffs `entry.server.tsx` against `react-router reveal` as before; the
  file lists what differs. If `<Links>` stops putting a nonce on links, or marks them
  `suppressHydrationWarning`, §5 can go.
- **A React upgrade is checked in a fresh dev console.** Upstream's open
  [#15603](https://github.com/remix-run/react-router/issues/15603) reports nonce hydration warnings
  under React 19.3, which this app does not run yet.
- **Nothing reports a violation from a reader's browser.** A future script that misses the nonce
  breaks pages without a line in any server log; `entry.server.test.tsx` is what catches it first.
- 0033 §5's table: the documents' `Content-Security-Policy` is now the policy in §3.
