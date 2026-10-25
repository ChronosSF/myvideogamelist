# 0071. Coming soon is what IGDB says people are waiting for, cut to ten and corrected by hand

**Status:** Implemented — #198.

> **Later note.** Trending, which §5 puts the panel before, is gone: [0073](0073-the-home-page-a-welcome-coming-soon-just-out-and-the-news.md)
> put Just out after the panel in its place, the new games of the last ninety days most watched on Twitch.
> The admin's hides keep a game off both panels.

## Context

#198 asked for a "coming soon" panel on the home page that is the same for every visitor: the big
upcoming games, whatever the reader tracks. The signed-in home page already has the two-week line, which
starts from the reader's own games (spec L1). A visitor has nothing like it, and every other panel on
the page comes from Steam (ADR 0012), so a console-only or mobile game could never appear there (#205).

The difficulty was never the plumbing; it was the word "big". #160 had already removed a home page
timeline of every game releasing in the next thirty days, which needed a hidden-platforms preference
just to be readable: IGDB lists thousands of releases a quarter. The site has no members yet, so no
signal of its own (wishlist counts, scores) can say which of them matter. The basis had to come from
IGDB, and the list had to be short whatever the basis turned out to be.

Two IGDB signals were candidates. Popularity type 2, "Want to Play", led on anticipation when ADR 0032
compared the types, but it lives on `popularity_primitives`, which Apicalypse cannot join to a game's
release dates, so a window over it is two queries; its top 25 also held The Elder Scrolls VI, which has no
date. `games.hypes` counts the people following a game ahead of its release, sits on the game itself,
and so filters and sorts in the same query as its release rows. The spec had seen the field exist
(§10) but nobody had looked at its values.

## Decision

### 1. The candidates are new games first released in the next ninety days, by fixed rules

- **New games only**: IGDB `game_type` main game (0), standalone expansion (4), remake (8) or remaster
  (9), and no `version_parent`. Not DLC, an edition, a port, a bundle or an update: a panel for everybody
  would otherwise fill with expansions and with last year's games arriving on new consoles. The ids were
  read from `game_types` live on 2026-10-25, matching `IgdbGameTypes`.
- **Full releases only**: a row whose status is Full Release, or none. Not an alpha, a beta, early
  access, or the paid early start IGDB calls Advanced Access (status 34, seen on Fable's rows).
- **Not cancelled or rumoured**, by the game's `game_status`, as the release line already rules (F4).
- **Not out yet**: a full release on a day already past means the game is out somewhere, and a later
  platform or region is not news for everybody. A month or quarter already past is a date IGDB never
  came back to, so it is passed over rather than taken as a release. Early access is not out either: a
  game in early access is coming for its full release, as Path of Exile 2's 1.0 on the 11th of December
  2026 was.
- **A date the panel can stand behind**: a day inside the window, or a month or quarter overlapping it.
  A game known only to its year is left out — in late October a bare "2026" is more often a delay to
  come than a promise — and so is one with no date at all. Among a game's rows in the window the finest
  wins, then the earliest, and the platforms shown are that period's: Acts of Blood is on PC on the 4th
  of December and only "2027" on the consoles, so it is a December PC game.

### 2. Ranked by `hypes`, ten at most, twenty follows at least

The most followed first, cut at ten, and none under twenty follows. The ten shown are then ordered by
when their period ends, so that "Q1 2027" follows the days of January rather than leading them.

The cap is what makes the panel manageable, not the quality of the signal: the ranking only has to be
right at the top, and it is. The floor is for a quiet stretch, so that the panel shows six games rather
than ten of which four nobody has heard of. On the day this was drawn the cap bound and the floor did
not.

### 3. The admin page corrects it: pin and hide

`ComingSoonPicks` holds a game's IGDB id and whether it is pinned or hidden, entered on the admin page
like the calendar's curated events (spec §7), with no `UserId` for the same reason. A pin carries a game
past the floor and puts it ahead of the rest, counting towards the ten; it never carries one past the
dates, because the panel's whole content is when. A hide keeps a game off whatever its follows. A pick
is named by what IGDB calls the game when it is made, so a mistyped id is refused rather than stored.

The table is read before the home composite starts its parallel parts, since the showcases and sales
read our tables too and the two may not share the request's context at once. If it cannot be read the
panel is left out and the page marked degraded: composed without the picks, a hidden game would be back
on the front page.

### 4. One query, kept for the UTC day; the rules every quarter of an hour

The panel's IGDB query asks for the candidates and any pinned games in one request: `games` with
`hypes >= 20`, the game types above, no `version_parent`, and a release row stored from the first of
this month (where a row known only to be "October" is) to a quarter's length past the window (where a
quarter starting inside it is stored, on its last day), sorted by `hypes`, with every release row and its
platform expanded — nested expansion seen to work live. The answer is kept for the UTC day.

By a release row, not by `first_release_date`. That is the game's earliest date of any kind, and on
2026-10-25 it was the early-access day of every game still in early access — Inzoi's was the 28th of March
2025 — so selecting by it never showed the rules four games whose 1.0 fell in or near the window. It can
as well be a quarter IGDB never came back to. A row in the range also brings in released games with a
port coming, which the rules drop as out already: twenty-nine more candidates in all, and one more game on
that day's panel.
The rules run on every composition of `/api/home`, so a game leaves the panel the day it comes out
however old IGDB's answer is, and a pick changes the next composition: the admin's write also drops the
process's copy of the home page.

It is part of `/api/home`, shared and server-rendered, and degrades as every part of that page does:
IGDB failing costs the panel and marks the page degraded; no game passing the rules is an answer, and the
panel is simply not drawn. IGDB answering no rows at all is what a removed field looks like, so it is
logged.

### 5. For everybody, before Trending

After the showcases and sales for a visitor, and after the two-week line for somebody signed in, and
before Trending: what is coming over three months before what is being played today. A game on
somebody's own line may be on this panel too, which is the panel saying it is a big one. The heading says
what it measures: "The new games most followed on IGDB, out in the next three months".

## Evidence

Read live on 2026-10-25, for the window from that day to the end of Q1 2027:

| | |
|---|---|
| New games first released in the window | 3,546 |
| …with any `hypes` | 881 |
| …passing the rules | 397 (437 were known only to a year) |
| `hypes` of the 1st, 5th, 10th, 20th, 50th | 1,111, 80, 48, 20, 7 |
| Candidates the production query returns | 90, in one page of 500 |

The ten: Phantom Blade Zero, The Legend of Zelda: Ocarina of Time (the Switch 2 remake), Grand Theft
Auto VI, Rayman Legends Retold, Acts of Blood, Ananta, Stranger Than Heaven, Inzoi (in early access on PC,
its full release on PS5 in Q1 2027), Lords of the Fallen II and Out of Words — PC, every PlayStation, Xbox
and Switch 2, and mobile. Hela: Of Mice & Magic, at 48 follows, was eleventh. The most
followed of the year-only games the rules left out were Witchbrook (71), Mudang: Two Hearts (61) and The
Duskbloods (59).

## Consequences

- **`hypes` is a field IGDB could remove**, and a removed field filters to zero rows with no error. The
  service logs a warning when the query answers nothing, and the panel is then not drawn.
- **"Want to Play" is the fallback** if `hypes` stops reading as anticipation: the rules stay, and the
  ranking becomes a second query.
- **A game in early access is shown for its full release**, on the platforms that full release is for:
  Inzoi's was PS5 alone, its PC version being in early access still.
- **The Lighthouse audit is unchanged.** Its IGDB stand-in answers any games query with long-released
  games, which the rules drop, so the audited home page has no panel.
- **After launch, members become a second input**: how many have a game on their wishlist, as #197 plans
  for scores. Until there are enough of them, IGDB's follows are the only count there is.
