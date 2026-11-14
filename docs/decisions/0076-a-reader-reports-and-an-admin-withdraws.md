# 0076. A reader reports, and an admin withdraws what was published without writing a word of it

**Status:** Implemented, as v1's minimum of [#307](https://github.com/ChronosSF/myvideogamelist/issues/307).
**Amends:** [0042](0042-admins-are-named-in-configuration.md), whose admin page edited reference data
and nothing else; [0051](0051-admin-statistics-are-counted-never-listed.md) §2, which kept every
admin page to totals; [0058](0058-a-withdrawal-leaves-the-edge-when-it-is-made.md) §1, whose table
gains a ninth event; and [0028](0028-a-games-community-view.md) §2 and
[0027](0027-usernames-and-public-profiles.md) §6, whose two gates on a review become three.

## Context

Members publish free text and pictures on public pages: reviews ([0025](0025-playthroughs-and-reviews.md),
0027, 0028), and since #119 a display name, an avatar and a bio
([0056](0056-an-avatar-is-an-address-on-a-short-list-of-hosts.md)). Nothing reported one, and nothing
removed one short of a database update, on a database with no public endpoint
([0015](0015-fargate-confirmed-and-nat-less-networking.md)).

The terms already promise more than the site could keep. They ask members not to post "anything
illegal, hateful or harassing, anything you have no right to post, or spam", nor to choose "a name or a
picture that pretends to be somebody else or that is offensive", and they say "we may remove what
breaks these rules, and suspend the account that posted it".

v1 was decided on 2026-11-02, and #147 states this part of it as *at least: an admin hides a review and
clears a name, picture or bio, and a reader can report one*. #307 left three questions open:

- how a reader reports, and where the report lands;
- what an admin may change, given that 0042 keeps the admin page to reference data, never a member's;
- what the terms promise about it.

And one fact: an avatar is the host's picture, so it can change after it was set (0056 §1). Whatever
was judged about a picture is a judgement about what the address served then.

## Decision

### 1. A reader reports a published review or a published profile, signed in, with a reason

**What can be reported is what a reader can see**, and nothing else: a review that is public, on a
public profile, and not hidden (§3); and a public profile, for what its owner wrote about themselves —
the display name, the picture and the bio, which are reported together, since the reader is asking an
admin to look at the person's own words, and the admin sees all three. Anything else is the same 404
the public reads give, so the endpoint cannot be used to ask whether a name has an account (0027 §7).

**One control, `Report`, under every published review** on a game's page and on its author's profile,
**and one on a public profile** under its header. It is in the server's HTML for every reader, so the
profile stays one document for everybody and shared-cacheable (0027 §10), and nothing on the page moves
when auth answers. After hydration it is taken off the reader's own review and own profile, which only
its owner sees move. Pressed signed out, it opens the sign-in dialog.

**Signed in, deliberately.** An account is what bounds a reader to one report per thing: the table
holds one row per reader and review, and one per reader and profile, by two filtered unique indexes.
Reporting the same thing again replaces the reason and the note and adds nothing. The site has no rate
limit on anonymous writes and is meant to have none on anything a loader reaches
([0033](0033-what-the-api-refuses.md)), so a report from nobody in particular could fill the queue as
fast as a script can post. A signed-in reader can still report every published review there is once,
which is the queue's bound.

**A reason, from the terms, and a note.** The reasons are the terms' own categories:

| Key | Shown as |
|---|---|
| `spam` | Spam |
| `abuse` | Hateful, harassing or offensive |
| `impersonation` | Pretends to be somebody else |
| `illegal` | Illegal |
| `rights` | Not theirs to post |
| `other` | Something else |

The note is optional, up to 500 characters, plain text, read by an admin and nobody else. It is there
for what a reason cannot say: "this is my name", "the spoiler is in the second line". The database
holds the reason list as a check constraint, and the control's labels are the client's.

**The answer says nothing about anybody else's reports**: the same 204 whether the thing had been
reported before or not, so a reader cannot use it to learn that somebody else complained.

### 2. A report lands in a table, `ContentReports`, and the admin page reads it

**Not an email.** SES is in its sandbox until production (#100), and an inbox would be a second home for
what members wrote about each other, outside the export, outside the cascade and outside anything the
site can delete.

**The reporter is the `UserId`**, so the table is user-owned in the sense `UserOwnedDataTests` means
([0024](0024-the-ownership-contract.md)): deleted with the reporter's account, and in the reporter's
export, as what they reported, why and when. Two more foreign keys name what is reported, exactly one
of them set, and a check constraint says so:

- `ReviewId`, to the review, cascading: a review its author deletes, or that goes with its entry or its
  account, takes its reports, since nothing is left to moderate.
- `ProfileUserId`, to the account whose profile was reported, cascading: a deleted account takes the
  reports about it.

Both are optional, so `UserOwnedDataTests`' rule for a required pointer to a parent does not reach
them; they cascade because a report about nothing is nothing an admin can act on, and the integration
suite deletes both parents to show it.

**The admin page never shows who reported.** The reporter's id is there to bound and to delete, not to
weigh a report by. Several reports of one thing are shown as one item, with each report's reason, note
and date.

**A report lives until an admin answers it**, then it is deleted: by acting on what it reports, or by
dismissing it. A report is a message to the admins, and once it is answered nothing reads it. Kept, it
would be a record of who complained about whom. So there is no resolved state and no history, and the
reporter is not told the outcome; a reader who reports a review sees it gone when it is hidden.

**Reports about a member are not in that member's export.** They are another member's words, and the
reporter's export carries them. What the member's export does carry is the result: a hidden review is
exported with the moment it was hidden (§3).

### 3. An admin withdraws publication, and never writes a member's words

**A review is hidden, not deleted.** `Reviews.HiddenAt` is the moment an admin hid it, null otherwise.
A hidden review is published nowhere: it is a third gate beside the review's own visibility and its
author's profile's, and as with the other two the narrowest wins and the gate is in the query
predicate. The counts leave it out too — "3 reviews" over two cards would announce the third. Its
author still reads it, edits it and deletes it, and the review form says an admin has hidden it from
other readers. An edit does not bring it back; an admin can, from the page's list of hidden reviews,
which is where a hide made in error is undone. It is exported with `hiddenAt`.

Hidden rather than deleted because a review is long-form work, and its author's: deleting it would be
an admin deleting a member's data, which 0042 refuses, while hiding it takes away only its
publication, which is what the terms reserve the right to "remove" from the site.

**A display name, a picture or a bio is cleared**: set to null, as the owner's own blank sets it. Nothing
else on the account changes. The owner can write another, and the form shows them the field empty.

Cleared rather than hidden, because each of the three exists only to be shown on the profile. Hidden
from everybody but its owner it would be cleared with extra steps, and a flag beside each would be
three more gates for every reader of a profile to keep. For the picture there is a second reason: the
address is the host's, so a hidden address would go on hiding whatever the host serves there next, a
judgement about a picture nobody has seen. Removing the address is the only act that means the same
thing tomorrow, and the issue's own phrasing, "moderation of one is never done for good", is the
consequence: a new address is a new picture, and can be reported.

**What an admin never does**: edit a word, delete a review, change a profile's visibility, rename an
account, or suspend one. A member who publishes again what was withdrawn is withdrawn again. Suspension
is the terms' other promise and is not v1; it is a checklist line on #307.

**An admin acts from a report.** The queue lists what readers reported and the list of what was hidden,
and nothing else: the admin sees one member's published words only when a reader has put them in front
of the admin, or the admin has already hidden them. That is how this squares with 0051's "nothing
selects an account": the page still has no list of members, no search and no drill-down, and the
moderation card selects only what somebody asked it to look at. An admin who comes across something
while reading the site reports it like anybody else.

**One action closes every report on its subject.** Hiding a review deletes its reports; clearing any
of a profile's three fields deletes the reports about that profile; dismissing deletes them and changes
nothing else.

### 4. 0042, amended

0042 said: *an admin page edits reference data and nothing else — no user's data, no accounts.* It now
says: an admin page edits reference data, and **on a reader's report withdraws what a member
published** — sets `HiddenAt` on a review, back to null to undo it, or sets a display name, an avatar or
a bio to null — and nothing else of a member's. Every one of those is something the member could have
done, or undone, themselves. The rest of 0042 stands:

- **The same policy, on the controller's class.** `ModerationAdminController` is under `api/admin`, so
  `AdminPolicyTests` finds it by its route and checks it, as it checks every admin controller.
- **No `UserId` to record who acted.** `HiddenAt` says when, never who, for 0042's reason: with one admin
  nothing is lost, and with several the answer is an audit log of its own. `ContentReports` carries a
  `UserId` because it is the reporter's data, not the admin's.
- **Deleting an answered report** is the one deletion an admin makes of a member's rows. A report is
  addressed to the admins, and answering it is what it was written for.

### 5. A hidden review, or a cleared field, leaves the edge

A public profile is shared-cached, and renders its reviews and its owner's three fields (0027 §10,
0056 §7). An admin's withdrawal is a withdrawal as much as the owner's, so 0058 §1's table gains a
ninth row, and its eighth row a second writer:

| Event | Where | Paths | Sends nothing when |
|---|---|---|---|
| Review hidden by an admin | `ModerationService.HideReviewAsync` | `/u/{name}*` | it was already hidden, or the profile is not public now |
| Profile details rewritten or cleared (0056 §8) | also `ModerationService.ClearProfileAsync` | `/u/{name}*` | every field it clears was already empty, or the profile is not public |

**Both go at once**, past the account's pace, as
[0081](0081-a-withdrawal-is-never-refused-and-one-accounts-are-paced.md) §3 asks of a moderator's
withdrawal: the account cannot repeat an admin's act, so pacing it protects nothing, and what an
admin takes down should not wait behind its owner's own loop. The owner's own clear stays paced;
the admin's is `ProfileWithdrawals.ProfileDetailsCleared`, an event of its own in the log.

**A hide is decided by nothing else it read**, as the deletes are (0058 §1). Whether the review was
public when the admin's request read it is not asked: its author can publish it between that read and
the save, a render between the two can put it at the edge, and a review has no stamp to refuse the
save on. A hide is rare, so the cost is a path where the review was private, and nothing was
published to take back. The profile is still asked about, after the commit, through
`ProfileWithdrawals.ReviewWithdrawnAsync`.

**A clear is decided by the before-state**, as the owner's own save is, and through `UserManager`, whose
concurrency stamp refuses a save whose row changed since it was read (0058 §3). A clear that loses that
race is a 409, and the admin presses the button again over what the owner saved.

Showing a hidden review again publishes, and waits out the window like a new review. The game page
holds no review text (0028 §4) and has nothing to send. The sitemap lists names, which neither act
changes.

## Consequences

- **The terms now describe what happens**: the "What you put on the site" section says that a reader can
  report a review or a profile, that an admin can hide a review and clear a name, picture or bio, and
  that the review stays its author's. The privacy policy (#141) can name `ContentReports` for what it
  is: what a member reported, kept until an admin answers it.
- **A determined member can republish.** Deleting a hidden review and writing it again makes a new,
  unhidden one, and a cleared bio can be typed back. Each is withdrawn again from the next report.
  Suspension, the terms' answer to that, is not v1.
- **An open report has no expiry.** With one admin answering them that costs nothing; a queue nobody
  answers would keep reporters' ids for ever, and a retention window, as the import has (0038), is the
  answer then.
- **The admin sees review ids and account ids.** 0028 §7 keeps a review's id off every public response,
  because it counts every review ever written. The admin's statistics count them anyway (0051), and the
  ids are what keep an action on the right row when a name changes between the report and the act.
- **A review hidden while its author's profile is private** sends nothing and needs nothing: it was
  published nowhere, and stays unpublished if the profile is made public later.
- **Not tested here:** that an invalidation reaches the edge, which only a deploy shows (0058). The
  cascades from a review and from an account, the filtered unique indexes and the check constraints are
  run against PostgreSQL by the integration suite; the gates, the grouping and the edge calls are unit
  tests.
