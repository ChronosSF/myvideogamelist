# 0056. An avatar is an address on a short list of hosts, and a display name stands beside the handle

**Status:** Implemented
**Amends:** [0033](0033-what-the-api-refuses.md) §5, whose document policy gains `img-src`

## Context

#119 adds three columns to the account, edited on `/user` and shown on `/u/{name}` while the
profile is public: a display name, an avatar and a bio. Two records had already settled most of it.
[0027](0027-usernames-and-public-profiles.md) made the username the handle and the public document
a field-by-field copy, so a display name is not a second namespace and each new field reaches the
public page only when written into it. [0024](0024-the-ownership-contract.md) left `ApplicationUser`
out of the export manifest, so new columns on it reach the export only by hand.

The open question was the avatar. An upload is user-generated content: storage, size limits,
re-encoding to strip a photo's location, moderation, and a file that account deletion has to remove
because no cascade does. A URL needs none of that, and the issue leaned that way.

A URL is not free either. Each reader's browser fetches it from its host, carrying the reader's IP
address, on a page the reader opened for something else, from a host somebody else chose. #241 had
just taken the trailer off the game page's first load for the same reason: it was "the one place the
site might have needed consent for". After that change, a game page reached only the site and
`images.igdb.com` until somebody pressed play. #200, the paid profile banner, lists the same costs
for an image URL and asks for the same answer as this one.

Neither content policy says anything about images. Master's is `frame-ancestors 'none'`.
[0053](0053-a-documents-scripts-carry-its-renders-nonce.md), open as #254, adds `script-src`,
`object-src` and `base-uri`. Neither names `img-src` or `default-src`, so no image is blocked today.
The question was therefore what `img-src` says once it is written, and this change writes it.

What was checked, on 17 October 2026, before any host went into code:

- **Every listed host serves an avatar over HTTPS and set no cookie on the image response.** Each
  was asked once, for a real or default avatar.
- **Discord's CDN sets three cookies on an image**: `__dcfduid`, `__sdcfduid` and `__cf_bm`. The
  first two identify the device. `github.com/{user}.png` sets `_gh_sess`, `_octo` and `logged_in`
  before redirecting to GitHub's avatar host.
- **A listed host can redirect elsewhere.** Gravatar answers an address with a `d=` default by
  redirecting to `i1.wp.com`, Automattic's image proxy, when there is no picture behind it. Steam's
  `avatars.cloudflare.steamstatic.com` redirects to `avatars.steamstatic.com`.

## Decision

### 1. An avatar is an address, stored as given and never fetched by the server

There is no upload in this cut, for the reasons above. The address is stored as its owner pasted it,
less the whitespace around it. Nothing re-encodes it, lower-cases it or rebuilds it from a parsed
`Uri`, and the server never requests it. So there is no address a user can make this server reach,
and nothing it caches or serves on anybody's behalf.

### 2. The host is one of a short list, and the page's policy names the same list

| Service | Hosts |
|---|---|
| Gravatar | `gravatar.com`, `www.gravatar.com`, `secure.gravatar.com`, `0.gravatar.com`, `1.gravatar.com`, `2.gravatar.com` |
| GitHub | `avatars.githubusercontent.com` |
| Steam | `avatars.steamstatic.com`, `avatars.akamai.steamstatic.com`, `avatars.fastly.steamstatic.com` |
| Imgur | `i.imgur.com` |
| Twitch | `static-cdn.jtvnw.net` |

These are services people already keep an avatar on, plus Imgur for a picture that lives nowhere
else. A list rather than any HTTPS host, for three reasons:

- **A profile's owner cannot point the avatar at a server of their own** and log the address of
  everybody who reads their page. Every listed host is a service's, not a member's.
- **A privacy notice can name every host a reader's browser is sent to** (#141). Under `https:` it
  could not name even one.
- **The document policy can name exactly these.** That is what holds when a listed host redirects:
  the browser checks each hop against `img-src`, refuses Gravatar's `i1.wp.com`, and the initial
  shows instead. The server's check alone could not see a redirect.

A host is added only after it has been seen to serve an avatar over HTTPS without setting a cookie.
That rule is what keeps Discord's CDN off the list, and `github.com` with it, since the redirect is
only reached through those cookies.

The policy becomes:

```
frame-ancestors 'none'; img-src 'self' https://images.igdb.com https://gravatar.com …
```

`'self'` is the favicon, and IGDB's CDN serves every cover, screenshot and piece of key art. **An
image from a host not named there does not load**, in development as deployed, so a feature that
shows one adds the host on purpose.

The list exists twice, in two languages, and that is the price of the browser enforcing it.
`AvatarUrlPolicy.Hosts` on the server says what may be saved. `AVATAR_HOSTS` in `@/lib/avatar` says
what a page may load, and `img-src` is built from it. `avatar.test.ts` reads the server's file and
fails when the two differ. A host on the server's list and not the client's is saved and then refused
by every browser. The reverse is a host readers can be sent to that nobody can save, which is
harmless but still a drift.

### 3. Checked as a string first, and as a `Uri` second

A reader's browser fetches whatever its own URL parser makes of the stored text, and parsers disagree
about odd input: a backslash, a space, an `@` in the authority. So the address may use only the
characters RFC 3986 allows, which a browser's "copy image address" already produces. It must start
`https://`, and the text from there to the first `/`, `?` or `#` must be a listed host exactly. That
leaves no credentials, no port and no trailing dot, so the two parsers have nothing to read two ways.
The `Uri` parse must then agree on the host.

The cap is 512 characters, the calendar's curated links' length, and several times the longest
address any listed host hands out. The database holds the one rule that never changes: a check
constraint that the column is null or begins `https://`, compared without case since the address is
stored as given. The host list stays in code, where adding a host is not a migration.

### 4. A picture is asked for as little as a picture can be

The image is decoration, since the name is always beside it. It has an empty `alt` inside an
`aria-hidden` circle, and it loads with `referrerpolicy="no-referrer"` and `loading="lazy"`. It is
never trusted to arrive. A 404, a refused redirect or a deleted picture brings back the generated
avatar: the handle's initial on the primary's gradient. The handle and not the display name, because
every account has one. The server renders the `<img>` and the browser starts it before hydration, so
an image that fails fast fires its error before React listens. The component therefore asks the image
whether it has already failed once React has it.

The settings page previews what is stored, not what is typed. A preview that followed the input
would send a request to somebody's server for every half-typed address on the way to the real one.

### 5. A display name stands beside the handle

The display name is trimmed, its runs of whitespace fold to one space, and it is 1 to 50 characters
with no control characters, which is `ListNamePolicy`'s shape. It is never unique, never looked up
and never in a URL. So spaces, punctuation, accents and emoji are allowed, and so are the words
0027's reserved list refuses. "Support" beside `@carol` says who is speaking, and a word list over
free text would not stop "S u p p o r t" anyway.

Wherever the handle identifies the account, the display name sits beside it and never replaces it:

- **The profile's heading** reads `Stamen @ChronosSF`, with the name in a `bdi` so right-to-left
  text cannot reorder the handle beside it.
- **The title** reads `Stamen (@ChronosSF) - MyVideoGameList`.
- **The canonical path and `profile:username`** stay the handle.

With no display name, the page is exactly what it was.

### 6. A bio is plain text, and that is a property of how it is rendered

A bio is up to 500 characters. Its line endings are stored as `\n` whichever a browser sent, so a
line break counts once. Its ends are trimmed, and everything between them is kept as written. Control
characters other than a line break and a tab are refused.

Nothing that looks like markup is refused. The bio is written into the page as a text node, so `<b>`
shows as three characters, and refusing angle brackets would refuse "I <3 RPGs" to prevent a
rendering that cannot happen. It is shown with `white-space: pre-wrap` and `dir="auto"`, and nothing
in it is linked.

### 7. Published with the profile, copied by hand, exported by hand

- **`PublicProfileDto` gains the three, copied one at a time** in `PublicProfileService`, as 0027 §8
  requires. They are published because they exist to be: the owner wrote them for this page. A
  private profile is still the same 404 as an unclaimed name, so nothing written while private
  leaks. The reviews and favourites documents do not carry them.
- **`AccountExportDto` gains the three by hand.** The avatar is exported as its address.
- **`UserProfileDto` carries them** to the signed-in user, so a save returns the whole profile as
  the other profile changes do.
- **`PUT /api/user/profile` replaces all three at once**; a blank clears one. Each attribute judges
  the value as it will be stored, and a refusal is a `ValidationProblemDetails` keyed by its field.

### Rejected

- **An upload, for now.** Its costs are listed above. #200's banner may need one, being wider than
  any avatar service offers, and would then decide it for both.
- **Any HTTPS host, with `img-src https:`.** That admits again what the list exists to exclude, the
  owner's own server above all.
- **A server-side image proxy**, GitHub's camo. It hides every reader's address, but the server then
  fetches, caches and serves other people's images: an upload's costs without the upload.
- **Discord**, for its cookies, and `github.com/{user}.png`, for its own.

## Consequences

- **A new image host needs an `img-src` entry**, and an avatar host the server's list as well. A
  third party's tag or ads (#242, #143) need their hosts named when they arrive, alongside 0053's
  `script-src` decision.
- **0053's `documentPolicy` and this record touch the same header.** Whichever lands second carries
  `img-src ${IMAGE_SOURCES}` into the other's shape.
- **A Gravatar address carries a hash of an email address**, which anybody who can guess the address
  can confirm. Pasting one is its owner's choice, and the form does not warn.
- **An avatar can change after it is set**, since the picture is the host's. A profile's display
  name, avatar and bio can be anything their owner writes, as a public review already can. Nothing
  reports one and no admin tool clears one: [0042](0042-admins-are-named-in-configuration.md) keeps
  the admin page to reference data. Moderating what members publish is an open question.
- **A change to the three outlives itself at the edge**, like any change to a public profile: five
  minutes, and up to an hour stale (0027 §10). Clearing a bio is a withdrawal in all but name, and
  belongs with the events #99 invalidates.
- **The display name appears on the profile and nowhere else yet.** The navbar still shows the
  handle's initial, and the game page's member reviews still name the handle alone.
