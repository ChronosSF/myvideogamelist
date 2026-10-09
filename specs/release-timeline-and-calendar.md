# Spec — What is coming for your games: a two-week line and a release calendar

Status: **accepted — built under #162: the admin page (#163), the connected releases (#164), the two-week line (#165) and the calendar (#166). §9's first, second, third and sixth questions are still open, and its fifth is #128**
Relates to: #129 (the old month view, which this replaces), #128 (the showcases and sales for signed-out
visitors — §9's fifth question), #122 (release notifications, which need the same "what is connected to
my games" answer), ADR [0042](../docs/decisions/0042-admins-are-named-in-configuration.md) (the admin
model §7 specifies), ADR
[0004](../docs/decisions/0004-release-dates-for-calendar.md) (releases come from `release_dates`), ADR
[0012](../docs/decisions/0012-steam-news-without-a-database.md) (derived data lives in memory, not in
tables), ADR [0015](../docs/decisions/0015-fargate-confirmed-and-nat-less-networking.md) (the database
has no public endpoint), and #160, which removed the timeline this replaces.

---

## 1. Why this exists

The home page used to end with every game releasing anywhere in the next thirty days, narrowed by a
list of platforms the user had hidden on their profile. #160 removed both, so that what replaces
them starts from a clean page.

This starts from the other end: the user's own games. It asks IGDB what is coming that is
connected to them —

- a game they track arriving on a new platform;
- an expansion or DLC for one of them;
- a remake, remaster or new edition of one;
- the next game in the series of one, which is most of what people mean by "connected".

— and puts beside those the few industry dates that matter to everybody: the big showcases, where
news about those games tends to land, and the store-wide sales, when they get cheaper.

It is free on both tiers, as [0010](../docs/decisions/0010-monetization-model.md)'s table already has
it ("Upcoming calendar").

Every IGDB value and figure below was taken from live responses on 2026-09-28; §10 has them.

## 2. What the user sees

### 2.1 The two-week line

One line across the signed-in half of the home page, covering today and the next thirteen days.
Most libraries will put little on it — a 34-game library had one release in the next two weeks, a
1,500-game one twenty-six (§10) — and that is the point: it is the glance, and the calendar is the
whole view.

| # | Requirement |
|---|---|
| L1 | One horizontal line in the signed-in hero, from today to thirteen days ahead — above Trending and the news, which matter less to somebody who has signed in than their own games do. It replaces the Releasing soon rail, which covered wishlist and backlog releases only (§8.3) |
| L2 | Only entries known to the day (§4). A release known only to its month, quarter or year never appears on the line; it waits in the calendar |
| L3 | A release is a point on its day. A sale or a showcase that spans days is a span across them. Showcases and sales are marked as what they are and carry no cover |
| L4 | Every entry says why it is there (§3.4) |
| L5 | Entries grouped by §3.3's F6 appear as one ("Kingdom Hearts — 8 releases") |
| L6 | A link to the calendar, always shown |
| L7 | Signed-in users only, and rendered even when empty, with a line saying nothing is due in the next two weeks — a section that comes and goes is one nobody learns to look for |

### 2.2 The calendar — `/calendar`

| # | Requirement |
|---|---|
| K1 | A month grid, Monday first, opening on the current month and reaching the same month a year later — thirteen months, §9's fourth question settled at the year it leaned to. All of them are listed above the grid, each with how much is on its days and in its own band, and the month is in the address (`?month=2027-02`), so that it can be linked to and the back button steps back through the months. A month the calendar does not reach opens the first |
| K2 | Entries known to the day in their day's cell; sales and multi-day showcases as bars across their days, a piece per week, with only an event's first piece in the month read out, with all of its dates. Below `md` the month is a list instead: its sales and showcases once each, then the days with something on them |
| K3 | Entries known only to the month, quarter or year in a band for that period, below the grid, never on an invented day (§4). The grid comes first, directly under the month's name: its days are the certain part of the month. A quarter's band is in each of its three months and a year's in each of its twelve: "sometime in 2027" is as true of March as of June. Beyond the first few months the bands are most of what there is (§10) |
| K4 | An "Announced, no date" list of connected games IGDB has no date for at all, below the grid and the same in every month: games with no `first_release_date`, folded first (F3) and left out when what they fold into has one, and none IGDB marks cancelled or rumoured (F4). A game of the user's own is "announced for" its platforms rather than "out on" them |
| K5 | Every entry says why it is there (§3.4), as on the line |
| K6 | Signed-in only; `NOINDEX` and `private, no-store`, like every other per-user page |

## 3. Which games, and what "connected" means

### 3.1 The user's games

The set everything is derived from is the union of:

- the favourites (`UserFavourites`);
- the wishlist (`UserWishlistItems`);
- the entries in Backlog, Playing, On Hold and Finished.

Dropped is left out by default (§9). An entry that has left every list
([0019](../docs/decisions/0019-entry-survives-leaving-every-list.md)) is not in the set: it keeps a
score or a review, not an interest in what comes next.

### 3.2 The relations

Three relations, all asked in the same release query (§8.1):

| # | Relation | In IGDB | What it finds | Seen on 2026-09-28 |
|---|---|---|---|---|
| R1 | The game itself | the game's own `release_dates` rows | a new platform or region; an early-access game reaching its full release | Resident Evil 2 on Switch 2, 16 Oct |
| R2 | Its children | games whose `parent_game` or `version_parent` is the game | DLC, expansions, standalone expansions, remakes, remasters and expanded games | Street Fighter 6's next character, 13 Oct; The Witcher 3 Remastered, 29 Sep |
| R3 | Its series | games sharing one of its IGDB series (`collections`) | sequels and prequels, spin-offs, and the series' remakes and new-console editions | Grand Theft Auto VI (from GTA V), 19 Nov; God of War Laufey, 16 Feb 2027; Persona 4 Revival, 18 Feb 2027 |

Most new-platform releases are R1: IGDB adds a platform's release row to the game rather than
creating a new game. Where it does create one, as with "Xenoblade Chronicles 3: Nintendo Switch 2
Edition" (typed Expanded Game), the new entry is reached like any other connected game — that one
came in through its series.

Deliberately not used:

- **Franchises.** Broader than a series and noisy with it. In the probe, the Final Fantasy
  franchise brought in Kingdom Hearts — Kingdom Hearts III belongs to twenty-two franchises, Final
  Fantasy among them — and Mario's brought in a mobile Mario Kart that was shutting down. A series
  is the closest thing IGDB has to "the next one".
- **`similar_games`.** A recommendation, not a connection.
- **A sequel link.** IGDB has none, which is why R3 stands in for it. IGDB can mark a series member
  as a spin-off, but it does so for 2,146 memberships against 52,056 plain ones — a mobile gacha
  game set in Final Fantasy VII is a plain member — so it cannot tell the next main game from the
  rest, and is not used.

### 3.3 What is kept, what is folded, what is dropped

For the 34-game demo library, the three relations found 21 games with a release in the next six
months. F1 to F5 removed a bundle, a shutdown and an update, and left eighteen entries a player
would recognise (§10). Across all dates, the same library's children in IGDB include 117 mods, 26
packs and 17 bundles, so the rules will have more to do than one six-month window suggests.

| # | Rule | Why |
|---|---|---|
| F1 | Keep game types 0 Main Game, 1 DLC, 2 Expansion, 4 Standalone Expansion, 6 Episode, 7 Season, 8 Remake, 9 Remaster, 10 Expanded Game and 11 Port | What a player would call a release |
| F2 | Drop 3 Bundle, 5 Mod, 12 Fork, 13 Pack / Addon and 14 Update | Mods alone were 117 of the demo library's 320 children. Update is a judgement call (§9): Silksong's "Sea of Sorrow" is one |
| F3 | Fold an edition — a main game (type 0) with a `version_parent` — into the game it is an edition of, following a chain of editions to its end; the chain can pass through a bundle. A remaster, expanded game or port that carries a `version_parent` is not folded: it is a product of its own, and a child of that game (R2). It also ends a chain, so an edition of one is shown as it | "Grand Theft Auto VI: Ultimate Edition" is Grand Theft Auto VI, on the same day. Of 500 games carrying a `version_parent` on 2026-09-29, 426 were main games and 61 bundles (F2 drops those), and ten were remasters, expanded games and ports. The Witcher 3's "10th Anniversary Edition" is an edition of its "Complete Edition", a bundle, which is an edition of the game. "Rust: Console Edition - Ultimate" is an edition of Rust's console port, which carries a `version_parent` of its own, and is the port |
| F4 | Keep release statuses 6 Full Release and 3 Early Access, and rows with no status. Drop 1 Alpha, 2 Beta, 4 Offline, 5 Cancelled, 34 Advanced Access, 35 Digital Compatibility Release and 36 Next-Gen Optimization Patch Release. Drop every row of a game IGDB marks cancelled or rumoured — `game_status` 6 or 7 — whatever its rows say | Offline is a shutdown date — Final Fantasy VII: Ever Crisis on 6 Oct — not a release. Advanced Access opens a game early to buyers of one edition, and would list the game twice. 35 and 36 are an old game sold unchanged on a newer console, or patched for one. A cancelled game's rows can outlive it: on 2026-10-08 "Metro Rivals: New York" was marked cancelled with three "2026" rows still marked Full Release, and Fallout Extreme was still "to be decided" on the Xbox and the PS2 |
| F5 | One entry per game and period, its platforms merged. Where the same game on the same platform, in the same phase, is also known more precisely inside that period — a region's day beside another's month — only the precise one is kept. The phase is early access, or a full release with or without its status. The comparison takes in what is known outside the window too, where a band's period runs past it (§8.1) | As ADR 0004 already does, and so that "Oct 2026" does not sit beside "16 Oct 2026" as a second release. An early-access day and a full release known only to its year are two milestones, not one known twice: Starseeker: Astroneer Expeditions entered early access on 11 June 2026 with its full release "2026". And a band can be outlived just outside the window: Little Witch in the Woods was "2026" on Switch and came out on Switch on 16 September, so a calendar opening on 1 October would have shown it as due sometime in a year it was already out in |
| F6 | Entries in the same period that belong together group into one: the same series, or — with no series between them — DLC for the same game. Where they share several series, the series is chosen across the period, not per entry: the one the most of them share takes its entries first, then the next among the rest, a tie going to the lowest id. The group is named after the series or the game, and its strongest reason (§3.4) is the one shown | Eight of the 300-game test's ten entries in two weeks were Kingdom Hearts games arriving on Switch 2, PS5 and Xbox on the same day. On 13 October 2026 Street Fighter 6 had two DLC rows for one character, "Year 4 - Arjun" and "Additional Character - Arjun & Outfit 2", and neither is in a series. On 1 February 2026 Final Fantasy VII Remake and its Episode Intermission came to Switch 2 and Xbox Series together, both in Final Fantasy, Final Fantasy VII and the Compilation of Final Fantasy VII, which IGDB lists in a different order for each |

### 3.4 Every entry says why it is there

An entry names the game in the user's set that brought it in, and the relation: "On your wishlist —
out on Switch 2", "Expansion for Elden Ring, a favourite", "From the God of War series — you
finished God of War". When several of the user's games bring in the same entry, the strongest reason
is the one shown: the relation first, R1 before R2 before R3, and then the membership, a favourite
before the wishlist before a list. The relation leads because it is the more specific claim — "Re Mind
is DLC for Kingdom Hearts III, which you finished" says more than "Re Mind is in the Kingdom Hearts
series, like your favourite Kingdom Hearts 0.2".

A list is said as what the user did with the game — finished it, is playing it, put it on hold, plans
to play it — never by the list's name. A rename is a label its owner sees
([0031](../docs/decisions/0031-a-list-rename-is-a-label-its-owner-sees.md)), and "you finished God of
War" stays true whatever Finished is called, where "in your Finished" would print a default the owner
may have replaced. A series is "from", not "new in", because what a series brings in can be an old
game reaching a new platform.

A group (F6) says its strongest reason as the group's: "Includes Kingdom Hearts III, which you
finished", or "Connected to Kingdom Hearts III" when that reason is one release's DLC, so that eight
releases are not all called DLC. A run of DLC for one game is the group that can be called what it
is: "DLC for Street Fighter 6, which you're playing".

## 4. Most dates are not days

IGDB's `date_format` says how much of a release date is known: 0 the day, 1 the month, 2 the year,
3 to 6 a quarter, 7 nothing yet. Of the 6,317 release rows dated within the next twelve months on
2026-09-28, 1,661 were known to the day, 305 to the month, 1,516 to a quarter and 2,835 to the year.

The stored `date` of an imprecise row is a stand-in. A year-only "2026" is stored as 31 December
2026, a month-only "Jan 2027" as 1 January 2027, and a quarter-only "Q1 2027" as the quarter's last
day, 31 March 2027. Every such row also carries `y` and `m`, and those — with `date_format` — are what
say which period it is. Placed by the stored date, a year's worth of "sometime in 2026" would pile up
on New Year's Eve; selected by it, a window ending in September 2027 would never reach a year-only
2027 at all (§8.1).

| # | Rule |
|---|---|
| D1 | The line shows `date_format` 0 only (L2) |
| D2 | The calendar puts 0 in its day, 1 in a band for its month, 3–6 in a band for its quarter, 2 in a band for its year, and 7 under "Announced, no date" |
| D3 | A release date is a day, not an instant, and is shown as the day IGDB names with no timezone conversion, as `@/lib/releaseDate` already does |
| D4 | Some rows known "to the day" are placeholders — two Street Fighter 6 characters are due on 31 December 2026 exactly. Nothing in the data marks them, so they are shown as dated |

## 5. Showcases, from IGDB

IGDB's `events` are showcases and conventions: a name, `start_time` and `end_time`, a `time_zone`, a
`live_stream_url`, and the `games` featured. IGDB records them faithfully and late. Of the 184
events in the year to 2026-09-28, half were added three days or less before they began, 90% within
35 days, and 32 after they had started. That is mostly the world rather than IGDB: a Nintendo Direct
or a State of Play is announced a day or two ahead, and was added a day or two ahead. The tentpoles
are known for months, and IGDB had them for months — Summer Game Fest 128 days ahead, The Game
Awards 107, the Xbox Games Showcase 69. On 2026-09-28 IGDB held one future event.

So the line will have its showcases, and beyond a month the calendar will show only the tentpoles.
That is the true answer, not a gap to fill.

Most of the 184 are small — indie and publisher showcases around the big ones — so only some are
shown.

| # | Rule |
|---|---|
| E1 | An IGDB event is shown when its name starts with one of a list of showcase names kept on the admin page (§7), ignoring case: "Nintendo Direct", "State of Play", "Summer Game Fest", "The Game Awards", "Xbox Games Showcase", "Gamescom Opening Night Live" and so on. A prefix, not a substring: "Day of the Devs: Summer Game Fest Digital Showcase" is a satellite show, and does not start with "Summer Game Fest". The list starts empty and is filled on the page — no migration seeds it, so that it is kept in one place |
| E2 | A showcase IGDB does not have yet can be added by hand on the admin page, as a curated event (§6) |
| E3 | "Features a game you track" is left for later. An event's `games` appear to be filled in around the broadcast — the one future event had none — so it could only be said of a show that has already aired |
| E4 | An IGDB event is an instant, not a day, and is drawn on the reader's own day at its start time. A show at three in the afternoon in Los Angeles airs after midnight in Sofia, and only the reader's clock can say which. So the server asks IGDB for a day either side of the window, in UTC, and the browser keeps what falls on the reader's days. `time_zone` is not read: it is an abbreviation, and on 2026-10-06 the June 2026 shows were "PST" while Los Angeles was on daylight time |

## 6. Store sales, entered by hand

No store publishes its sale dates in a form a program can read, and no aggregator is a source for
them. Checked on 2026-09-28:

| Source | What it has | How far ahead |
|---|---|---|
| Steam — Valve's "Upcoming Steam Events" page for developers | Seasonal sales, Next Fest, themed fests; public HTML, no feed | 6–12 months, published in half-year batches |
| Epic — a quarterly promotional guide on Epic's forum | Every campaign in the quarter | 8–15 weeks |
| PlayStation, Xbox, Nintendo, GOG — their news posts | A sale, once it starts | On the day; PlayStation about a day before |
| IsThereAnyDeal | Per-game deals with an end date; no store-wide sale anywhere in its API | — |
| SteamDB | No API, and its FAQ forbids scraping | — |
| IGDB | Showcases only (§5) | — |

So sales are curated. An admin enters them on the admin page (§7) after Valve's schedule posts in
mid-January and mid-July and after each of Epic's quarterly guides, and a console sale on the day
it is announced, if at all.

| # | Rule |
|---|---|
| S1 | A curated event has a kind (sale, fest or showcase), a store where it has one, a name, a first and a last day, and a link to where it was announced |
| S2 | Steam's seasonal sales and Next Fest are entered. Its themed fests are not by default (§9): they are not sales — games need not be discounted — and there are fourteen in the current schedule |
| S3 | Days, not times. Steam's sales start at 10am Pacific; PlayStation's and Nintendo's start in each region's own time. A day is the resolution that is true everywhere |

## 7. The admin page

Sales are entered a few times a year by the owner. They go in through an admin page rather than
the two alternatives:

- **SQL against the database.** Workable locally, where the container listens on 5432. Deployed,
  the database has no public endpoint and is reachable only from the tasks' security group
  ([0015](../docs/decisions/0015-fargate-confirmed-and-nat-less-networking.md)), so every edit would
  need a tunnel into the VPC, and a hand-written `INSERT` skips every rule S1 sets.
- **A file in the repository.** Every date would be a pull request and a deploy.

An admin page is not an anti-pattern: it is how reference data an operator maintains is normally
kept. Admin pages go wrong in specific ways, and each rule below answers one of them.

| # | Rule | The failure it prevents |
|---|---|---|
| A1 | Admins are a list of account ids in configuration — user secrets locally, an environment variable when deployed — read by one authorization policy, alike in every environment. Account ids, which never change: not usernames, which can be renamed ([0027](../docs/decisions/0027-usernames-and-public-profiles.md)), nor addresses | A privilege keyed on something the user can edit, or one that exists only in Development |
| A2 | Every admin endpoint is behind that policy on the server. The client shows the page's link only to an admin, and that is presentation, not the guard | A page whose only protection is a hidden link |
| A3 | The page edits curated events and the showcase names (§5), and nothing else — no user's data, no accounts | An admin page that grows into a database editor |
| A4 | Writes go through `apiFetch` with `X-MVGL-Request` ([0033](../docs/decisions/0033-what-the-api-refuses.md)); the page is `NOINDEX` and `private, no-store` | The forged writes and cached responses every other page is already guarded against |
| A5 | Its two tables carry no `UserId` column, not even to record who changed a row | `UserOwnedDataTests` selects user-owned tables by that column, and would demand a cascade from the account and an export section for rows that belong to nobody |
| A6 | `/api/auth/me`, and every other endpoint that answers with the signed-in user, says whether the account is an admin, so the navbar can link to the page | A rename that answered without the flag, and took the link away until the next page load |

A1 follows the statistics tiers' stand-in (`specs/profile-statistics-tiers.md` §4), a named list of
account ids from configuration, with one difference: that list grants everything in Development and
this one grants nothing it does not name. Identity's role tables already exist — `Program.cs`
registers `IdentityRole` — but a role still needs its first member put there by some means, and on
a database nobody can reach, that means configuration anyway. Roles become worth having with a
second kind of admin. [0042](../docs/decisions/0042-admins-are-named-in-configuration.md) records the
model for whatever admin page comes next; the key is `Admin:AccountIds`.

## 8. Server and client work

### 8.1 Where the answer is computed

On request, cached in memory — the shape [0012](../docs/decisions/0012-steam-news-without-a-database.md)
set for data that is derived and can always be asked for again. Nothing about a user's connected
releases is stored.

A user's releases take two kinds of IGDB request: the series of the games in the set (a `games`
query, 500 games to a page), then one `release_dates` query that filters through the game, paging
at 500 rows in id order so that rows sharing a date cannot move between pages.

```
where (game = (…) | game.parent_game = (…) | game.version_parent = (…) | game.collections = (…))
  & (((date_format = 0 | date_format = null) & date >= {from} & date < {to})
     | (date_format = (1,2,3,4,5,6) & date >= {from − 31 days} & date < {to + 366 days}))
```

A row known to the day is selected by its date. A row known only to a month, quarter or year cannot
be, because its date is a stand-in (§4): it is asked for across every date a period overlapping the
window could be stored under — a month's first day, up to a month before the window; a quarter's or
a year's last day, up to a year after it — and kept only if its period, read from `y`, `m` and
`date_format`, overlaps the window. The line asks for days alone and leaves the second clause out.

A band whose period runs past the window — "2026" in a calendar opening on 1 October 2026, "Q4 2027" in
one that ends on 1 November 2027 — is compared (F5) with what is known in the rest of its period, which
the window did not ask about. So when any band does, one more query asks for every dated row of those
bands' games, and of their editions, from the first such period's start to the last one's end: about one
more page at 1,500 games, as measured on #168, where widening the whole window to the years at either end
of it would ask about every game. A finer row inside a band's period is stored inside it too — a day on
itself, a month on its first day, a quarter on its last — so the band's own days are the range to ask.
Those rows are compared and never shown.

For a 1,500-game library that release query was 26 KB, and came back as one page of 332 rows in
0.7 s. A bigger library is split into a query per 1,500 games, and one for its series, rather than
sent as a query longer than any IGDB has been seen to accept. The games each row names — and, for
F3, the editions they are editions of, a generation at a time, and for F6 the games they are DLC for,
which name a group even when they are not in the set — are one more `games` query each, and each game
is cached on its own for six hours, since the same games come up for everybody.

IGDB's answer is cached for an hour under a key built from the set's game ids, so adding a game to a
list changes it at once and two identical sets share one answer. It is IGDB's answer that is cached,
not the entries: moving a game from the wishlist to Playing changes the reasons without changing a
single row, so the rules run on every request. A failed or partial answer is never cached. The "no
date" list is one more query, on `date_format = 7` with no date range, for games with no
`first_release_date`, which is IGDB's own word for a game with no date anywhere. A row to be decided is no
news about a game with a date elsewhere: of 399 games a 300-game library reached through undated rows on
2026-10-08, 124 had a dated row as well, such as Far Cry 4, "to be decided" on Stadia. That answer is
cached for an hour per set too. `first_release_date` cannot say which day a release is, which is why
[0004](../docs/decisions/0004-release-dates-for-calendar.md) set it aside, but its absence is exactly
K4's "no date at all".

When IGDB is down, the releases are missing and say so. The curated sales still show, because they
are ours.

#122's notifications need the same "what is connected to my games" answer, and will compute it on a
schedule ([0038](../docs/decisions/0038-where-scheduled-work-lives.md)) rather than on request. It
should be one service that both call.

### 8.2 Server

| # | Requirement |
|---|---|
| B1 | `GET /api/user/releases?from=&to=&precision=` — the user's connected releases in the window, `to` exclusive and at most 400 days after `from`, grouped by F6 and each with its reason (§3.4); `precision=day`, the default, for the line, and `any` for the calendar's bands as well; `no-store` |
| B2 | `GET /api/calendar/events?from=&to=` — showcases and curated events. The same for everybody, so cacheable once for everybody, with a `degraded` flag when IGDB failed, as `/api/home` has. Only IGDB's part is cached, an hour per window, and the curated events and the showcase names are read on every request, so an admin's edit shows at once. With no showcase names on the list, IGDB is not asked |
| B3 | Admin endpoints for curated events and showcase names, behind A1's policy and `no-store`: `/api/admin/calendar/events` (list and add; replace and remove by id) and `/api/admin/calendar/showcase-names` (list and add; remove by id). A name already on the list, in any letter case, is refused as a problem with the field |
| B4 | A migration adding the two tables, `CuratedEvents` and `ShowcaseNames` (`docs/data-model-plan.md`). Neither is user-owned (A5) |
| B5 | Tests for §3.3's rules against recorded IGDB rows, and for the policy refusing a non-admin |
| B6 | Once the line ships, retire `/api/games/upcoming` and `GetUpcomingReleasesAsync`. 0004's reasoning — `release_dates`, not `first_release_date` — carries over to B1 |
| B7 | `GET /api/user/releases/undated` — the connected games IGDB has no date for at all (K4), grouped by F6 and each with its reason, the most connected first: the game itself before its children before its series. `no-store`, and no window, since there are no dates to put one around |

### 8.3 Client

| # | Requirement |
|---|---|
| C1 | The two-week line in the signed-in hero, replacing `ReleasingSoonRail` along with `releasingSoon.ts` and `useUpcomingGames` |
| C2 | Its hook takes the account id and follows the shape `useUserStats` does, because the home page outlives a sign-out |
| C3 | `/calendar`, the month grid of §2.2 |
| C4 | `/admin`, the curated events and the showcase names |
| C5 | Both routes declare `private, no-store` through `headers` and `NOINDEX` in `meta` |

## 9. Open questions

1. **Dropped.** Out of the set by default (§3.1). Somebody who dropped a game might still want its
   sequel.
2. **Updates.** Type 14 is dropped by default (F2), which also drops the occasional real content
   drop such as Silksong's "Sea of Sorrow".
3. **Steam's themed fests.** Not entered by default (S2).
4. **The calendar's horizon.** Settled on #166 at a year: the month the calendar opens on and the twelve
   after it (K1), which is also what one request may ask for. Six months held eighteen entries for the demo
   library, and beyond the first few months most of what there is is known only to its year (§10).
5. **Signed-out visitors.** Nothing, or the showcases and sales on their own? #128 wanted showcases
   on the shared home page, and this spec puts them on the signed-in line.
6. **Shutdowns.** A game the user tracks going offline is dropped with every other Offline row
   (F4). It might be worth an entry of its own.
7. **A game with a stream of DLC.** F6 groups DLC for one game on one day. A game with dozens of DLC
   a year, spread over as many days, may still need a cap of its own.

## 10. Evidence — taken on 2026-09-28

### IGDB values, from live responses

| What | Values |
|---|---|
| `game_types` | 0 Main Game, 1 DLC, 2 Expansion, 3 Bundle, 4 Standalone Expansion, 5 Mod, 6 Episode, 7 Season, 8 Remake, 9 Remaster, 10 Expanded Game, 11 Port, 12 Fork, 13 Pack / Addon, 14 Update |
| `date_formats` | 0 YYYYMMDD, 1 YYYYMM, 2 YYYY, 3 YYYYQ1, 4 YYYYQ2, 5 YYYYQ3, 6 YYYYQ4, 7 TBD |
| `release_date_statuses` | 1 Alpha, 2 Beta, 3 Early Access, 4 Offline, 5 Cancelled, 6 Full Release, 34 Advanced Access, 35 Digital Compatibility Release, 36 Next-Gen Optimization Patch Release |
| `game_statuses`, 2026-10-08 | 0 Released, 2 Alpha, 3 Beta, 4 Early Access, 5 Offline, 6 Cancelled, 7 Rumored, 8 Delisted. Absent for most games |
| Undated rows, 2026-10-08 | A row with `date_format` 7 has no `date`, `y` or `m` at all, and a comparison with a date never matches one. `games.first_release_date` is absent for a game whose every row is undated, set from a year-only row as readily as from a day ("Metro Rivals: New York", known only to be "2026", had 31 December 2026), and not set by a beta day ("Tavernia" had one, and no `first_release_date`). For the 368 games of IGDB's latest 500 undated rows, its absence matched "no dated row" for 367; the other was Tavernia |
| `collection_membership_types` | 1 Member (52,056 memberships), 2 Spin-off (2,146) |
| `release_dates` fields | `game`, `date`, `human`, `date_format`, `release_region`, `platform`, `status`, `y`, `m`. There is no `category` or `region` any more |
| `games` fields examined | `game_type` (there is no `category` any more), `collections`, `franchises`, `parent_game`, `version_parent`, `dlcs`, `expansions`, `standalone_expansions`, `remakes`, `remasters`, `expanded_games`, `hypes` |
| `events` fields | `name`, `description`, `slug`, `start_time`, `end_time`, `time_zone`, `live_stream_url`, `games`, `videos`, `event_logo`, `event_networks` |
| Filtering through the game | `release_dates` filters on `game.collections`, `game.parent_game` and `game.version_parent`, and expands `game.name` and the like in `fields` |
| Stored dates, 2026-09-29 | Day: midnight UTC. Month: its first day. Quarter: its last day ("Q1 2027" is 31 March 2027). Year: 31 December. Each carries `y` and `m`. The query of §8.1, `date_format = null` included, parses and answers |
| `version_parent`, 2026-09-29 | Of 500 games carrying one: 426 main games (editions), 61 bundles, 5 expanded games, 3 remasters, 3 DLC and 2 ports. Remakes, remasters and expanded games are linked by `parent_game` — Persona 4 Revival, the Witcher 3 Remastered, Xenoblade Chronicles 3's Switch 2 edition |
| Editions of a product, 2026-10-04 | All of IGDB held 130 remasters, expanded games and ports carrying a `version_parent` — 34, 74 and 22 — and seven games whose `version_parent` is one of those: six main games and a bundle. "Rust: Console Edition - Ultimate" (164658) is an edition of "Rust: Console Edition" (145149), a port whose `parent_game` and `version_parent` are both Rust (3277) |

### Measurements

The demo library is `scripts/seed-demo-history.mjs`'s 34 games. The larger libraries are stand-ins
made of IGDB's most-rated main games.

| Measurement | Result |
|---|---|
| Demo library, next six months, after F1–F3 and F4's Offline, before F6 | 18 entries: 1 from R1, 6 from R2, 11 from R3 |
| Next two weeks, day-precise only, after the same rules | 34 games: 1 · 100: 2 · 300: 10, eight of them one Kingdom Hearts day · 700: 13 · 1,500: 26 |
| One release query for a whole library | 34 games: 0.33 s · 300 games and 159 series (5 KB): 0.30 s · 700 and 322 (12 KB): 0.67 s · 1,500 and 616 (26 KB): 0.71 s, in one page |
| Release rows dated within twelve months, by precision | 6,317: 1,661 to the day, 305 to the month, 1,516 to a quarter, 2,835 to the year |
| IGDB events in the year to 2026-09-28 | 184. Added before they began by a median of 3 days; 75% within 11, 90% within 35; 32 added after they began; one future event |
| A calendar from 1 Oct 2026 to 1 Nov 2027, before F3 and F6, on 2026-10-08 | Demo library: seven entries on October's days and four or fewer a month after, two in 2026's band and six in 2027's. 1,500 games: 38 on October's days, 11 on November's and 10 on December's, then six or fewer a month; 7 in Q4 2026's band, 9 in Q2 2027's, 19 in 2026's and 29 in 2027's |
| Undated, 2026-10-08 | A 300-game library reached 529 undated rows on 399 games, 180 of them mods, and 124 of the 399 had a dated row as well. Of the rest, F1, F2 and F4 and IGDB's cancelled and rumoured left about thirty: The Elder Scrolls VI, Persona 6, the God of War remakes, the Witcher remake and the like |

### Store sales sources

- **Steam**: `https://partner.steamgames.com/doc/marketing/upcoming_events`. On 2026-09-28 it listed
  the Autumn Sale (1–8 Oct 2026), Winter Sale (17 Dec 2026 – 4 Jan 2027), Spring Sale (18–25 Mar
  2027) and Summer Sale (24 Jun – 8 Jul 2027); Next Fest on 19–26 Oct 2026, 22 Feb – 1 Mar 2027 and
  14–21 Jun 2027; and fourteen themed fests.
- **Epic**: the quarterly guides on Epic's forum, for example
  `https://forums.unrealengine.com/t/2026-q4-promotional-guide-egs-promotions/2746185`, posted on
  24 Aug 2026 with the Halloween Sale (19 Oct – 2 Nov), Epic Savings (12–26 Nov), a Black Friday
  sale of premium editions (17 Nov – 1 Dec) and the Holiday Sale (10 Dec – 7 Jan).
- **PlayStation, Xbox, Nintendo, GOG**: the PlayStation Blog, Xbox Wire, Nintendo's news and GOG's
  press room announce a sale when it starts. Sony's and Nintendo's site terms forbid automated
  access.
- **IsThereAnyDeal** (API v2): deals per game, each with an `expiry`; no store-wide sale or start
  date anywhere in the API.
- **SteamDB**: no API; its FAQ forbids scraping.

## 11. What is left, and in what order

Each step is a sub-issue of #162.

1. The admin page, its two tables and A1's policy (§7) — small, and it unblocks the sales and the
   showcases. #163, done.
2. The releases service and B1, with §3.3's rules under test. #164, done.
3. B2, and the two-week line in place of the Releasing soon rail. #165, done.
4. The calendar, and the line's link to it (L6). #166, done.
5. Retiring `/api/games/upcoming` (B6), with the line. #165, done.
