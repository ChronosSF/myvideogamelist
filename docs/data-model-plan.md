# Data model plan

The tables the product still needs, organised by what has to be persisted, and the two
constraints every table answers to. The tables that exist are the EF model —
`ApplicationDbContext` is the truth, and the records in `docs/decisions/` say why each has the
shape it has. What is still to be built is tracked as GitHub issues; this document is the schema
those issues imply, cross-cut by table, so that a column is not discovered missing after it is
expensive.

## Why a table gets missed

Two failure modes, and only one of them is about forgetting a column.

**Data that cannot be backfilled.** Most schema gaps are recoverable: add a column, ship a
migration, users fill it in. History is not — a status change applied as an in-place `UPDATE` is
never written anywhere, and no later migration can recover it. That is why `UserGameEvents` went
first ([0018](decisions/0018-append-only-status-event-log.md)), and it is the test to apply to any
table below: *if this arrives a year late, is anything lost?* A timestamp on a new relation passes
it cheaply, which is why the wishlist and favourites write no events
([0022](decisions/0022-entry-surrogate-key-and-the-wishlist-axis.md)).

**Cross-cutting constraints.** Account deletion and data export are obligations on *every*
user-owned table, including the ones added a year from now. `UserOwnedDataTests` makes the
omission fail the build rather than a compliance review: an entity carrying a `UserId` must
cascade from `AspNetUsers` on that column and be registered in `UserDataExporter.Manifest`, in
both directions ([0024](decisions/0024-the-ownership-contract.md)); a child of another user-owned
table carries its own `UserId` and reaches its parent through a composite key
([0025](decisions/0025-playthroughs-and-reviews.md)). Every table below that holds a user's data is
subject to both.

## The five statuses

Seeded, system-owned, and the source of every statistic. A game is in exactly one of them; the
flags exist so that no query hardcodes a list of keys
([0018](decisions/0018-append-only-status-event-log.md)).

| Key | Default name | Order | Started | Terminal | Completion |
|---|---|---|---|---|---|
| `backlog` | Backlog | 1 | — | — | — |
| `playing` | Playing | 2 | ✓ | — | — |
| `on_hold` | On Hold | 3 | ✓ | — | — |
| `finished` | Finished | 4 | ✓ | ✓ | ✓ |
| `dropped` | Dropped | 5 | ✓ | ✓ | — |

A sixth status is two lookup rows and no migration of user data: the flags carry it into every
aggregate, the per-list preference tables are created lazily per status
([0020](decisions/0020-list-view-preferences-in-the-database.md),
[0031](decisions/0031-a-list-rename-is-a-label-its-owner-sees.md)), and a rename changes a label
and never what a list means.

## Tables still to build

None of these changes an existing shape — the surrogate key
([0022](decisions/0022-entry-surrogate-key-and-the-wishlist-axis.md)) was the last structural
change — so each can follow its own feature. The last column is the issue that builds it.

### Account and identity

| Table / change | Notes | Issue |
|---|---|---|
| `ApplicationUser` + `DisplayName`, `AvatarUrl`, `Bio` | Additive. `CreatedAt` is deliberately not added: the public profile says "tracking games here since" from the event log's first entry, because backfilling a join date for accounts that predate the column would be inventing a fact ([0027](decisions/0027-usernames-and-public-profiles.md)) | #119 |
| `ApplicationUser` + `Region`, `Currency` | ITAD is region-aware and a EUR user must not be shown USD prices | #132 |
| `ExternalAccountLinks` | `(UserId, Provider, ExternalId)`. Identity's `AspNetUserLogins` covers OAuth sign-in, but a SteamID64 held for *import* is not a login credential and does not belong there | #124 |
| A `friends` value on `ProfileVisibility` and `Review.Visibility` | One additive migration in each of two columns; the "narrower wins" rule in [0027](decisions/0027-usernames-and-public-profiles.md) already says how they combine | #120 |
| A username history table | Tombstones on released names, so a rename cannot hand somebody's inbound links to a stranger. A bigger commitment than the rename cooldown that makes its absence survivable ([0027](decisions/0027-usernames-and-public-profiles.md)) | #146 |

### The tracker

| Table / change | Notes | Issue |
|---|---|---|
| `UserGameEntries` + a position | A manual backlog order. Sparse, per status, re-sequenced on the client; nothing statistical reads it, and sorting otherwise stays client-side ([0020](decisions/0020-list-view-preferences-in-the-database.md)) | #116 |
| `Tags` + `UserGameEntryTags` | User-scoped tags, not a global vocabulary | #135 |

### Community

`Reviews` is a tracker table — writing one is part of tracking a game. What belongs here is
everything built *on top of* other people's reviews and lists.

| Table | Notes | Issue |
|---|---|---|
| `ReviewVotes` | `(UserId, ReviewId, IsHelpful)`. The game-page review list ships without it, most recent first ([0028](decisions/0028-a-games-community-view.md)) | #121 |
| `UserFollows` | `(FollowerId, FolloweeId, CreatedAt)`. The activity feed needs no table of its own — it is `UserGameEvents` joined to this. It has to read `Origin`: an imported status has no event behind it ([0026](decisions/0026-a-library-import-records-ownership-not-history.md), [0037](decisions/0037-a-tracker-import-carries-history.md)) | #120 |
| `CustomLists` | `(Id, UserId, Name, Slug, Description, Visibility, IsRanked, CreatedAt)`. The free tier caps at three, enforced against this table ([0010](decisions/0010-monetization-model.md)) | #134 |
| `CustomListItems` | `(CustomListId, GameId, Position, Note, AddedAt)`. `AddedAt` is what lets the feed show list additions without a second event log — see below | #134 |
| `CustomListLikes` | `(UserId, CustomListId)` | #134 |

**Custom lists are a different relation from the five statuses, not a sixth one.** They differ in
shape, not just in policy:

| | The five statuses | Custom lists |
|---|---|---|
| Cardinality | Exactly **one** per game | **Many** per game |
| Meaning | Progress | Curation |
| Transition | `backlog → playing` has two endpoints | Being added to a list has no *from* |
| Statistics | The canonical source | Not meaningfully aggregatable |

Forcing both into one table means nullable columns on every row and a discriminator every
statistical query has to filter on, so `UserGameEvents` stays typed and narrow
([0018](decisions/0018-append-only-status-event-log.md)). The feed unions
`CustomListItems.AddedAt` with the events at query time; a denormalised feed table, if one is
ever needed, is then a performance change made with full history in hand.

### Notifications and prices

| Table | Notes | Issue |
|---|---|---|
| `Notifications` | `(Id, UserId, Type, Payload jsonb, ReadAt, CreatedAt)` | #122 |
| `NotificationPreferences` | Per type, per channel. A table rather than columns on the user, because the type list grows | #122 |
| `PriceAlerts` | `(UserId, GameId, ThresholdCents, Currency, IsActive, LastNotifiedPriceCents)`. The last column makes alerting idempotent without storing price history. The free tier caps at five | #132 |
| `PriceHistory` | Only if the paid history charts need more than ITAD returns on demand. ITAD serves history itself, so **defer this** and re-fetch rather than mirror their database | #131 |
| `EmailDeliveries` | Dedupe and retry for release and price emails. Needed as soon as an email sender exists | #100 |

### Billing

| Table | Notes | Issue |
|---|---|---|
| `Subscriptions` | `(UserId, StripeCustomerId, StripeSubscriptionId, Status, Tier, CurrentPeriodEnd, CancelAtPeriodEnd, GraceUntil)`. Entitlement is read from here, never inferred from Stripe per request ([0010](decisions/0010-monetization-model.md)); the statistics tiers (#149, `specs/profile-statistics-tiers.md`) are its first consumer, on a configuration-backed stand-in until it exists | #142 |
| `StripeWebhookEvents` | Processed event ids, for idempotency. Stripe **redelivers** webhooks; without this a retry double-applies a lifecycle event. Not user-owned | #142 |
| `FeatureFlags` | So free-tier limits are tunable without a deploy. Not user-owned | #142 |

`ImportJobs` was on this list as the record of whether a free user has spent their one-time
import. It shipped as `ImportJob` with the tracker import
([0037](decisions/0037-a-tracker-import-carries-history.md)); the entitlement question is
`specs/csv-list-import.md` §8.

## Deliberately not in the database

Recorded so nobody "completes" the schema by adding them:

- **Steam news and the trending rail** — derived, regenerable, TTL'd. `IMemoryCache`, moving
  to Redis ([0012](decisions/0012-steam-news-without-a-database.md)).
- **The IGDB access token** — cache only.
- **Current prices** — cache. Only alert thresholds and last-notified prices are durable.
- **Data Protection keys** — outside the application's tables
  ([0007](decisions/0007-aws-target-architecture.md)); exactly where is a deployment decision.

The IGDB→Steam AppID map is the ambiguous one: regenerable, so 0012 keeps it in cache — but
since `CachedGames` exists ([0035](decisions/0035-a-local-copy-of-what-igdb-said.md)) it is also
just another IGDB-sourced field of a cached game. Both records leave it parked; it is
#145.
