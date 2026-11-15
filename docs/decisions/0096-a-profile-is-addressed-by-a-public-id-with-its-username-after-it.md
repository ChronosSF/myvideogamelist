# 0096. A profile is addressed by a public id that never changes, with its username after it for people to read

**Status:** Implemented. [#470](https://github.com/ChronosSF/myvideogamelist/issues/470),
[#477](https://github.com/ChronosSF/myvideogamelist/pull/477). Answers
[#146](https://github.com/ChronosSF/myvideogamelist/issues/146): a released name needs no tombstone, because no
name is an address. Amends [0027](0027-usernames-and-public-profiles.md) §4 and its consequence "a username
change breaks inbound links, and nothing redirects"; [0036](0036-what-a-crawler-is-told.md) §6's canonical URL;
[0058](0058-a-withdrawal-leaves-the-edge-when-it-is-made.md) §1's paths and §2's wildcard; and
[0081](0081-a-withdrawal-is-never-refused-and-one-accounts-are-paced.md) §5's sums. Settles, for the profile,
what [#320](https://github.com/ChronosSF/myvideogamelist/issues/320) asked: every other spelling redirects.

## Context

- **A profile was `/u/{name}`**, looked up by `NormalizedUserName`, so any letter case rendered it.
- **A rename broke every link to it, and later handed those links to somebody else.** After the thirty-day
  cooldown the old name is free to claim. 0027 rejected redirecting an old name for that reason: the redirect
  would one day point at the wrong person, which is worse than a 404. It named a username history with
  permanent tombstones as the real answer, and #146 held that question open.
- **The edge was keyed on the name too.** A withdrawal cleared `/u/{name}*`. Invalidation paths are
  case-sensitive and the page rendered under any case, so a copy cached under a spelling the site never linked
  to kept the old window (0058 §2, #320). A rename cleared both names, three paths with the sitemap's.
- **Dev opens to testers, and their data moves to production at launch**
  ([#465](https://github.com/ChronosSF/myvideogamelist/issues/465)). Ids made on dev carry over, so this is
  the trial's one schema change and has to land before it.

The issue decided the shape: only an id is looked up, a missing, old or wrong name answers a 301 to the current
one, the id is a new column, short and random and made at registration, never Identity's account id, a private
profile is the same 404 by id, everything that addresses a profile switches together, and the export carries
the id. It left two questions open, which §1 and §8 answer.

## Decision

### 1. `/u/{publicId}/{userName}`, and only the id is looked up

The route is `u/:publicId/:userName?`. The API's `/api/users/{publicId}`, its reviews and its favourites read
the id and nothing else; so does a reader's report, which named the profile by its handle and now names it by
its id, since a handle can change hands between a page's render and the report.

**Any name after the id but the profile's own is a 301 to it**: an old name, a wrong one, the right one in other
letter case, or none at all. The page of reviews comes along (`?page=N`), and nothing else does. The name is the
owner's to change and costs nothing to get wrong, so the page answers to the id and corrects the rest.

**No shortcut by name.** One segment after `/u/` is always read as an id. A shortcut to whoever holds a name now
would hand a shared link to whoever claims the name next, which is what this record removes, and the site is not
live, so no name link exists that has to keep working. A name in that place is a string no account holds, and is
the same 404 as any other.

**A username may be the same string as somebody's id**, since the alphabets overlap. That changes nothing,
because no name reaches a lookup. Unit and integration tests both hold it: an account named with another
account's id is found by its own id, and the id finds its own account.

**One 404 for everything that is not a public profile**: a private profile, an id nobody holds, and a segment
that could not be an id at all, the last answered without asking the API. The 404 comes before any redirect, so
a wrong name on a private profile is never told where the profile is. The API's 404 bodies for a private
profile and an id nobody holds differ only in their trace id, and the integration suite compares them with it
taken out. This is 0027 §7 kept, keyed on the id.

### 2. The id: twelve characters from thirty symbols, drawn by the operating system

`PublicIdPolicy`: the digits and the lower-case consonants but `l`, thirty symbols, twelve places, drawn with
`RandomNumberGenerator.GetString`, each symbol equally likely. No vowels, so no id spells a word in a link
somebody shares; no `l`, so none mixes it up with `1`; lower case only, so an id is one string however it is
read back, and one in capitals is a string nobody holds.

- **Random, not sequential**, so an id says nothing about how many accounts there are or in what order they came.
- **Never Identity's account id**, which is half of every confirmation and reset link (0089 §2, 0090). A value
  printed on every public page must not be one.
- **Made when the account is.** An `ApplicationUser` draws one as it is constructed, as Identity's own
  constructor draws the account id and the security stamp, and registration draws again before the write if a
  live account already holds it: one indexed read, up to five times, then an exception, because five live ids
  in a row means the generator is broken. Two registrations drawing the same id between that read and their
  inserts are left to the unique index, which refuses the second as a 500, at odds of one in 30^12.
- **The column's check holds the shape**, built from the policy's constants: exactly twelve characters, all from
  the alphabet. §5 needs the fixed length.

**"Never reused" rests on the length, not on a record of ids that were.** A new id can never be a live account's
(above). It could be a deleted account's, since nothing remembers those, and an old link to that account would
then lead to the new one. There are 30^12 = 5.31 × 10^17 ids. If R accounts are ever registered and D of them
deleted, the chance that any registration ever draws a deleted account's id is at most R·D / 30^12, and at most
R² / 30^12 if every account were deleted:

| Registrations, ever | Chance of any reuse, every account deleted |
|---|---|
| a million | 1.9 × 10⁻⁶, one in 530,000 |
| ten million | 1.9 × 10⁻⁴, one in 5,300 |
| a hundred million | 1.9 × 10⁻², one in 53 |

and a reuse costs anything only if a link to the deleted account is still followed. At a tenth of accounts
deleted, each row is ten times smaller. The issue's example was eight characters: at 30^8 = 6.6 × 10^11, a
million registrations, every one deleted, would expect a reuse (R² / N ≈ 1.5). Ten characters would make the
ten-million row one in six. Twelve is two characters more than ten for a factor of nine hundred.

### 3. The migration gives every account an id in the statement that adds the column

`AddProfilePublicId` creates a function, `new_public_id()`, which draws an id of the same shape with
PostgreSQL's `random()`, and adds the column as required with that function as its default. A function rather
than an expression in the default, because PostgreSQL refuses a subquery there: its `CREATE TABLE` reference
says so ("Subqueries are not allowed either"), and the server said so when tried.

**A volatile default backfills every row with an id of its own.** `ALTER TABLE`'s reference says a column added
with a volatile default causes "the entire table and its indexes to be rewritten"; that the default is drawn for
each row was seen rather than read: against PostgreSQL 18, two thousand rows took two thousand distinct,
well-formed ids, and the alphabet's thirty symbols appeared between 736 and 873 times each in 24,000. So the
column is required from the statement that adds it, with no window in which a row has none.

**The default stays, for the revision still serving.** The migration task runs before the new revision starts
(0079), and the old one inserts accounts without the column. With no default every sign-up would be refused for
the length of the release; with it, each gets an id from the database. The integration suite inserts an account
the way the old revision does and reads one back. A fixture or a support script gets one the same way. The
application always sends its own. `random()` is "not suitable for cryptographic applications", in
PostgreSQL's words, and an id made by it does not need to be: it is public, and what its randomness hides is the
order accounts came in.

**Under the five-second lock timeout** (0079). `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock "unless explicitly
noted", and adding a column is not noted, so the add, the rewrite, the index and the check hold one lock on
`AspNetUsers` in the migration's transaction. It waits for whatever the old revision has open on the table, and
holds every reader of the table for as long as rewriting a few hundred rows takes. A release refused with
`55P03` is re-run, as any is. A collision in the backfill would refuse the unique index and roll the whole
migration back for a re-run to draw again; at a few hundred accounts the odds are below one in a million million.

### 4. The 301 is kept by nobody

**It carries `private, no-store`.** A permanent redirect with no policy is one a browser may keep for good, and
the two old names of a profile renamed and renamed back would then send a browser round in a loop between them.
The edge has the same loop to offer for a few seconds after a rename: a redirect it kept under one name can meet
a page it rendered under the other after the rename and before the invalidation landed, the review found, and
for as long as a failed invalidation leaves both there. A redirect nobody keeps can meet neither. It costs one
request to the origin for each old link followed, which is few, and the redirect names the profile's current
name, so with nothing kept there is nothing for a withdrawal to take back. The first cut gave it
`CACHE_PROFILE`, on the argument that every withdrawal would clear it with the page; that answered the browser's
loop and not the edge's.

**It goes out exactly as the loader throws it.** React Router 8.5 returns a loader's redirect as it was thrown
for a document request, so the route's `headers` export is not asked and `entry.server.tsx` never sees it; for a
`.data` request it becomes the 202 that carries the redirect, with the thrown response's headers copied onto it,
and `handleDataRequest` adds its own. Read in `react-router`'s `server-runtime` (`query()` hands back the
response, `generateSingleFetchRedirectResponse` copies its headers), and seen on the dev server. So
`redirectResponse` in `@/lib/seo` adds what that file would add to a document, as `resourceResponse` does for a
resource route.

### 5. A withdrawal clears one path per profile, under every name

Every path in 0058 §1 that read `/u/{name}*` reads `/u/{publicId}*`, and so do 0056 §8's, 0076 §5's and 0095's.
Every address of a profile starts with its id, whatever name follows: its page, its `.data` URL and every query
string on either, under its current name and under every name it had before. So:

- **A rename, or a change of letter case, is one profile path, not one for each spelling**, with the sitemap
  files beside it, since they list the old address until the rename. Two paths where there were three. The page
  cached under the old name goes, and the next request there is answered with the redirect.
- **No copy escapes it.** 0058 §2's gap, a copy cached under a spelling the site never linked to and out of reach
  of every invalidation, is gone: a page is rendered under one spelling only, every other redirects, and every
  spelling is under the id.
- **It covers no other profile.** 0058 §2 accepted that `/u/alice*` also took `/u/alice_2`. Every id is twelve
  characters, which the column's check holds, so no id is the start of another.
- **The paths no longer name the account.** 0058's consequences note that CloudFront keeps every invalidation in
  the distribution's list, so a deleted account's name stayed readable there. The list now holds its id, which
  names nobody once the account is gone, and so does the log.

0081 §4's three changes of case a day stay: each still sends its paths at once and can be repeated with nothing
in between. Its §5 sums change with the paths: three changes of case are six paths rather than nine, and a full
rename two rather than three, so one account's day comes to about 146 rather than 150. Every task's start still
sends `/u/*`.

### 6. Everything that addresses a profile switched together

- The route, the loader and the error page, which links the first page of reviews by the id.
- `/api/users/{publicId}`, its reviews and its favourites. `PublicProfileDto` carries the id, so the page builds
  its own address from what it was answered with.
- The canonical URL and the share card's `og:url`, from the loader's data and never the request (0036 §6).
- The sitemap: the feed answers with each profile's id and name, and the file writes the same string the page
  gives as canonical. The order is still the account id's.
- Every link to a profile: the navbar's own page, the account card and the user page, from `/api/auth/me` and
  every profile change, which carry the id; a game's member review cards; the moderation queue.
- A report, and the report button's test for the reader's own review or profile, which compares ids.
- The Lighthouse audit and the visual suite read the id from `/api/auth/me`. The browser smoke test visits no
  profile.

`profilePath` in `@/lib/profilePath` is the one place an address is built, so a link, the canonical URL, the
redirect and the sitemap cannot write different strings. `isPublicId` restates the shape for the loader to
refuse a segment without asking, and `serverMirrors.test.ts` holds it to `PublicIdPolicy`.

### 7. The export carries the id, and the import leaves it behind

`AccountExportDto` has `PublicId` beside the username: an export says where its owner's page was. A new column on
the account trips no test (0024), so the projection was written by hand. The import reads nothing of the account
section, so the id stays behind: an import fills an account that already has its own, the address of a different
page. `ExportRoundTripTests` says so.

### 8. The thirty-day rename cooldown stays

0027 §4 gave it two reasons: a rename broke every link to the old name, and a stream of renames is how a
namespace gets churned by somebody cycling names to squat them. The first is gone. The second is not, and the
cooldown keeps its place. A change of letter case still skips it.

### 9. Rejected

- **A shortcut by name**, §1.
- **A history of names with tombstones** (#146). It would keep a name from being claimed again, and so keep old
  links pointing at the right person; with the id as the address, old links already do, and no name needs
  keeping from anybody.
- **The account id, or an encoding of it.** The account id is half of every link that changes an account, and
  any reversible encoding of it, or of a sequence, gives away the order accounts came in.
- **Ids from the database's default alone.** The application could read back what the database drew, but the
  default cannot draw again when an id is taken, and `random()` is not the operating system's generator.
- **Case-insensitive ids.** An id is copied, never typed from memory, and one string per id keeps the lookup an
  exact match over the unique index.

## Consequences

- **The address is longer by thirteen characters**, and the name after them is decoration as far as the server is
  concerned. A link shared with the id alone works.
- **The release that brings this does not survive a mixed window.** While the API and the front end roll
  separately, a front end of either release paired with the other's API answers every profile with a 404 for a
  minute at a time, and an old front end writes a profile sitemap file of nonsense, cached for the profile's
  window; the report button is drawn for every reader rather than hidden from all of them. It is one deploy, to
  dev, before the testers arrive, and every API task's start invalidates `/u/*` and the sitemap files (0081 §2),
  so it is not worth a compatibility layer. A later change to either side should keep to the old shape for one
  release, as the rest of the site does.
- **A rename moves nothing**: the page, its links, its reviews' links on game pages and its place in the sitemap
  file stay where they were, and the old name's links follow it.
- **The migration runs on dev against testers' accounts**, under the lock timeout, with the old revision serving.
  Locally it was run, by the API's start in Development, against a copy of the development database
  (`mvgl_i470`): its six accounts took six distinct, well-formed ids, and the pages then answered as §1 and §4
  say, a rename included.
- **Not proved here:** what CloudFront does with the 301 and its policy, and that the one path takes a renamed
  profile's copies under both names off the edge. Only a deploy shows it, as
  [#319](https://github.com/ChronosSF/myvideogamelist/issues/319) does for 0058.
- **`infra/README.md` gives `/u/<publicId>*`** as the path to invalidate a profile by hand, corrected once
  the edge's other change in flight ([#438](https://github.com/ChronosSF/myvideogamelist/issues/438)), which
  edits that directory, had merged.
