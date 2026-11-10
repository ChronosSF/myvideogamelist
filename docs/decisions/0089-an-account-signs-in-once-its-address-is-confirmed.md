# 0089. An account signs in once its address is confirmed, by a link whose token never reaches a server

**Status:** Implemented. [#421](https://github.com/ChronosSF/myvideogamelist/issues/421), part of
[#112](https://github.com/ChronosSF/myvideogamelist/issues/112). Sent through
[0088](0088-email-goes-through-productions-ses-and-a-deployment-with-no-sender-does-not-start.md)'s sender; proved
on a deployed environment only once that record's two owner steps are done.

## Context

- **Registration signed the new account straight in**, with an address nobody had checked. Identity's
  `SignIn.RequireConfirmedAccount` was off, because there was no way to send a confirmation.
- **#112 says it has to be on before real accounts exist.** Turned on later, it locks out everyone who
  registered before it.
- **The request for SES production access said so** ([#418](https://github.com/ChronosSF/myvideogamelist/issues/418)):
  "An account cannot sign in until its address is confirmed", and a reset email at most once every few minutes
  per address. A resend is the same kind of thing.
- **Identity refuses an unconfirmed account before it checks the password.** `SignInManager.PasswordSignInAsync`
  runs `PreSignInCheck` first and answers `NotAllowed` without looking at the password or counting a failure.
- **The SSR server logs every page's whole URL** ([#407](https://github.com/ChronosSF/myvideogamelist/issues/407)),
  query string included, for two weeks. A token in a query string would be in that log.
- **A confirmation token stays valid for its whole lifespan.** Identity's default is a day, and
  `ConfirmEmailAsync` does not change the security stamp, so using the token does not spend it. The
  integration suite's `ConfirmEmail_PressedTwice_ConfirmsTwice` uses one token twice and both succeed.

## Decision

### 1. Registration sends a link and signs nobody in

`POST /api/auth/register` makes the account, sends the confirmation, and answers `{ emailSent }`. An email that
did not go is not a failed registration: the account exists by then, and a second attempt would only be told
the name is taken. So the dialog says the account is ready, the email did not go, and here is a button to
send it again. The send uses `CancellationToken.None`, because a reader closing the tab must not cost them the
email that lets them in.

The dialog no longer closes. It shows where the link went, a button to send it again, and a way to sign in.

### 2. The token travels in the fragment

The link is `{Email:SiteUrl}/confirm-email#user={id}&token={token}`. A browser sends nothing after the `#`: not
to the server (so the token is in no request log), not to a cache (so in no cache key), and not in a
`Referer`. The page reads the fragment after hydration, through `useSyncExternalStore` with a server snapshot
of null, and posts both halves to `POST /api/auth/confirm-email`. Then it takes them out of the address bar
with `history.replaceState`, whether or not they worked, so the history keeps no token.

- **A `POST` from the page, never a `GET` the link reaches.** A state change behind a `GET` is forgeable and
  cacheable ([0033](0033-what-the-api-refuses.md)), and a mail scanner that opens every link would confirm the
  address on its owner's behalf.
- **The origin is configuration, `Email:SiteUrl`, never the request's host.** A link built from the `Host`
  header can be pointed at somebody else's site with a real token in it. It is required wherever SES sends,
  and the dev server's `https://localhost:58546` otherwise. The App stack sets it from the environment's host.

### 3. Confirming signs nobody in

A token stays good for its day after it is used, so a link that signed its holder in would be a way into the
account for anyone who saw the email: forwarded, or left in a shared inbox. Signing in still takes the
password. A link pressed twice confirms twice, harmlessly. No such account and a wrong or expired token are one
answer.

### 4. "Confirm first" is said only to somebody who gave the password

When sign-in comes back `NotAllowed` for an unconfirmed address, the controller checks the password itself.

- **Locked out:** the same 401 as any wrong combination.
- **Wrong password:** counted with `AccessFailedAsync`, so five lock the account as they would a confirmed
  one, and the same 401.
- **Right password:** the failure count is reset, the link is sent again at the account's pace (§5), and the
  answer is a 403 with `unconfirmed: true` and a sentence. The dialog shows it and offers another. So
  somebody whose first email was lost, or who signed up on the revision before this one and was sent none,
  has a link waiting without having to ask.

Said as Identity leaves it, the refusal would tell anybody who typed an address that it has an account
waiting, and would let them guess its password with no lockout at all.

### 5. A resend is paced per account, and answers the same whatever happened

`POST /api/auth/resend-confirmation` takes an address or a username, as signing in does, and always answers
202.

- **The same 202 every time:** an unknown account, a confirmed one, one paced, and one just sent another
  link all answer alike.
- **Per account:** `AccountConfirmation` sends one confirmation every five minutes at most, counting the one
  registration sent. The pace is claimed before the send and lifted if the send fails. That pace is what
  keeps the endpoint from filling somebody's inbox.
- **Per network address:** the endpoint joins login and register under `AuthWrites`, and shares their ten
  attempts every five minutes. That keeps it from asking about many addresses quickly.
- **The time it takes tells nothing new.** A send makes the answer slower, but registration already says
  whether an address is taken.
- **Kept in memory, per task.** The dev environment runs one task. With several, an account could be sent one
  link per task per window: a handful, not a flood. #420's `EmailDeliveries` is where an exact count would go.

### 6. Every account before this one is confirmed by a migration

`ConfirmExistingAccounts` sets `EmailConfirmed` on every row. None of them ever proved its address, and this
says they did. It is the price of turning confirmation on now, while the accounts it would lock out are test
accounts and the owner's, rather than later, when they would be other people's. The down migration does
nothing: which accounts were unconfirmed is recorded nowhere.

It has no cutoff, although the old revision keeps taking sign-ups while it runs. That revision confirms
nobody and sends no link, and the migration task runs before the new revision starts, so every row the update
can see is the kind it exists for, whenever it committed. One committed after it stays unconfirmed and is sent
its link at its first sign-in (§4).

### 7. The email is plain text

It is plain text, from 0088's sender. It says what the email is, gives the link, says how long the link
works, read from Identity's token lifespan so that it cannot promise longer, and says it is safe to ignore. Every mail program shows plain text, and a link in it is clickable in all of
them. There is no markup to build from a username.

## Consequences

- **The sign-up dialog, the sign-in dialog, the provider and every test that signs up changed.**
  - The integration suite's `Browsers.RegisterAsync` registers, confirms through `RecordingEmail`, and signs in.
  - The browser smoke test reads its link from the API's outbox and signs in on the page the link opens.
  - The Lighthouse seed does the same through the API.
  - `e2e/outbox.ts` gives each harness its own outbox folder, and `Email:SiteUrl` is the origin the browser
    opens.
- **A new route, `/confirm-email`**, never cached and never indexed. It is not in the sitemap and has no
  canonical URL.
- **The limiter's endpoints are now three**, in `RateLimiting.cs`, the backend rules and `CLAUDE.md`.
- **Not here:** the password reset (#422), whose limit per address can share `AccountConfirmation`'s pace or
  #420's table; the change of address (#423); the privacy policy's sentence that the site sends no email (#112's
  checklist, on #408); and a longer life for the confirmation token than Identity's day, if people turn out to
  open the email later than that.
