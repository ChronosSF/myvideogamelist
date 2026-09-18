# 0031. A list rename is a label, checked as a set, and seen only by its owner

**Status:** Implemented

## Context

The five statuses shipped with [0018](0018-append-only-status-event-log.md), and the data-model plan
reserved a table for renaming them: `UserListSettings (UserId, StatusId, DisplayName)`, created lazily,
with no row meaning the default name. Its decision 8 settled the principle — *renaming Finished to
"Beaten" writes a display name and nothing else notices; turning Finished into Dropped must not be
possible* — and left the table out of the first migration because nothing could rename a list yet.

Building the rename surfaced what the principle does not say.

- **What a name may be.** The defaults are at most eight characters and every place that draws one —
  a tab, a chip in the game page's sidebar, a button on a card's overlay — was laid out for that.
- **Whether two lists may share a name.** Nothing about the data forbids it. Two buttons both reading
  "Playing", one of which moves the game to Dropped, is the repurposing decision 8 forbids, done
  through the label rather than the flags.
- **Who sees a rename.** A public profile shows the same five-bar breakdown the owner's does.
- **How the names reach every label.** Four components printed `LIST_NAMES` directly.
- **What a names form does when the names never arrived.** The obvious read, the list preferences,
  already failed silently, which was right for a sort order and would be wrong for a form: an empty set
  of names looks exactly like "nothing renamed", and saving from it puts every list back to its
  default.

## Decision

### 1. The planned table, replaced as a whole

`UserListSettings`, keyed on `(UserId, StatusId)`, cascading from the account and restricted on the
status, as `UserListSortPreferences` is. One row per renamed list; a name blanked, or set back to the
default, removes its row rather than storing a copy of the default.

`PUT /api/user/list-names` takes all five lists and replaces the set, the contract the sort preferences
already use. A list left out goes back to its default.

### 2. A name is short and printable, and the five are judged together

`ListNamePolicy` normalises a name — trimmed, every run of whitespace one space — and refuses one over
24 characters, three times the longest default, or one containing a control character. Spaces,
punctuation and emoji are fine: a list name is never in a URL and is nobody else's to read.

Then the five names a user would have — renamed or default — must differ when compared without case.
The message goes to every renamed list caught in a clash, never to a default nobody typed. Uniqueness is
judged on the set being saved, so swapping two names in one save is allowed. **Nothing is written unless
all five pass**, and each refusal comes back as a `ValidationProblemDetails` entry keyed by status, beside
the box it is about.

A name that differs from its default only in case — "FINISHED" — is a rename somebody chose, not the
default typed again.

### 3. The meaning has nowhere to move

The table holds a label and nothing else: no flags, no ordering. Every statistic, the event log and the
export key on the status. The export gains a `listNames` section, keyed by status key like the sort
preferences, so a name can be applied back to the right list by anything that reads the document.

### 4. The owner's alone

A rename is shown wherever a list is *named* for its owner: the lists page's tabs and empty states, the
card overlay, the game page's panel and the breakdown on `/user`. It is not shown on a public profile,
which names the lists by their defaults:

- **A reader compares profiles.** "Where their games sit" is read against the site's own vocabulary,
  and five invented labels would make one profile unreadable beside another.
- **It would be free text on a public page.** Reviews are the one place that is allowed, deliberately
  and with a visibility the author chose; a list name was never offered on those terms.
- **The public document is assembled field by field** ([0027](0027-usernames-and-public-profiles.md) §8),
  and nobody decided to put the names in it.

Prose that describes what a list *means* keeps the canonical words — "Continue playing", "finished this
year", "in your backlog" — because it is a sentence about the status, not a label for a list.

### 5. Read with the preferences, written on its own

The names ride on `GET /api/user/list-preferences`, which `ListsProvider` already makes on every sign-in
and under which every label sits, so they cost no request of their own. They are written through their
own endpoint, not through `PUT /api/user/list-preferences`: that is sent on every sort and layout click,
and folding the names in would resend five strings each time and let a names form save sorts it was never
shown.

### 6. Every label reads `nameFor`, and the form waits for the truth

`ListsProvider` holds the names with a `namesStatus` of its own — `loading`, `ready` or `failed` — kept
apart from `loading`, because the preferences can fail while the lists succeed. `nameFor(listId)` returns
the user's name or the default, and it is what every label now reads. `LIST_NAMES` is the defaults, and
the only thing a public page uses.

The rename form on `/user` offers its boxes only when the names are `ready`, and says why when they
`failed`. It saves with a button rather than as it is typed, and nothing is applied across the site until
the server has stored it; the provider then adopts the names the server returns, normalised there. The
form follows the stored names by value rather than by reference: toggling the theme changes the account
object, which makes the provider refetch, and a reference check would wipe a half-typed name.

`NAMES_SAVED` is session-stamped like every other completion, so a save still out when the account changes
is dropped rather than written over the next account's names.

## Consequences

**The list preferences no longer fail silently.** A failed read still falls back to the defaults for every
sort and label, and still raises no error over the lists; it now records `namesStatus: 'failed'`, which only
the rename form reads.

**Checked against PostgreSQL.** Saving `"  Beaten   for good "` stored `Beaten for good`; saving the same two
names again, which removes and re-adds rows under the same keys in one save, succeeded; renaming Dropped to
`PLAYING` was refused with the stored names left as they were; and an empty save removed every row.

**A sixth status needs no migration here**, as it needs none for the sort preferences: it has no row until
somebody renames it.

**Publishing the names is a separate decision.** If a profile should ever show its owner's labels, it is a
field added to `PublicProfileDto` on purpose, with the moderation question answered first.
