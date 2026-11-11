# 0090. A password reset is a link that works once, for an hour, and ends every session

**Status:** Implemented. [#422](https://github.com/ChronosSF/myvideogamelist/issues/422), part of
[#112](https://github.com/ChronosSF/myvideogamelist/issues/112). Sent through
[0088](0088-email-goes-through-productions-ses-and-a-deployment-with-no-sender-does-not-start.md)'s sender, in the
shape of [0089](0089-an-account-signs-in-once-its-address-is-confirmed.md)'s confirmation. Answers the question
[0077](0077-a-deleted-accounts-sessions-end-with-it.md) §4 left for a password change, and the last consequence of
[0033](0033-what-the-api-refuses.md).

## Context

- **There was no way back into an account whose password was lost.** Since 0089, not even by signing up
  again: the address is taken.
- **The request for SES production access promised AWS** that "a reset request sends at most one email per
  address every few minutes, answering the same whether or not an account exists"
  ([#418](https://github.com/ChronosSF/myvideogamelist/issues/418), #112's checklist). 0033 had already said
  the second half, for the reason the lockout says nothing.
- **What Identity's `UserManager.ResetPasswordAsync` does**, read at the tag this repository pins (v10.0.14):
  it checks the token with the provider `Tokens.PasswordResetTokenProvider` names, then checks the new
  password, and only then sets the hash and a new security stamp and writes the account, once. A failure at
  either check writes nothing. It leaves `AccessFailedCount` and `LockoutEnd` as they were.
- **Every data-protection token carries the security stamp it was made under**, and is refused once the stamp
  has changed. So the reset's own new stamp spends the link that made it, and every other reset and
  confirmation link out for that account. The default provider's lifespan is a day, and it issues the
  confirmation's token, the reset's and a change of address's alike.
- **A changed stamp ends a session only at Identity's own check, every thirty minutes.** 0077 §4 left it there
  for a rename, and named a password change as where to ask again.
- **OWASP's Forgot Password Cheat Sheet** asks for a token that is single use and expires, the same message
  for an account that exists and one that does not, a limit per account, existing sessions invalidated, no
  lockout from a forgotten-password request, and that the person then signs in "through the usual mechanism".

## Decision

### 1. Two endpoints and a page, with the token in the fragment

- **`POST /api/auth/forgot-password`** takes an address or a username, as signing in does, and always answers
  202 (§7).
- **The link** is `{Email:SiteUrl}/reset-password#user={id}&token={token}`, in the fragment for 0089 §2's
  reasons: no request log, cache key or `Referer` ever holds it, and the origin is configuration, never the
  request's host.
- **The page** reads the fragment after hydration and takes it out of the address bar at once, before anybody
  types. The confirmation page waits until it has posted, but this page waits on a person, and a link left in
  the address bar or in the tab's back and forward entries is, for its hour, a new password for whoever uses
  that browser next. `history.replaceState` rewrites only that entry: whether a browser's own history list
  keeps the address the page was opened at is the browser's to decide, and nothing here checks it. Reloading
  the page then finds no link, and says what the page is for rather than calling the link broken; opening it
  from the email again works, since it is spent only by a reset.
- **`POST /api/auth/reset-password`** takes the account, the token and the new password from the page.

### 2. The token has a provider of its own, and works for an hour

`PasswordResetTokenProvider` is Identity's data-protection provider under options of its own: an hour, and a
protector name of its own. A reset is asked for by somebody waiting for it, so an hour is plenty, and for that
hour the link sets the password of the account for whoever holds it. A confirmation can keep the default's day:
it is opened at leisure, and grants nothing but the confirmation.

The email says how long the link works by reading `PasswordResetTokenProviderOptions`, the provider's own
options, so it cannot promise longer than the token lasts. `AddPasswordResetTokens` registers the provider and
names it as the reset's in one call, and the integration suite checks the application's own options map the
reset to it. The link works once, by the stamp.

### 3. Every account is sent a link, and completing it confirms the address

Confirmed or not, locked out or not. The link went to the address and came back, which is what a confirmation
proves, so the reset sets `EmailConfirmed` as well. Somebody who never confirmed and has lost the password they
chose has no other way in: the sign-in that re-sends the confirmation (0089 §4) needs the password. One email
covers both.

### 4. It signs nobody in

The page says the password is changed and opens the sign-in dialog. There is then one way in, with its
lockout, its confirmation check and its choice to be remembered, rather than a second way beside it that each
of those would have to be kept in step with. 0089 §3's reason does not apply here, since this link is spent by
its use; this one does.

### 5. The lockout ends

The reset sets the failure count to nought and clears `LockoutEnd`. Identity leaves both, so five guesses by
anybody, from anywhere, would keep the owner out of an account whose password they had just set, told for
fifteen minutes that it is wrong. The link proves more than a password does.

### 6. Every session ends at its next request

The reset records the moment in `AspNetUsers.SessionsEndedAt`. The check 0077 added to every request a session
cookie authenticates already reads the account's row by its key. It now reads that column and the security
stamp too, and refuses a session that began at or before the moment under a stamp the account no longer has.
It refuses one exactly as Identity's own check does, clearing the cookie and the signed-in flag.

The check's class, `DeletedAccountSessions` until now, is `AccountSessions`, since it no longer ends only a
deleted account's sessions. Beside the check is the one writer of the column, `EndAll`. It ends nothing by
itself: it has to be saved with a write that also changes the stamp, as the reset's does.

- **At once, rather than in up to thirty minutes**, because somebody resetting a password may be doing it
  because somebody else has it.
- **Both halves are needed.** A session's start is kept in its cookie to the second, so the moment alone would
  also end a session signed in just after the reset, within the same second. The stamp alone would end a
  renamed account's other sessions at once, which 0077 §4 leaves on Identity's clock. Every session from before
  the reset carries a stamp the reset replaced, and every session since was issued after it.
- **A minute's margin.** A sign-in, or Identity's renewal of a session, reads the account and then issues the
  cookie, so one that read the row just before the reset committed issues a cookie just after it, under the
  old stamp. A session under an old stamp issued up to a minute after the reset is therefore ended too. A
  session under the new stamp is kept whatever its time, so the margin costs only a rename made within that
  minute, whose other sessions end at once rather than at Identity's check.
- **Not a lower `ValidationInterval`**, for 0077 §2's reason: Identity's check rebuilds the principal and
  reissues the cookie each time it runs.

### 7. Paced per account and per kind, and the same answer whatever happened

- **One reset email per account every five minutes**, claimed before the send and given back whenever nothing
  went. That was the confirmation's mechanism, written inside it. It is now `EmailPace.SendAsync`, the whole
  sequence, which both emails go through: claim, make the token, send, and give the claim back on any failure.
  A token that could not be made, or a send SES refused, answers `Failed`, and anything else is thrown on.
- **Each kind of email has its own pace.** A confirmation sent at sign-up must not hold back the reset somebody
  asks for a minute later, having mistyped the password they chose: the reset is what lets them in. One account
  can be sent one of each in five minutes, and never two resets.
- **The same 202** for no such account, one paced, and one just sent a link. The rate limit (`AuthWrites`) is
  per network address and stops a caller asking about many accounts quickly.
- **The time an answer takes still says whether an email went.** OWASP asks for a uniform time, which sending
  outside the request would give. Registration already says whether an address is taken (0089 §5), so it would
  hide nothing that can't be learned there.
- **The dialog's "Check your inbox" ends with the support address**, as the confirmation's resend does
  ([0091](0091-a-bounce-or-a-complaint-stops-all-mail-to-that-address.md) §5). SES drops a send to an address
  that once bounced or complained and tells the API nothing, so the API answers that a link went and asking
  again cannot help that person. The sentence is one component, `StillNothing`, for both.
- **A refused link is one answer**: a 400 with `invalidLink`, for no such account and for a wrong, expired or
  spent token alike.
- **A password the rules refuse** is answered as registration answers it, with Identity's sentences. It spends
  nothing, so the same link works for the next try. A reset that lost a race with another write to the account
  is a 409 that says to try again, rather than Identity's sentence, which is written for a log.

### 8. The email is plain text

As 0089 §7. It says that somebody asked, which may not be the owner. It then gives the link, says how long it
works and that it works once, and says that a new password signs the account out everywhere and that the email
can be ignored.

## Consequences

- **A new column, `AspNetUsers.SessionsEndedAt`** (migration `ResetEndsSessions`), nullable with no default, so
  adding it rewrites no row. It is in the account's data export, as `LastSeenAt` is.
- **The session check reads two columns of the row it already read.** Still one query by primary key.
- **Any change of the stamp spends an outstanding reset link**, a rename's included. Somebody who renames while
  a reset email is on its way asks for another.
- **The limiter's endpoints are now five**: login, register, the confirmation's resend, and the reset's request
  and its completion. They are listed in `RateLimiting.cs`, the backend rules and `CLAUDE.md`.
- **A new route, `/reset-password`**, never cached and never indexed. The sign-in dialog gains "Forgot
  password?", which opens a third dialog.
- **The browser smoke test has a sibling**, `e2e/password-reset.e2e.ts`, that asks for a reset, reads the link
  from the outbox, sets a new password on the page and signs in with it.
- **Left for later:**
  - a "sign out everywhere" control, which would call `EndAll` and change the stamp in the same write;
  - whether a change of address ends sessions, which is #423's to decide; its write changes the stamp already, so
    `EndAll` is all it would add;
  - an exact count across tasks, which is #420's `EmailDeliveries`;
  - the privacy policy's sentence about email, which is #112's checklist, on #408.
