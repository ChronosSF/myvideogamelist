# 0027. Usernames are a namespace, and a profile is published only when asked

**Status:** Implemented

## Context

Three separate records had parked work on the same missing thing.

[0025](0025-playthroughs-and-reviews.md) ends by naming what it deliberately left: *"a review is
written and stored and nothing reads it but its author."* The reading half needs somewhere to read
it, and that somewhere is a profile. Its `Visibility` column already carries a `friends` value
waiting for a follow graph, and the two `public` and `private` values it does have describe a
distinction that, until now, nothing acted on.

[0016](0016-scores-carry-their-sample-size.md)'s site-wide score histogram needs the same thing: a
component to render one has existed since the private profile shipped, and there was nowhere to put
another person's.

The roadmap's D8 and D9 call public game pages and public profiles "the organic acquisition
channel", which is the whole SEO case for a real domain.

And the account row itself said what was missing. `ApplicationUser` held `Theme` and `ListView` and
nothing else — no name of any kind. `Navbar.tsx` rendered the avatar as the first letter of an email
address, which is a letter of something the user never chose to be known by and is frequently not a
letter at all.

**The reason to do it now rather than later** is the argument 0025 made about consent, applied to a
namespace. A username is a claim on a name; every account that exists before usernames ship needs a
backfill, and every backfill needs collision handling. There were three accounts, all of them test
accounts. It only ever gets more expensive.

## Decision

### 1. Identity's `UserName` is the handle, rather than a second column beside it

Registration used to set `UserName` and `Email` to the same string, and nothing ever read the
former. It now holds the public handle, and `Email` is the address.

The alternative — a nullable `Handle` column, leaving `UserName` as a copy of the email — was
rejected because it duplicates a uniqueness rule the framework already maintains. Identity keeps a
unique index over `NormalizedUserName`, so **that index is the namespace constraint**: there is no
second rule to drift out of step with it, no second normalization to disagree about whether `Alex`
and `alex` are one name, and no code path that writes one column without the other.

The price is one real breakage, and it is worth naming because it is invisible until it happens.
`SignInManager.PasswordSignInAsync(string, …)` resolves its first argument as a **username**. That
worked by accident while the username was the email address, and it stops working the day it is not
— reporting itself to every affected user as "your password is wrong". `AuthController` now looks
the account up explicitly, by email and then by name, and signs in the resolved user. Both work,
because the field is one box on a form and the person filling it in has one of the two memorised —
and the form says so: the box is labelled for either, and it carries the `username` autocomplete
token so a password manager fills it from whichever of the two it stored.

### 2. The shape rules live in one class, and Identity is configured from it

`UserNamePolicy` owns the length bounds, the alphabet and the reserved list. `Program.cs` sets
`IdentityOptions.User.AllowedUserNameCharacters` from the same constant the policy validates
against, so a name the policy would refuse cannot enter the namespace through a code path that does
not happen to call it — a future admin tool, a social-login auto-provision.

The alphabet is deliberately narrower than Identity's default, which also allows `@ . - +`. A
username that can look like an email address reintroduces exactly the confusion this record
separates, and a name with a `/` or a `?` in it is a name that needs escaping to appear in the URL
it *is*.

The reserved list has two halves and both earn their place. Every current and plausible top-level
route is reserved — not because `/u/games` collides with anything today, but because un-reserving a
name later costs somebody their profile, and reserving one now costs nothing. And so are names that
would let one account speak for the site: an `@admin` or a `@support` writing a review carries an
authority it has not earned. The comparison is case-insensitive, because the namespace is: a
case-sensitive reserved list reserves nothing, since `Admin` resolves to the same profile as
`admin`.

Validation reaches the API through a `[UserName]` attribute rather than a guard in the controller,
so `[ApiController]` returns the 400 itself and the message lands beside the field. The attribute
answers "may this be a username" and never "is this username free" — availability is a fact about
the database at one instant, and it belongs to the write that races for it.

### 3. Availability is settled by the index, and the race it settles is translated by hand

Neither endpoint queries for a matching name before writing. A "is it free" read followed by an
update is two statements with a gap between them, and the gap is exactly where two people claiming
the same name at once are both told yes.

Identity makes that read itself, which is worth stating precisely because the first version of this
record got it wrong. `UserManager`'s `UserValidator` looks the name up before every create and
update and reports `DuplicateUserName` if somebody has it — that is where the ordinary "That
username is taken." comes from, and it is a check-then-write inside the framework. What settles the
pair who both pass it is the unique index over `NormalizedUserName`, and the EF store does **not**
translate that: `UserStore.CreateAsync` catches nothing, `UpdateAsync` catches only the
concurrency-stamp failure, and the loser gets a `DbUpdateException`. Unhandled, that is a 500 for a
perfectly ordinary outcome. `UserNameClaimService` wraps both writes, confirms the race by
re-reading — if the name now belongs to somebody else, that is the answer — and returns the same
`DuplicateUserName` the validator would have, so the controllers have one failure to handle. It
rethrows anything else, because a write that failed with the name still free was not this race.
Confirmed by re-reading rather than by matching a SQL state, for the reason `WishlistService` gives:
it stays correct on any provider.

### 4. Renaming is allowed, and rate-limited to once every thirty days

A username is a public address. Renaming breaks every link to the old one *and* releases it for
somebody else to claim. Neither is a reason to forbid a rename — people outgrow a name they picked
in a hurry — but both are reasons not to allow an unbounded stream of them, which is how a namespace
gets churned by somebody cycling names to squat them.

Thirty days is long enough to make that pointless and short enough that somebody who mistyped their
name at signup is not stuck with it for a year. The first choice is free: `UserNameChangedAt` is
null until the first rename. A change of **letter case only** skips the cooldown and does not start
one, because it can collide with nobody and it is how somebody fixes a name they capitalised wrongly.

A rename also reissues the sign-in cookie. `SetUserNameAsync` rotates the security stamp, and
Identity's `SecurityStampValidator` compares the cookie's copy against the account every thirty
minutes and signs out on a mismatch — so without `RefreshSignInAsync` a rename read, half an hour
later, as "the site logged me out for no reason". The case-only change goes through `UpdateAsync`,
which leaves the stamp alone.

### 5. A profile is private by default, and that default is not consent

`ProfileVisibility` ships in the same migration as the handle, defaults to `private`, and is
constrained to `public` or `private` by the database as well as by the input DTO. It is a string
rather than a boolean for the reason 0025 gives about `Review.Visibility`: `friends` is one additive
migration away once following exists, and splitting a boolean into three states is not additive.

**New accounts default to private too**, not only backfilled ones. Publishing somebody's reading of
their own library — what they abandoned, how they score things, how long things took them — is a
consent decision, and 0025 already settled that a default is not consent. The acquisition case in
D8/D9 is real, and it is not a reason to publish somebody who has not been asked.

That default is also what makes the backfill safe. Every pre-existing account holds an email address
in the username column, so the migration derives a handle from the local part, strips it to the
allowed alphabet and pads a too-short one. Collisions are resolved against the whole namespace: the
candidates are walked in account-id order, and each takes the first of `seed`, `seed_2`, `seed_3`…
not yet in a set that starts out holding every handle that was already legal and every reserved
name, and grows with each assignment. The first cut numbered collisions per seed with
`row_number()` instead, which is not the same thing — `alex`, `alex` and `alex_2` came out as
`alex`, `alex_2` and `alex_2`, an existing legal handle was never in any partition, and
`admin@example.com` became `admin` — and any of those aborts the whole migration on the unique
index. The reserved list is read from `UserNamePolicy` rather than restated, which makes the
migration's SQL depend on live code; that is deliberate, because a backfill should agree with the
policy as it stands when it runs. Verified against PostgreSQL with a fixture of every case above,
and re-running it changes nothing. Deterministic on purpose: "who got `alex` and who got `alex_2`"
should not have a different answer on staging than in production. A handle derived
from somebody's email address is a mild privacy problem *if it is published*, and it is not
published — the profile is private until its owner says otherwise, and they can rename first.

### 6. Two gates, and the narrower always wins

The account's `ProfileVisibility` decides whether there is a page at all. Each review's own
`Visibility` decides which reviews appear on it. A public review by somebody whose profile is
private is visible to nobody, which is the only reading of the two settings that does not surprise
whoever set them.

Both are applied in the query predicate rather than as a filter on the result, following the rule
every user-scoped read here follows: the scoping *is* the authorization boundary, so it belongs
where it can be read.

### 7. A private profile and an unclaimed name are the same 404

`PublicProfileService` returns null for both, and `UsersController` turns null into `NotFound`.
A 403 for one and a 404 for the other would turn the endpoint into a way of asking whether a given
name has an account here — which is precisely what somebody with a private profile has declined to
say.

**The owner is not an exception**, and that is a deliberate simplification rather than an oversight.
A "preview your own private profile" affordance would require the SSR loader to forward the visitor's
cookie, which makes the response vary per viewer, which makes the page uncacheable, which costs the
acquisition case the whole feature is for. The owner's own figures are at `/user`, which is
`private, no-store` and always has been.

### 8. The public document is assembled field by field, not derived from the private one

`PublicProfileService` does not recompute anything. `StatsService` already derives every figure from
the user's own rows, and a second aggregation over the same tables is a second answer waiting to
disagree with the first — a public profile claiming a different completion rate from the one its
owner is looking at would be worse than having no public profile.

But it does not hand `UserStatsDto` back either. It copies the parts across one at a time into
`PublicProfileDto`. **That is the entire reason that type exists**: returning the private document
would mean every figure ever added to the private profile becomes public on the day it is added, by
nobody's decision. A field reaches the public document only when somebody writes it into that
record.

What is left out today: the email address, the account id, the per-platform breakdown of hours, and
the time-to-finish median. The first two are identity rather than activity; the rest are figures
about how somebody spends their evenings that are interesting to their owner and nobody else's
business.

### 9. The figures and the reviews are two endpoints, because only one of them needs IGDB

`GET /api/users/{name}` makes no IGDB call at all, which is [0023](0023-profile-statistics-derived-at-read-time.md)'s
rule extended to the public page: a statistic about what somebody has done must not go dark because
a third party is. `GET /api/users/{name}/reviews` needs game titles and covers and therefore can.

Folding them together would mean an IGDB outage took out a page made almost entirely of our own
data. Kept apart, the route loader fetches both with `Promise.allSettled`, and a failure of the
second costs the review section and says so — *"has written 4 reviews, but they could not be loaded
just now"* — rather than reporting the person as having written nothing.

The reviews are still fetched in the loader rather than after hydration, unlike the game page's
community times. Reviews are the text a crawler came for (D8/D9), and text loaded by an effect is
text that was not indexed.

The pages of them are URLs for the same reason. `?page=N` is read by the loader, passed to the API,
and rendered as previous and next links — not a "load more" button, which would put every review
after the twentieth behind a click no crawler makes. A page number that names nothing, malformed or
past the end, is the same 404 as an unclaimed name: there are unboundedly many of them, and a
crawler must not be handed a 200 for each. The first page is the bare profile URL, so every page
has exactly one address.

### 10. The page is shared-cacheable, and that is a property of the endpoint

`CACHE_PROFILE` is `s-maxage=300, stale-while-revalidate=3600`. The page is byte-identical for every
reader — signed in, signed out, or its own owner — because the endpoints behind it vary on nothing
but the name in the URL and the loader sends no credentials. It does vary on `?page=`, which pages
the reviews, so the CloudFront cache key for this route has to include `page` (D12) — the rule
`/games` already has for `search`.

That is stated in the route so it can be *un*stated: the day this page grows a per-viewer element,
such as "you follow this person", the policy has to change with it. A degraded render, where the
reviews half failed, carries `no-store` instead, for the reason [0013](0013-http-caching-policy.md)
gives — caching a failure outlives the failure.

### 11. The home page forks on auth, which is what H3 and H6 were waiting for

Shipped alongside, because it is the other half of the same observation: `HomePage.tsx` had no
reference to `user` anywhere, so a signed-in returning user landed on the pitch.

Neither of the two things now on it needed a new endpoint. Continue Playing reads the Playing list
straight out of `ListsProvider`, and the stats strip reads `/api/user/stats`, which 0025 gave hours
to. That is why both were "unblocked and not built": they were waiting on a fork, not on a backend.

Two smaller calls inside it. The rail sorts by *recently moved* rather than the lists page's
*recently added*, because those differ for exactly the game it exists for — something added to the
backlog a year ago and started last night. And its one action is "mark finished", which goes through
`ListsProvider`; a status written any other way leaves a permanent hole in the history
([0018](0018-append-only-status-event-log.md)). "Log progress" is not there, because a seven-field
form behind a cover would be a worse version of a page that already exists.

**`useUserStats` needed the account-change guard its own comment predicted.** It shipped without
one, on the argument that it was only ever mounted inside the signed-in half of the profile route
and so was unmounted by a sign-out — with a note saying it would need one *"if it is ever lifted
somewhere that outlives a sign-out"*. The home page is that place. The account is now a required
parameter, and the guard is the whole of the shape
[0022](0022-entry-surrogate-key-and-the-wishlist-axis.md) settled on for the two list providers,
not the first half of it: the account is held in reducer state beside the figures it protects, the
transition is applied during render, and every completion is stamped with the account it was
fetched for and dropped on a mismatch. The first cut had the first two and not the third, on the
reading that the `AbortController` covered it. It does not — the abort runs in the effect cleanup,
after the commit, and a response landing in between would have been written under the new
account's name. `useHiddenPlatforms` had the same gap and is now keyed on the account for the same
reason: it is mounted on the home page's timeline, which outlives a sign-out, and the boolean it
used to take cannot tell one account from the next.

## Consequences

**A review is finally read by somebody other than its author.** That was 0025's stated gap, and the
visibility column it called "dead weight today" is now the thing deciding what appears. Every review
written since it shipped has a real answer to "did its author agree to this being public", which is
exactly what could not have been backfilled.

**0016's site-wide score histogram is now buildable, and is not built.** What ships here is one
person's distribution on their own public page. A histogram of *everybody's* scores for one game is
a different query against a different scope, and it belongs beside the game rather than beside the
person.

**`friends` is one value away in two places rather than one.** `Review.Visibility` and
`ApplicationUser.ProfileVisibility` are both string columns with a check constraint, and a follow
graph will want to add the value to both. Two additive migrations, and the "narrower wins" rule
above already says how the two combine.

**A username change breaks inbound links, and nothing redirects.** The old name becomes claimable by
somebody else after the rename, so a stored redirect would eventually point at the wrong person —
which is worse than a 404. A username history table with a permanent tombstone on released names is
the real answer, and it is a bigger commitment than a rename cooldown; the cooldown is what makes
its absence survivable.

**A returning user still sees the pitch for one request.** The home page is shared-cached and the
server render has no cookie, so the signed-in half only appears after `AuthProvider` learns who the
visitor is. Fixing it properly means a cookie-varying SSR render and a matching CloudFront
behaviour, which is D12's problem rather than this feature's.

**The export grew two fields and the manifest did not change.** `AccountExportDto` now carries the
username and the visibility. `ApplicationUser` is not a user-owned *table* — it is the user — so it
is not in `UserDataExporter.Manifest` and `UserOwnedDataTests` had nothing to say about the change.
Both fields are data the user entered: they chose the name, and an export that recorded what
somebody wrote but not whether they agreed to it being read would be missing the more consequential
of the two.

**A withdrawn profile outlives its withdrawal at the edge.** `CACHE_PROFILE` is five minutes fresh
plus an hour of `stale-while-revalidate`, and nothing invalidates a profile when its owner switches
it back to private, renames it, or deletes the account. So the edge keeps serving the old page for
five minutes and can hand one stale copy per edge to whoever asks first for up to an hour after
that — under the old name too, after a rename. Section 10 accepted that staleness for *content*; it
is a different matter for consent, which 0025 says a default cannot stand in for and this record
says a TTL should not either. The fix is CloudFront invalidation from the API on those three events,
which needs infrastructure this codebase does not have yet — the distribution id and an IAM
permission on the task role — and is ROADMAP D14. Shortening the TTL instead was considered and
rejected: it would trade the crawler-latency case this page exists for against a window it could
only narrow, not close.

**There is no sitemap yet.** D8 wants `sitemap.xml` to list public profiles, and this is what makes
that list non-empty. It needs a real domain first, so it stays where the roadmap has it.
