# 0074. The home page is kept twice, by a flag that names nobody

**Status:** Implemented — #389.

## Context

The home page is shared and cached at the edge ([0013](0013-http-caching-policy.md)), and the pages'
cache policy keeps every cookie out of its key, on purpose: a cookie in the key gives each reader a private
copy of a public page, and the session cookie in it would be one copy per account
([0044](0044-what-the-deployment-walkthrough-settled.md)). So the server render could not tell who was
reading. A signed-in reader was drawn the visitor's page first, and theirs only once `/api/auth/me`
answered. Since [0073](0073-the-home-page-a-welcome-coming-soon-just-out-and-the-news.md) two sections
differ by sign-in — the welcome against Welcome back, and the showcases and sales against the reader's own
two weeks — so on every visit the top of the page swapped under them.

#389 weighed the ways out and chose two cached copies of `/`, chosen by a flag that says somebody is
signed in and nothing about who. A per-reader server render was rejected: signed-in pages uncached,
cookies passed to the API, and personal data in the HTML. A script in the head hiding the wrong render
(#208's mechanism) stays the fallback, should the edge change be refused.

## Decision

### 1. `mvgl_signed_in`, which follows the session

The API sets `mvgl_signed_in=1` — HttpOnly, Secure, `SameSite=Lax`, as the session cookie is — and clears
it, in `Security/SignedInFlag.cs`:

- **On the sign-in cookie's own events.** `OnSignedIn` sets it, for the session's expiry, or for the
  browser's life when "remember me" was off; `OnSigningOut` clears it. So every way in and out moves it:
  registering, signing in, a rename's refreshed sign-in, signing out, deleting the account, a session
  refused for a changed security stamp.
- **On `/api/auth/me`, which every page load asks.** Somebody signed in gets it again, to the session's
  present expiry, which a sliding session moves past the one it was first set with. Nobody — a 204 since
  #316, not the 401 the issue was written against — has a leftover flag cleared.

Wrong, it costs one page load the wrong top section, replaced when auth answers, as every page load was
before. Faked, it gets only the signed-in copy's placeholders, which become the welcome.

### 2. A behaviour for `/` alone, keyed on that cookie

`infra/src/Infra/Edge.cs` gives the path `/` a cache policy of its own: the pages policy, with
`mvgl_signed_in` the one cookie in the key and no query string. A cookie in the key travels to the origin,
so the server render sees the flag and nothing else. The behaviour carries the basic-auth function as every
behaviour does. Both copies keep `CACHE_HOME`: neither holds anything of anybody's.

A path pattern without a wildcard matches that path; CloudFront's guide says the leading slash is optional,
and a pattern of `/` is reported to match the root alone when the distribution names no default root
object, which this one does not. `scripts/dev-check.mjs` proves it on a deployed distribution: `/` with the
flag and without it must be different pages, which the default behaviour, keyed on no cookie, would never
give.

A client navigation to the home page asks for `/_.data` (React Router 8.4), which stays on the default
behaviour and never sees the flag. It does not need to: a page making a navigation knows who is signed in,
and that outranks the flag.

### 3. The render: the flag until `me` answers, then the answer

The loader reads the flag from the request, and the page draws the signed-in top section from it until
`/api/auth/me` has answered — every server render, and the render that hydrates it — and from the answer
after. Drawn before anybody is named, the signed-in top section holds each of the reader's parts as its
skeleton ([0070](0070-nothing-shows-as-a-blank.md)): "Welcome back" without a name, the strip of figures,
Continue playing, Play next. Those parts now draw the same skeletons while they load, where they drew
nothing, so the skeleton the server sent is replaced by the same shapes and then by the content. The
two-week line is drawn as its heading and the sentence it shows while it looks things up: its days are the
reader's own, read from their clock, which no server render knows. The showcases and sales give way to the
line in both copies' renders, and the link to the reader's own news waits for auth, as the navbar's does.

## Consequences

- **A signed-in reader's page arrives as theirs.** What still moves is inside the top section: the line's
  days arriving under its heading, and a part that turns out empty (no game being played, nothing recorded
  for the strip) closing up.
- **No other cookie may enter a cache key**, and none on any other page. A page wanting another copy by
  sign-in takes this flag and nothing more.
- **The Lighthouse audit is unchanged.** It audits the home page signed out, with no flag.
- **A value other than `1` is a third copy, drawn as the welcome.** It is no more of a cache-filling
  vector than an allowed query string already is.
- **Not seen on CloudFront until it is deployed.** CI builds the CDK app but does not synthesise it, which
  needs the account's lookups; the dev check after a deploy is the proof.
