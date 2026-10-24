# Architecture decision records

Short records of decisions that shaped this codebase, and the reasoning behind them.

The plan is the repository's GitHub issues ([0041](0041-what-the-roadmap-decided-on-its-own.md));
`ROADMAP.md` maps the old plan's identifiers to them. These records are the *why*, and they
outlive both. Read the relevant one before changing anything it covers.

## Writing one

Copy the shape of an existing record: **Context** (what forced a choice), **Decision**
(what we picked), **Consequences** (what it costs and what it rules out). Keep it short.

Add one when you make a call that future work would otherwise have to reverse-engineer,
especially when you rejected a plausible alternative. Records are append-only: to change a
decision, write a new record and mark the old one superseded. A record's **Status** line may
grow a forward pointer when a later record or an issue closes something it left open.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-igdb-as-source-of-truth.md) | IGDB is the source of truth for game data | Implemented; the cache it called for is 0035 |
| [0002](0002-server-side-rendering.md) | Server-side rendering via React Router framework mode | Implemented |
| [0003](0003-two-process-deployment.md) | Two processes; the SSR server does not proxy `/api` | Implemented; the built app is run end to end, behind a stand-in for what routes between the two, by the browser smoke test, 0060 |
| [0004](0004-release-dates-for-calendar.md) | Upcoming releases are built on `release_dates` | Implemented; its endpoint retired by #165, its reasoning carried by `/api/user/releases` |
| [0005](0005-secrets-handling.md) | Secrets come from user secrets and environment variables | Implemented |
| [0006](0006-codeql-buildless.md) | CodeQL runs buildless (`build-mode: none`) | Implemented |
| [0007](0007-aws-target-architecture.md) | ECS Fargate, Aurora Serverless v2, CloudFront | Partly superseded by 0014, 0015 |
| [0008](0008-postgresql-over-sqlite.md) | PostgreSQL replaces SQLite before deployment | Implemented locally; hosting pending; its integration tests are 0057 |
| [0009](0009-itad-without-affiliate-revenue.md) | Integrate IsThereAnyDeal and forgo the affiliate revenue | Accepted |
| [0010](0010-monetization-model.md) | Ad-supported free tier plus a paid subscription | Accepted; the free/paid line is drawn in it, the statistics tiers in `specs/profile-statistics-tiers.md` |
| [0011](0011-react-router-8-upgrade.md) | Upgrade to React Router 8 | Implemented |
| [0012](0012-steam-news-without-a-database.md) | Steam news is cached in memory, not stored in the database | Implemented; N3 is 0052, the AppID question an open issue |
| [0013](0013-http-caching-policy.md) | Every route declares its own `Cache-Control` | Implemented; a `.data` gap closed by 0070 |
| [0014](0014-rds-postgresql-over-aurora.md) | Managed PostgreSQL on RDS, not Aurora Serverless v2 | Accepted |
| [0015](0015-fargate-confirmed-and-nat-less-networking.md) | ECS Fargate confirmed, with NAT-less networking | Accepted |
| [0016](0016-scores-carry-their-sample-size.md) | A score is never shown without its sample size | Implemented |
| [0017](0017-detail-data-off-the-listing.md) | Detail-only game data stays out of the listing payload | Implemented |
| [0018](0018-append-only-status-event-log.md) | Status changes are recorded in an append-only event log | Amended by 0019 |
| [0019](0019-entry-survives-leaving-every-list.md) | A user's entry survives the game leaving every list | Implemented |
| [0020](0020-list-view-preferences-in-the-database.md) | List view preferences live in the database; sorting is client-side | Implemented; the tie-break amended for the hand order by 0054 |
| [0021](0021-one-control-for-a-score.md) | Stars are the user's own score; every aggregate is a number out of 100 | Implemented |
| [0022](0022-entry-surrogate-key-and-the-wishlist-axis.md) | The entry gets a surrogate key, and the wishlist is an axis rather than a status | Implemented |
| [0023](0023-profile-statistics-derived-at-read-time.md) | Profile statistics are derived at read time, and split by what they depend on | Implemented; §4's chart amended by 0047 |
| [0024](0024-the-ownership-contract.md) | One export manifest for every user-owned table, guarded in both directions | Implemented; one snapshot since #95; its cascades and its snapshot tested against PostgreSQL by 0057 |
| [0025](0025-playthroughs-and-reviews.md) | Playthroughs and reviews: what a user records about actually playing a game | Implemented |
| [0026](0026-a-library-import-records-ownership-not-history.md) | A library import records ownership, not history | Accepted; its framework shipped in 0037, the Steam source is an open issue; §3 amended by 0047 |
| [0027](0027-usernames-and-public-profiles.md) | Usernames are a namespace, and a profile is published only when asked | Implemented; the sitemap is 0036, D14 is 0058 |
| [0028](0028-a-games-community-view.md) | A game's community view: every score counts, only published reviews are listed, and neither is server-rendered | Implemented; §3 and §6 amended by 0070 |
| [0029](0029-favourites-are-an-axis-and-a-showcase.md) | Favourites are an axis like the wishlist, share its code, and are shown on the profile | Implemented; §4's mark on cards and §6's order amended by 0064 |
| [0030](0030-ownership-and-notes-belong-to-the-entry.md) | Ownership and notes belong to the entry, stay private, and are written under the game's lock | Implemented |
| [0031](0031-a-list-rename-is-a-label-its-owner-sees.md) | A list rename is a label, checked as a set, and seen only by its owner | Implemented |
| [0032](0032-each-browse-order-carries-its-own-floor.md) | Browse filters: every order is one IGDB query, and each carries its own floor | Implemented; decision 2 amended by 0067 |
| [0033](0033-what-the-api-refuses.md) | What the API refuses: guessing, volume, forged writes, and unattributed addresses | Implemented; §5's `img-src` is 0056, its `script-src` 0053 |
| [0034](0034-failing-in-one-shape.md) | Failing in one shape: IGDB is retried and broken, and every error says so the same way | Implemented; its `traceId` is the request's trace since 0059 |
| [0035](0035-a-local-copy-of-what-igdb-said.md) | A local copy of what IGDB said, so a library renders without them | Implemented; refreshed in the background by 0052 |
| [0036](0036-what-a-crawler-is-told.md) | What a crawler is told: `noindex` rather than `Disallow`, a sitemap from our own tables, and canonical URLs built from data | Implemented; its sitemap path for D14 corrected by 0058 |
| [0037](0037-a-tracker-import-carries-history.md) | A tracker import carries the history a platform import cannot | Implemented; decision 3 amended by 0045, decision 4 by 0050 |
| [0038](0038-where-scheduled-work-lives.md) | Where scheduled work lives, and what a sweep owes a fleet | Implemented; its deletion tested against PostgreSQL by 0057 |
| [0039](0039-an-imports-rows-die-with-its-review.md) | An import's rows die with its review, so retention keeps only the receipt | Implemented |
| [0040](0040-matching-a-title-to-a-game.md) | Matching a title to a game, when we would rather not answer | Implemented |
| [0041](0041-what-the-roadmap-decided-on-its-own.md) | The plan moves to GitHub issues, and what the roadmap decided on its own | Implemented |
| [0042](0042-admins-are-named-in-configuration.md) | Admins are account ids in configuration, behind one server-side policy | Implemented |
| [0043](0043-where-the-key-ring-lives.md) | The key ring lives in Parameter Store, under a name that does not move, and never nowhere by accident | Implemented; proved only by a deploy; `AllowEphemeralKeys` also set by the integration suite, 0057 |
| [0044](0044-what-the-deployment-walkthrough-settled.md) | What the deployment walkthrough settled, and where it found the records wrong | Accepted; built by #97; the client-image job it left to #106 is 0061 |
| [0045](0045-an-import-asks-once-about-what-it-will-not-guess.md) | An import asks once about what it will not guess: one list for every game played without an outcome | Implemented |
| [0046](0046-the-balancer-answers-its-own-distribution.md) | The balancer answers its own distribution, and what else the CloudFront phase settled | Implemented |
| [0047](0047-a-playthroughs-dates-count-and-a-status-change-comes-first.md) | A playthrough's dates count in the activity figures, and a status change comes first | Implemented; a rule for what is counted, which the history's list does not apply (0062) |
| [0048](0048-one-theme-dark.md) | One theme, dark, and palettes are variations of it | Implemented; the palettes are #208 |
| [0049](0049-every-colour-is-a-token.md) | Every colour is a token, named for its job, in one file | Implemented |
| [0050](0050-an-imported-run-takes-its-type-from-the-source.md) | An imported run takes its type from the source's completion level | Implemented |
| [0051](0051-admin-statistics-are-counted-never-listed.md) | Admin statistics are counted, never listed | Implemented |
| [0052](0052-a-background-refresh-ahead-of-the-reader.md) | A background refresh: cached games an hour before a reader would, Steam feeds before they expire | Implemented |
| [0053](0053-a-documents-scripts-carry-its-renders-nonce.md) | A document's scripts carry its render's nonce, and a shared cache keeps the pair whole | Implemented |
| [0054](0054-a-hand-arranged-order-is-a-sparse-position.md) | A hand-arranged order is a sparse position the client computes, and a change of list clears it | Implemented; §9 answered for the favourites by 0064 |
| [0056](0056-an-avatar-is-an-address-on-a-short-list-of-hosts.md) | An avatar is an address on a short list of hosts, which the document policy's `img-src` names too; a display name stands beside the handle; a bio is plain text | Implemented |
| [0057](0057-the-api-is-tested-over-a-real-postgresql.md) | The API is tested over a real PostgreSQL: one container a run, a database a class, and IGDB out of reach | Implemented; the export-snapshot test went in skipped and runs since #263; the front end it left to #105 is 0060 |
| [0058](0058-a-withdrawal-leaves-the-edge-when-it-is-made.md) | A withdrawal leaves the edge when it is made, and its retry stops when the TTL would have | Implemented; proved only by a deploy; §1's eighth event is 0056 |
| [0059](0059-a-request-is-known-by-its-trace-and-a-build-by-its-commit.md) | A request is known by its trace from the page to the API's log, and a build by its commit | Implemented; OpenTelemetry and the alarms are #103 |
| [0060](0060-one-browser-test-over-the-production-shape.md) | One browser test over the production shape: two processes, a stand-in for what routes between them, and IGDB answered over HTTP | Implemented; the images it leaves out are 0061 |
| [0061](0061-ci-gates-every-pull-request.md) | CI gates every pull request: the house style, known vulnerabilities, secrets in the history, and the images | Implemented; branch protection and GitHub's own secret scanning are settings the owner turns on, and what is left of #106 |
| [0062](0062-the-history-is-three-rows-unioned-and-what-has-no-moment-has-no-item.md) | The history is three kinds of row unioned at query time, and what has no moment has no item | Implemented |
| [0064](0064-the-showcase-is-arranged-by-hand-and-shown-in-that-order.md) | The favourites showcase is arranged by hand and shown in that order, and a favourite is marked on every card its owner sees | Implemented |
| [0065](0065-tags-are-the-owners-own-words.md) | Tags are the owner's own words: per account, by id on the row, set as a whole, and never published | Implemented |
| [0066](0066-a-holding-page-until-production-takes-the-domain.md) | A holding page at the domain until production takes it, and the apex is canonical | Implemented; deployed 2026-10-23, retired by #98 |
| [0067](0067-the-esrb-filter-lists-a-game-under-its-badge.md) | The ESRB filter lists a game under the rating its badge shows | Implemented |
| [0068](0068-lighthouse-on-the-production-shape.md) | Lighthouse on the production shape: five pages, a phone and a desktop, and only what the runner cannot move fails the build | Implemented; its credentials are allowed, and its lockfile audited, by 0061 |
| [0070](0070-nothing-shows-as-a-blank.md) | Nothing shows as a blank: empty and error states that teach, skeletons, and covers at their size | Implemented |

**Status** — *Accepted*: decided, not yet built. *Implemented*: decided and in the code.
*Superseded*: replaced by a later record.
