# 0020. List view preferences live in the database, and sorting happens on the client

**Status:** Implemented

## Context

The lists page needed a condensed table view alongside the existing tiles, a choice of sort order,
and a platform filter. Two of those three should be remembered between visits; the third should
not.

`localStorage` was the obvious place to remember them and the wrong one. A preference in
`localStorage` belongs to a browser rather than to a person: it is lost when site data is cleared
and it does not follow anyone to a second device. For a tracker people open on a desktop and a
phone, a remembered setting that only works in one place reads as broken.

The codebase already had the answer twice over — `ApplicationUser.Theme` is a column, and
`UserHiddenPlatforms` is a per-user table — so this is consistency rather than novelty.

## Decision

**Preferences are persisted server-side, in whichever of those two shapes fits.**

| Preference | Where | Why |
|---|---|---|
| View mode (tiles / table) | `ApplicationUser.ListView` column | One global scalar, exactly like `Theme` |
| Sort order | `UserListSortPreferences`, one row per (user, status) | Differs per list, and a missing row already means "default" |
| Platform filter | Nowhere | Deliberately transient — see below |

**Sort is per status list, not global.** Finished wants ordering by score while Playing wants
newest-first, and forcing one order on both would make the feature half-useful. A row per
(user, status) means adding a sixth status needs no migration: absence is the default.

**Only changed lists have rows.** A user who has never touched a sort has no rows at all, and the
client supplies the default — newest first. The API returns only what was actually set rather than
padding out five entries.

**The platform filter is not persisted.** It is a momentary question ("what have I got on Switch")
rather than a standing preference, and a filter silently still applied on the next visit is how
people conclude their games have vanished. It also has to stay visibly distinct from
`UserHiddenPlatforms`, which *is* a saved global preference for browsing — two platform controls
that look alike and behave differently would be worse than either alone, so the filter panel says
in words that it applies to this view only.

**Sorting and filtering run on the client.** A user's lists are already fetched whole — there is no
pagination — so sorting server-side would mean a round trip to reorder an array that is already in
memory. The server stores the preference and does not act on it. If lists ever paginate, sorting
has to move server-side, and this is the decision to revisit.

**The preference fetch does not block the lists.** `/api/user/list-preferences` is requested
alongside `/api/lists` rather than before it, and a failure falls back to the defaults. Presentation
settings are not worth an error state over someone's actual data. It is also deliberately kept out
of the profile endpoint, which runs on every page load and has no use for them.

**Two rules in the comparators**, both easy to get wrong and both load-bearing:

- **Entries with no value sort last in both directions.** Flipping to ascending must not promote
  every unscored game to the top; "no score" is not a low score.
- **Title is the final tie-break for every key**, so a list sorted by score does not reshuffle its
  equal-scoring games depending on what order the API happened to return them in.

## Consequences

Every sort or layout change is a write. They are small and idempotent, and the request is
fire-and-forget: a preference that fails to save leaves the UI on the new setting and reconciles on
the next load, because interrupting someone to tell them their sort order did not persist is worse
than the lost setting.

**The sort keys are now API contract.** They are stored as strings, so renaming one silently
invalidates every stored preference using it. `[AllowedValues]` on the DTO constrains writes to the
known set, and the constants live in `ListSortKeys` so the server and the client cannot drift apart
without a compile error on one side.

Because sorting is client-side, **the sort options are limited to fields the client already has**.
That is what made "date added" require the two timestamp columns from
[0019](0019-entry-survives-leaving-every-list.md) rather than a query: the client cannot sort by
something the payload does not carry.

The comparators have no automated tests, because there is still no client test runner — Vitest
remains an open roadmap item. They were verified by driving the live UI through every sort option
and reading back the rendered order, which is a check rather than a regression test. They are pure
functions in `@/lib/listSort` specifically so that tests can be added later without rework.
