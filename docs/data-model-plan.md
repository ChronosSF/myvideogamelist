# Data model plan

How the database grows from three tables to the schema the roadmap implies, and — more to the
point — how to avoid discovering a missing column after it is expensive.

`ROADMAP.md` is organised by **feature**. This document is the same roadmap organised by **what
has to be persisted**, because the two views miss different things. Read it alongside
`docs/decisions/` for the reasoning behind what is deliberately *not* in the database.

## Where we start

| Table | Shape | Serves |
|---|---|---|
| `AspNet*` | ASP.NET Identity, unmodified | Auth |
| `ApplicationUser` | Identity plus `Theme` and `ListView` columns | Presentation preferences |
| `UserGameEntries` | PK `(UserId, GameId)`, nullable `StatusId` FK, `Score`, `AddedAt`, `StatusChangedAt` | The user's record of a game |
| `ListStatuses` | Seeded lookup, five rows, semantic flags | The taxonomy |
| `UserGameEvents` | Append-only status transitions | Activity, streaks, trends |
| `UserHiddenPlatforms` | PK `(UserId, IgdbPlatformId)` | Platform filter |

Three migrations exist, the latest being `20260826084035_AddScoreAndEntryTimestamps`. There is no production deployment and no
user data to preserve, which means **breaking shape changes are currently free**. Every
structural decision below gets harder the day real accounts exist, so the ones marked
*structural* are worth making now even if the feature that needs them is phases away.

## Why things get missed

Two failure modes, and only one of them is about forgetting a column.

**Data that cannot be backfilled.** Most schema gaps are recoverable: add a column, ship a
migration, users fill it in. History is not. If a status change is applied as an in-place
`UPDATE`, the fact that it happened is never written anywhere, and no future migration can recover
it. `ListService` used to do exactly that, so "finished 12 games in 2026" was unanswerable for
every month before `UserGameEvents` shipped — which is why it went first, and why the window on it
had already partly closed. Being late in this category costs data rather than effort.

The log then paid for itself immediately in an unplanned way: when `AddedAt` and `StatusChangedAt`
were added to the entry table, both could be **backfilled from the events** rather than invented.
Nothing else in this document has that property.

**Cross-cutting constraints.** Tier 1 requires self-service account deletion with data export.
That is not a feature of one table; it is an obligation on *every* user-owned table, forever,
including the ones added a year from now. Miss one and it surfaces as a compliance defect at the
worst possible moment. The fix is mechanical rather than diligent — see **Guarding it** below.

## The inventory

Grouped by concern, with the roadmap item each row serves. **Structural** marks the ones that
change existing shapes rather than adding to them.

### Account and identity

| Table / change | Notes | Roadmap |
|---|---|---|
| `ApplicationUser` + `Username` | **Structural.** A real public handle, unique, separate from the email Identity currently puts in `UserName`. Needs a reserved-name list (`admin`, `api`, `settings`) or `/u/{username}` will collide with routes | Tier 1 public profiles |
| `ApplicationUser` + profile columns | `DisplayName`, `AvatarUrl`, `Bio`, `CreatedAt`, `ProfileVisibility` (public / friends / private) | Tier 1 |
| `ApplicationUser` + locale columns | `Region`, `Currency` — ITAD is region-aware and a EUR user must not be shown USD prices | ITAD P6 |
| `ExternalAccountLinks` | `(UserId, Provider, ExternalId)`. Identity's `AspNetUserLogins` covers OAuth sign-in, but a SteamID64 held for *import* is not a login credential and does not belong there | Tier 2 import, Tier 1 social login |

### The five statuses

Predefined at P0, system-owned, and the source of every interesting statistic. A game is in
**exactly one** of them. The flags exist so that no query has to hardcode a list of keys — add a
sixth status later and the aggregates keep working.

| Key | Default name | Order | Started | Terminal | Completion |
|---|---|---|---|---|---|
| `backlog` | Backlog | 1 | — | — | — |
| `playing` | Playing | 2 | ✓ | — | — |
| `on_hold` | On Hold | 3 | ✓ | — | — |
| `finished` | Finished | 4 | ✓ | ✓ | ✓ |
| `dropped` | Dropped | 5 | ✓ | ✓ | — |

`IsStarted` separates games that have been touched from ones merely intended. `IsTerminal` marks
a game as resolved either way, which is the denominator of a completion rate. `CountsAsCompletion`
is the numerator, and is a flag rather than `Key = 'finished'` so that a later "Mastered" or
"100%" status joins the count without editing every query.

Ordering is lifecycle, not alphabetical, because the list reads as a pipeline in the UI.

**Two consequences worth knowing:**

*No data migration.* Keeping `backlog` and `finished` as keys — rather than the roadmap's earlier
"Plan to Play" and "Completed" — means the three existing values survive untouched and the two
new statuses are additive lookup rows. The ambiguous `backlog` split that this document previously
flagged as a decision is now moot. `ROADMAP.md` should be amended to match these five names.

*On Hold breaks naive duration.* See decision 6.

### The tracker — the heart of it

| Table / change | Notes | Roadmap |
|---|---|---|
| `UserGameEvents` | **Ship first.** Append-only: `(Id, UserId, GameId, FromStatusId, ToStatusId, OccurredAt)`. Both status ids are nullable FKs — null *from* means the game was not tracked before, null *to* means it was removed. **No FK to the entry**, because removals are events and the log has to outlive the row it describes. **Status transitions only** — no custom-list column and no event-type discriminator, see decision 7. Indexes on `(UserId, OccurredAt)`, `(GameId, OccurredAt)`, `(ToStatusId, OccurredAt)` | Tier 1 activity history, H6, Tier 3 feed and wrapped |
| `UserGameEntries` | **Partly shipped** — the rename, a nullable `StatusId`, `Score`, `AddedAt` and `StatusChangedAt` are in (ADR [0019](decisions/0019-entry-survives-leaving-every-list.md)). Still open: the surrogate `Id`, `Ownership`, `Notes`. Deliberately holds **no playtime or platform** — those belong to a playthrough | Tier 1 per-entry tracking |
| `UserGamePlaythroughs` | `(Id, UserGameEntryId, TypeId, PlatformId, MinutesPlayed, StartedOn, FinishedOn, Notes, CreatedAt)`. One row per time through the game, so a replay on a different platform is a second row rather than an overwrite. This is where playtime, platform and dates live | Tier 1 per-entry tracking, completion states, profile stats |
| `PlaythroughTypes` | Lookup: Rushed, Normally, Completionist — **the same three tiers IGDB reports**, so MVGL averages bucket into the same shape and the two sources sit side by side on the game page | Tier 1 completion states |
| `ListStatuses` | **Ship with the event log.** System-owned lookup, seeded with all five at P0 and never deleted from. Carries semantic flags, not just names — see [the five statuses](#the-five-statuses). Replaces the hardcoded `ValidListTypes` set in `ListService` | Tier 1 taxonomy |
| `UserListSettings` | `(UserId, StatusId, DisplayName)`. Lazily created: no row means "use `DefaultName`". This is what makes the defaults renameable without any statistic having to care, because everything else keys on `StatusId` | Tier 1 taxonomy |
| `UserListSortPreferences` | **Shipped.** `(UserId, StatusId, SortKey, Descending)`, one row per list the user has actually re-sorted. The same lazily-created shape `UserListSettings` will use, and the reason a sixth status needs no migration (ADR [0020](decisions/0020-list-view-preferences-in-the-database.md)) | Tier 2 list views |
| `UserWishlist` | **Structural consequence.** A separate axis, not a status — the roadmap requires a game to sit in the wishlist *alongside* any list, which today's `(UserId, GameId)` primary key forbids outright | Tier 1, H4, ITAD P5/P7 |
| `Reviews` | `(Id, UserGameEntryId, Body, HasSpoilers, Visibility, PlaythroughId?, CreatedAt, UpdatedAt)`. One per user per game, hung off the entry rather than the playthrough, with an optional pointer to the playthrough it is about. The **score is not here** — it lives on the entry, because a score with no prose is the common case and must not require a review row | Tier 1 per-entry, Tier 2 community signal |
| `UserFavourites` | `(UserId, GameId)`. A separate table because a favourite is explicitly independent of list membership, so it must be expressible with no entry at all | Tier 1 favourites |
| `Tags` + `UserGameEntryTags` | User-scoped tags, not a global vocabulary | Tier 3 |

### Local IGDB metadata cache

| Table | Notes | Roadmap |
|---|---|---|
| `CachedGames` | PK is the **IGDB id**. Recommended shape: a `jsonb` payload holding the mapped `GameDto`, plus extracted columns (`Name`, `FirstReleaseDate`, `CoverImageUrl`, `TotalRating`, `RefreshedAt`) for the queries that need to sort and filter. See decision 2 below | §5 data & state, structural issue #2 |

### Community

`Reviews` itself is in the tracker group above — writing one is part of tracking a game, not a
separate community act. What belongs here is everything built *on top* of other people's reviews.

| Table | Notes | Roadmap |
|---|---|---|
| `ReviewVotes` | `(UserId, ReviewId, IsHelpful)` | Tier 2 helpful-votes |
| `UserFollows` | `(FollowerId, FolloweeId, CreatedAt)` | Tier 3 |
| `CustomLists` | `(Id, UserId, Name, Slug, Description, Visibility, IsRanked, CreatedAt)`. The free tier caps at 3, so the count is enforced against this table | Tier 3, §4.2 |
| `CustomListItems` | `(CustomListId, GameId, Position, Note, AddedAt)`. That timestamp is what lets the activity feed show custom-list additions without a parallel event log — see decision 7 | Tier 3 |
| `CustomListLikes` | `(UserId, CustomListId)` | Tier 3 |

The activity feed needs **no table of its own** — it is `UserGameEvents` joined to `UserFollows`.
That is the event log paying for itself a second time.

### Notifications and prices

| Table | Notes | Roadmap |
|---|---|---|
| `Notifications` | `(Id, UserId, Type, Payload jsonb, ReadAt, CreatedAt)` | Tier 2 release notifications, ITAD P5/P8 |
| `NotificationPreferences` | Per type, per channel. A table rather than columns on the user, because the type list grows | Tier 2, §4.2 |
| `PriceAlerts` | `(UserId, GameId, ThresholdCents, Currency, IsActive, LastNotifiedPriceCents)`. That last column is what makes alerting idempotent without storing full price history. The free tier caps at 5 | ITAD P5/P6 |
| `PriceHistory` | Only if the paid history charts need more than ITAD returns on demand. ITAD serves history itself, so **defer this** and re-fetch rather than mirroring their database | ITAD P4, §4.2 |
| `EmailDeliveries` | Dedupe and retry for release and price emails. Needed as soon as an email sender exists, which account lifecycle blocks on anyway | Tier 1, Tier 2 |

### Billing

| Table | Notes | Roadmap |
|---|---|---|
| `Subscriptions` | `(UserId, StripeCustomerId, StripeSubscriptionId, Status, Tier, CurrentPeriodEnd, CancelAtPeriodEnd, GraceUntil)`. Entitlement is read from here, never inferred from Stripe per request | M2 |
| `StripeWebhookEvents` | Processed event ids, for idempotency. Stripe **redelivers** webhooks; without this a retry double-applies. M2 does not spell this out and it is the classic way this goes wrong | M2 |
| `FeatureFlags` | So free-tier limits are tunable without a deploy | M7 |
| `ImportJobs` | `(Id, UserId, Source, Status, StartedAt, CompletedAt, Stats jsonb, Error)`. Also the record of whether a free user has spent their one-time import | §4.2, Tier 2 |

### Deliberately not in the database

Recorded here so nobody "completes" the schema by adding them:

- **Steam news and the trending rail** — derived, regenerable, TTL'd. `IMemoryCache`, moving to
  Redis. ADR [0012](decisions/0012-steam-news-without-a-database.md).
- **The IGDB access token** — cache only.
- **Current prices** — cache. Only alert thresholds and last-notified prices are durable.
- **Data Protection keys** — S3 or DynamoDB with KMS, per §5. Not a table.

The IGDB→Steam AppID map is the ambiguous one. It is regenerable, so ADR 0012 keeps it in cache
today — but once `CachedGames` exists the AppID is just another IGDB-sourced field of a cached
game, and storing it there is consistent rather than a violation. Decide it explicitly when the
cache table lands.

## Decisions worth making before the migrations

**1. Fix all five status keys at P0, and keep the ones that already exist.** `backlog`, `playing`,
`on_hold`, `finished`, `dropped`. Naming them this way rather than the roadmap's earlier "Plan to
Play" and "Completed" is what turns the taxonomy expansion from a data migration into two
additive lookup rows — the three values in the database today survive untouched, and no existing
row has to be reassigned to a meaning the user never chose. Keys are permanent once written into
the event log, so this is the moment to be sure of them. Amend `ROADMAP.md` to match.

**2. `CachedGames` should be `jsonb`, not a normalised catalogue.** The last normalised catalogue
is what issue #1 in the roadmap is about: nine tables whose `Platform` ids collided with IGDB's
(local 6 = Switch, IGDB 6 = PC). One row per IGDB id with the mapped DTO as `jsonb`, plus a
handful of extracted columns for sorting and filtering, cannot collide with anything, needs no
migration when IGDB adds a field, and is a shape PostgreSQL indexes well. The purpose is
rendering lists when IGDB is unreachable, not re-implementing IGDB.

**3. Give `UserGameEntries` a surrogate key.** This stops being a nicety the moment playthroughs
exist. Playthroughs, reviews and tags all hang off an entry, and with the composite
`(UserId, GameId)` every one of them carries both columns in its own key and in every join. A
surrogate `Id` with a unique index on `(UserId, GameId)` keeps the same constraint and makes the
children clean.

**4. Playthrough types mirror IGDB's tiers exactly, and their averages carry counts.** Rushed /
Normally / Completionist are deliberately the same three buckets as IGDB's `hastily` / `normally`
/ `completely`. That is what lets the game page show "IGDB: 45h / 119h / 174h" against
"MVGL members: 51h / 130h / —" as two readable rows from two sources rather than one blended
figure of unclear provenance. Two rules follow:

- Every MVGL average is subject to ADR [0016](decisions/0016-scores-carry-their-sample-size.md) —
  no bucket is shown without the number of playthroughs behind it. An average over two members
  is exactly as uninformative as an IGDB critic score from one review.
- Use the **median**, not the mean. Self-reported playtime has a long idle-hours tail, and one
  person who left the game running over a weekend should not move the number.

**5. Events and playthroughs are not the same log, and both are needed.** An event records a
status *transition* and is append-only and immutable — that is what makes streaks, the activity
feed and "finished 12 games in 2026" answerable, and what cannot be backfilled. A playthrough is
a user-editable record of *playing* the game, and it is what completion counts, playtime averages
and most-played-platform are computed from. They diverge in a real case: replaying a game already
marked Completed adds a playthrough without any status transition at all.

**6. On Hold makes naive playthrough duration wrong, and the event log is what fixes it.** The
tempting calculation for "how long does this take in calendar time" is
`finished.OccurredAt − first playing.OccurredAt`. Add On Hold and that breaks badly: somebody who
plays for two weeks, shelves the game for eight months, then comes back for three days reads as a
nine-month playthrough.

The correct figure is the sum of the intervals during which the status was actually `playing` —
order a game's events by `OccurredAt` and add up `next.OccurredAt − current.OccurredAt` for every
event whose `ToStatusId` is `playing`. That is computable *only* because the log records the
intermediate transitions, which is the clearest argument for recording every one of them rather
than just the terminal state. Call the resulting metric active time, not elapsed time.

**7. The event log records status transitions only, and custom lists are a different relation.**
The five statuses and custom lists differ in shape, not just in policy:

| | The five statuses | Custom lists |
|---|---|---|
| Cardinality | Exactly **one** per game | **Many** per game |
| Meaning | Progress | Curation |
| Transition | `backlog → playing` has two endpoints | Being added to a list has no *from* |
| Statistics | The canonical source | Not meaningfully aggregatable |

Forcing both into one table means nullable columns on every row and a discriminator that every
statistical query has to filter on. So `UserGameEvents` stays typed and narrow.

The activity feed still shows custom-list additions — it reads `CustomListItems.AddedAt` and
unions it with status events at query time. That is safe to defer by this document's own test:
the timestamp captures the data the moment the table exists, so nothing is ever lost. A
denormalised feed table, if the feed ever needs one, is then a performance change made with full
history in hand. The wishlist axis gets the same treatment — a timestamp column, not events.

**8. Renaming a default list is cosmetic, and repurposing it must not be possible.** Renaming
Finished to "Beaten" writes to `UserListSettings.DisplayName` and nothing else in the system
notices, because every statistic keys on `StatusId`. Letting somebody turn Finished *into*
Dropped, on the other hand, would silently corrupt every aggregate they appear in with no way to
detect it afterwards. Rename changes the label; it never changes what the list means.

## Sequencing

Order by what is irrecoverable, then by what unblocks the most.

1. ~~**`ListStatuses` seeded with all five, the `ListType` string migrated to that foreign key, and
   `UserGameEvents` written from `SetListEntryAsync` and `RemoveListEntryAsync`.**~~ **Shipped** —
   see ADR [0018](decisions/0018-append-only-status-event-log.md). `UserListSettings` was left out
   deliberately: it is additive, nothing is lost by waiting, and it only matters once there is a
   settings UI to rename from. The event log is
   the only item whose lateness costs data rather than effort, and the lookup rides along because
   the string-to-key change is trivial today and tedious later. Guard the writes so a move to the
   status a game already holds records nothing — the optimistic-update UI will send those, and
   unguarded they inflate every count computed later.

   This step also forces `ListsDto` to change shape. It currently has one property per status
   (`Playing`, `Backlog`, `Finished`), mirrored by three hardcoded keys in four places in
   `ListsProvider.tsx`. Five statuses make that untenable and custom lists would anyway, so it
   becomes a collection keyed by status — a bigger client change than the server one, and the
   reason this step is not quite a one-file job.
2. **`UserGameEntries` and the wishlist axis.** Changes the one table that already exists, and H6,
   profile stats, community scores and the paid stats charts all block on it. Do it while there is
   no data to migrate.
3. **`UserGamePlaythroughs`, `PlaythroughTypes` and `Reviews`.** The three things a user actually
   enters about a game they have played, and the reason the entry table needs a surrogate key.
   Worth doing directly after step 2 rather than later, because the alternative is putting
   playtime and platform on the entry first and moving them afterwards.
4. **The ownership contract** — cascade behaviour and the export enumeration, plus the guard
   below. Cheap now, and it is what stops the list going stale.
5. **`CachedGames`**, before public profiles and any SEO-bearing page, because those have to
   render without a live IGDB call.
6. **Everything else is additive** and can follow its own feature.

## Guarding it

The way not to miss a table is not to be careful — it is to make the omission fail a build.

Every table above except `CachedGames`, `ListStatuses`, `PlaythroughTypes`, `FeatureFlags` and
`StripeWebhookEvents`
is user-owned, and each one has to be covered by both account deletion and data export. A test
that walks the EF Core model, selects every entity type carrying a `UserId`, and asserts each is
handled by the deletion path and named in the export manifest will fail the moment somebody adds
a user-owned table and forgets — which is the only reliable moment to find out.

Worth writing that test with the *second* such table, not the twentieth.
