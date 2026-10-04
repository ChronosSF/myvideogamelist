# 0042. Admins are account ids in configuration, behind one server-side policy

**Status:** Implemented — the first admin page is #163

Records the admin model [`specs/release-timeline-and-calendar.md`](../../specs/release-timeline-and-calendar.md)
§7 specified, because it is not the calendar's alone: the next thing an operator has to change
without a deploy — the free-tier limits `FeatureFlags` is planned to hold (#142) — would be edited
the same way.

## Context

Until the release calendar, nothing in this application was maintained by anybody but its users.
The calendar changed that. Store sales have no source a program can read (spec §6), so somebody
types them in a few times a year, and the same goes for the list of showcase names an IGDB event is
matched against.

Two ways in were ruled out before this record. SQL, because the deployed database has no public
endpoint ([0015](0015-fargate-confirmed-and-nat-less-networking.md)) and a hand-written `INSERT`
skips every rule the application applies. A data file in the repository, because every date would
then be a pull request and a deploy. What was left was a page in the application — and with it, the
question of who may use one.

## Decision

- **An admin is an account id listed in configuration**: `Admin:AccountIds`, from user secrets
  locally and `Admin__AccountIds__0` (then `__1`…) when deployed. Ids because they never change. A
  username can be given up and claimed by somebody else ([0027](0027-usernames-and-public-profiles.md)),
  and an address can be changed and does not belong in a deployment's environment.
- **One authorization policy, `admin`, enforced on the server** and required on the admin
  controller's class, so an action added later is guarded without anybody remembering to guard it. A
  test fails if any action carries `[AllowAnonymous]`. `AdminAccounts` is the one place the question
  is answered, for the policy and for `/api/auth/me` alike.
- **The navbar's link is presentation.** `UserProfileDto.IsAdmin` exists so the link can be shown to
  the one person it is for. A client that believed it wrongly would be refused, not let in.
- **Alike in every environment.** Nobody is an admin until named, in Development too — unlike the
  statistics tiers' stand-in (`specs/profile-statistics-tiers.md` §4), which grants everything
  locally. That one withholds figures, so a local grant only makes local work easier. This one
  guards writes, and a local default that let everybody in would leave the refusal unexercised
  exactly where the page is built.
- **An admin page edits reference data and nothing else** — no user's data, no accounts. Its tables
  carry no `UserId`, not even to record who changed a row, because `UserOwnedDataTests` recognises a
  user's data by that column and would demand a cascade from the account and an export section.

## Alternatives

- **Identity's roles.** `Program.cs` registers `IdentityRole` and the tables exist, but a role still
  needs its first member put there by some means, and on a database nobody can reach that means
  configuration anyway. Roles become worth having with a second kind of admin — a moderator, say — and
  moving to them then changes the policy's handler and no controller.
- **A Development grant, as the statistics tiers have.** Rejected for the reason above.

## Consequences

- Naming or removing an admin on a deployment is a change to the tasks' environment, and takes
  effect when they restart. For one or two admins that is the right weight.
- Nothing records who changed a curated row. With one admin that loses nothing. With several it
  would, and the answer then is an audit log of its own — not a `UserId` on reference data.
- A local checkout has no admin until its developer names their own account:
  `dotnet user-secrets set "Admin:AccountIds:0" "<account id>"`.
