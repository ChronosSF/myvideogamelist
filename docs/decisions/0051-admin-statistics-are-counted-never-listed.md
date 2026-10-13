# 0051. Admin statistics are counted, never listed

**Status:** Implemented

## Context

The owner wants to see how the site is used: how many accounts there are and how many are active, what
members put in their lists, how much they write. "Analytics" covers two different things, and this
record is about one of them.

- **Counting what members do,** from the rows the site already keeps. No third party and nothing in the
  visitor's browser, so nothing to consent to.
- **Watching how people move through the site:** page views, where visitors arrive from, signed-out
  visitors included. That needs a tracking tool. It is Google Analytics, behind the consent banner
  AdSense needs anyway (#242), and not this record.

Most of the first kind was already countable. Two things were not, because Identity records neither:
when an account was created, and when its owner was last around.

## Decision

1. **The admin page counts, from the site's own tables:**
   - accounts: how many, public profiles, and how many seen today, in seven days and in thirty;
   - the lists by status, entries kept in no list, entries an import wrote, wishlists and favourites;
   - reviews and those marked public, playthroughs and those with a time;
   - the import jobs the retention sweep still holds;
   - twelve weeks, Monday to Sunday in UTC, of sign-ups, list moves, reviews and playthroughs.

   `GET /api/admin/stats`, behind the admin policy from the class ([0042](0042-admins-are-named-in-configuration.md)),
   read-only and uncached like a member's own statistics ([0023](0023-profile-statistics-derived-at-read-time.md)).

2. **Totals only.** Nothing selects an account, a name or anything one member wrote: no list of members,
   no drill-down, no "most active". Profiles are private by default
   ([0027](0027-usernames-and-public-profiles.md)), and the admin pages touch reference data, never a
   member's (0042). A figure that needs one member's data to explain itself does not belong on the page.

3. **Two dates on the account.**
   - `CreatedAt`, stamped by `UserNameClaimService`, which every account is created through.
   - `LastSeenAt`, the first moment its owner was seen on the last day they were. It is written at most
     once a UTC day by `GET /api/auth/me`, which the client asks on every page it loads.

   A day is all the statistics read. Anything finer would be a record of somebody's every visit that
   nothing reads. Accounts from before these existed keep both null, and the page counts them as
   undated.

4. **The one write behind a `GET`.** [0033](0033-what-the-api-refuses.md) keeps state changes to the
   methods that say so, because a `GET` can be forged from another site. `LastSeenAt` is the exception,
   deliberately: a forged `GET` records only that the browser it came from was signed in, which it was.
   It is best effort. A lost race with another write to the account comes back as a failed
   `IdentityResult` and is left for the next page.

5. **Both dates are in the account's data export** ([0024](0024-the-ownership-contract.md)). They are recorded
   about the member rather than entered by them, which is the stronger reason the export owes them. The
   privacy policy (#141) names them.

## Consequences

- An account is first seen by the page it loads after this ships. One made before it has no creation
  date, so it is in no week's sign-ups.
- The twelve weeks are counted in the service from the moments themselves, which is a few thousand rows
  at this size. Group them in the database the day it is not.
- The import figures are bounded by retention ([0038](0038-where-scheduled-work-lives.md)): a closed job
  goes a week after it closes. What imports brought in stays countable from the entries' `Origin`.
- `AdminPolicyTests` finds every controller under `api/admin` by its route, so a new admin controller is
  checked for the policy without anybody remembering to list it.
