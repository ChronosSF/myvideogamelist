# 0073. The home page: a welcome, Coming soon and Just out, and the news last

**Status:** Implemented.

## Context

Before launch the owner settled what the home page is. As it stood on 2026-10-25, from the top:

- **A visitor** got the landing hero, drawn over the background art of whichever game topped Steam's
  24-hour peak players ([0012](0012-steam-news-without-a-database.md)), then the showcases and sales of
  the next two weeks ([0063](0063-the-showcases-and-sales-for-everybody.md)).
- **Somebody signed in** got Welcome back instead: their counts, Continue playing, Play next, and Coming
  up, the two-week line of their own games' releases.
- **Both** then got Coming soon ([0071](0071-coming-soon-is-what-igdb-says-people-are-waiting-for.md)),
  Trending — Steam's 24-hour peak players again — and the Steam news about those same games.

Three of those parts came from Steam, so the front page read as a PC site: a Switch or PlayStation game
could never appear in them (#205). The owner's calls:

- **The hero goes.** In its place, a panel driven by no game and no service, that asks a visitor to make
  an account or sign in.
- **Trending goes, unless it can be had from a source that is not one platform's.**
- **Coming up and Coming soon stay apart** for somebody signed in. The line is two weeks, by the day, of
  games the reader chose; Coming soon is three months, often by month or quarter, of games they did not.
  Merged, either the line stops being this fortnight or the panel shrinks to the one or two games of it.
- **The Steam news stays for now**, limited to the games' own announcements
  ([0072](0072-steam-news-is-a-games-own-announcements.md)), and goes last.

## Decision

### 1. A welcome panel, drawn from the palette alone

What the site is for, three things an account keeps — the lists and a backlog in one's own order, a
wishlist that says when its games come out, and the year's counts — and two buttons, "Create an account"
and "Sign in", with a link to browse the games first. Beside it, on a wide screen, the default share
image's drawing: a list of five rows in the status colours with nothing real in them. No game's art, so
nothing to credit and nothing a source can take away; and the image a link is shared with and the page it
opens look like one thing.

The sign-in and sign-up dialogs were the navbar's own state. They move into an `AuthDialogProvider` around
the navbar and the pages, opened through `useAuthDialog`, so the panel opens the same pair the navbar does.

The server render still has no cookie, so somebody signed in sees the panel until auth answers, as they
saw the hero. It now costs a block of text rather than an image, and #389 plans the fix: two cached
copies of the page, chosen by a signed-in flag.

### 2. Just out in place of Trending: the new games most watched on Twitch

IGDB's `popularity_types`, read live on 2026-10-25, with the top of each:

| Type | Source | Its top | Verdict |
|---|---|---|---|
| 1 "Visits" | IGDB | Fart Together, Roblox, Gartic Phone, and adult titles | Rejected, as in 0012 |
| 2 "Want to Play" | IGDB | Cyberpunk 2077, GTA VI, Red Dead Redemption 2 | All-time favourites, not what is new |
| 3 "Playing" | IGDB | Roblox, GTA V, Minecraft, Fortnite; Marbles on Stream at 14th | Barely moves; 3 of its 500 out in the last ninety days |
| 4 "Played" | IGDB | GTA V, The Witcher 3, Portal 2 | All-time |
| 5–10 | Steam | Players, reviews, top sellers, wishlists | One platform's |
| **34 "24hr Hours Watched"** | **Twitch** | Aion 2, ARC Raiders, Tibia; Marbles on Stream at 8th | **Chosen, for new games only** |

Type 34 is new since 0012 compared the types. Its raw top mixes this year's games with long-running
streams, but its 500 held 78 games first released in the last ninety days, and those read as what people
are playing now, on every platform. So the panel is Coming soon's mirror:

- **New games only**, Coming soon's four game types and no `version_parent`.
- **First released in the last ninety days, before today**: a full release on a known day. Early access
  and the paid early start are not the release — Enshrouded, in early access since January 2024, is out on
  the 15th of October 2026, its 1.0 — and a game out years ago with a new platform in the window is not
  just out, nor is one whose full release IGDB knows only to a month, quarter or year that ended before
  the window: an older game dated only "2019" is out, and its port is not news for everybody. That could
  hide a new game whose planned date IGDB never came back to on one platform; none of that day's seventy-one
  had such a row, and an old game on the front page as new is the worse mistake. A game out today is still
  Coming soon's, so the two panels meet on today and never share one.
- **The nine most watched**, shown newest first, so the panel reads back from today as Coming soon reads
  forward; each with the day and the platforms it is out on. Ten until 2026-10-29, when nine was found to
  be what fills the redesign's grid at every width it is drawn at
  ([0075](0075-the-editorial-redesign.md)); ten left a hole in its last row.
- **No floor beside the cap.** IGDB's follows and ratings are small for a game this new — Madden NFL 27,
  eighth most watched, had two follows and one rating, and Enshrouded, first, had no follows at all — so a
  floor on either would cut what people are playing. The admin's hides are the correction, and are
  Coming soon's own: a game hidden is off the home page, on both panels, and a failure to read them leaves
  both out.

Two IGDB requests a day, since a popularity row cannot be filtered by its game's release dates: the 500
most watched, then which of them have a release row in the window. Cached for the UTC day, as IGDB
calculates the figures once a day; the rules run on every composition. It degrades as every part does: a
failure costs the panel and marks the page degraded, and no game passing is an answer.

### 3. Steam's most-played games pick the news, and nothing else

Type 5 is no longer shown. The home composite still asks for its top twelve — as many feeds as the news
asks Steam for at once — because those are the games whose announcements make the news: they post every
few days, so the news is never empty while Steam and IGDB are well, which is still how an outage is told
from a quiet day. Its heading now says so: "Patch notes and announcements from the games most played on
Steam". The spotlight and the trending games leave `/api/home`; an older API still sending them mid-deploy
has them dropped by the loader, and one without Just out is degraded, as one without Coming soon was.

### 4. The order

| A visitor | Somebody signed in |
|---|---|
| The welcome panel | Welcome back: counts, Continue playing, Play next, Coming up |
| Showcases and sales, the next two weeks | — on the line already |
| Coming soon | Coming soon |
| Just out | Just out |
| Latest news | Latest news |

## Evidence

Read live on 2026-10-25:

| | |
|---|---|
| Games in type 34's top 500 with a release row in the ninety days | 95 |
| …passing the rules | 70 |

The ten, newest first: Tenebris Somnia, Castlevania: Belmont's Curse, Chained Beasts, Enshrouded, Gears of
War: E-Day, Ace Combat 8: Wings of Theve, Control Resonant, Silent Hill: Townfall, Dressmaker and Madden
NFL 27 — on PC, PlayStation, Xbox, Switch and Switch 2. Transport Fever 3 was eleventh. Lower down were
games streamed more than played — One Million Coins at eighteenth, Thank You Bus Driver at twentieth —
which the cap kept off.

## Consequences

- **Watching is not playing.** What streams well — multiplayer, horror, the strange — can outrank a long
  single-player game more people are playing. The heading says what is measured: "The new games most
  watched on Twitch, out in the last three months".
- **Type 34 could go as type 5's peers might.** A popularity type IGDB stops answering is no rows and no
  error; the service logs that once a day, and the panel is not drawn.
- **#205 is half done.** Trending is now from every platform; the news is still Steam's, by decision.
  #203's Twitch highlights would build on type 34.
- **The Lighthouse audit's home page has no image to wait for.** Its IGDB stand-in answers any popularity
  query with long-released games, which Just out's rules drop as Coming soon's do, and it never had news, so
  it audits the welcome panel and little else. The audits its images and its rail passed stopped applying,
  so its accessibility on a phone rounds a point lower with nothing worse on it (`lighthouse/budgets.ts`).
- **[0012](0012-steam-news-without-a-database.md)'s trending rail and [0071](0071-coming-soon-is-what-igdb-says-people-are-waiting-for.md)
  §5's "before Trending"** are superseded here; both carry a note.
