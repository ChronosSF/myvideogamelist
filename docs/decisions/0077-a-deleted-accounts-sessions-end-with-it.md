# 0077. A deleted account's sessions end with it

**Status:** Implemented — #295. Amends [0024](0024-the-ownership-contract.md), whose deletion signed out
only the browser it was made in. §4's question is answered for a password reset by
[0090](0090-a-password-reset-works-once-for-an-hour-and-ends-every-session.md): the same check also ends every
session a reset left behind, while a rename stays on Identity's clock.

## Context

`DELETE /api/user` deletes the account and signs out the browser that asked. A cookie for the same
account held anywhere else (another browser, a phone) stayed a valid ticket: it is signed with the key
ring ([0043](0043-where-the-key-ring-lives.md)) and good for thirty days. Identity asks whether a
cookie's account still exists only when it checks the security stamp, which it does every thirty minutes.

Until that check, an endpoint that reads only the cookie's id claim (`userManager.GetUserId`) answered as
if the account were still there. The integration suite showed each kind: `GET /api/user/stats` answered
200 with every figure zero, `GET /api/user/export` answered 500, and a write ran into the foreign key to
the account row that had gone. The person who deleted their account could open the site on their phone
and see an empty library under their old session, which reads as the deletion having failed.

The issue offered two ways out: check that the account exists in the cookie's `OnValidatePrincipal`, or
load the user in the endpoints that read only the claim.

## Decision

### 1. Every request a session cookie authenticates asks whether its account exists

`Security/DeletedAccountSessions.cs` wraps the cookie's `OnValidatePrincipal`. Identity's own
security-stamp check runs first, on its own thirty-minute clock, and then one query by primary key asks
whether the account is there. If it is not, the session is refused and signed out the way Identity's own
refusal signs one out: the response deletes the session cookie, and `OnSigningOut` deletes the signed-in
flag ([0074](0074-the-home-page-is-kept-twice-by-a-flag-that-names-nobody.md)). The request then carries
on as a visitor's request, which means a 401 wherever a session is needed and a 204 from `/api/auth/me`.

### 2. Not by making Identity's check run on every request

`SecurityStampValidatorOptions.ValidationInterval = TimeSpan.Zero` would also catch a deleted account,
since its check loads the account. But on every request it would load the account, its roles and its
claims to rebuild the principal, and set the cookie again on every response. Deletion needs to know only
whether a row exists, and `AnyAsync` on the key answers that.

### 3. Not in each endpoint

Loading the user in each endpoint that reads only the claim fixes the endpoints that exist today, and the
next endpoint would have to remember to do it too. Authentication runs for every endpoint, so the check
covers all of them, including ones nobody has written yet.

### 4. A changed security stamp stays on Identity's clock

A rename rotates the stamp (0027), and a session elsewhere is still signed out within thirty minutes, as
before. This record is about an account that has gone, which a stamp cannot express. Ending every session
the moment a stamp changes would need a stamp comparison on every request. That would be the same one
query, but it is a different promise: it would sign a renamed account out on every other device at once.
Nobody has asked for that, and a password change or a "sign out everywhere" would be where to ask.

## Consequences

- **One more query per request that carries a session cookie.** A primary-key lookup on `AspNetUsers`.
  Loaders send no cookie (`loaderFetch`), so the cost falls on the browser's own requests, which already
  read the account or the user's rows for nearly everything they ask.
- **A signed-in browser's request now needs the database, even for a read that does not.** The game
  search sends the cookie (`useGameSearch` explains why), so while the database is down a signed-in
  reader's search fails, where before only IGDB had to answer. A visitor's search does not need the
  database. A signed-in reader's lists, profile and `/api/auth/me` fail with the database in either case.
- **A session never comes back.** An account's id is a new GUID, so an account registered later with the
  same address or name is not the one an old cookie names.
- **The proof is `AuthFlowTests.DeleteAccount_FromOneBrowser_EndsTheSessionInEveryOther`.** It deletes
  an account in one browser and then, from a second browser signed in to the same account, asks one of
  four endpoints: the statistics, the export, a write or `/api/auth/me`. Each answers as it would answer
  a visitor, and that response clears both cookies. With the check removed, all four cases fail as the
  context describes.
