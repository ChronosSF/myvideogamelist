# 0072. Steam news is a game's own announcements, not the press Steam collects

**Status:** Implemented.

## Context

Every news item the site shows comes from Steam's `ISteamNews/GetNewsForApp`, one request per game,
through `SteamNewsService` ([0012](0012-steam-news-without-a-database.md)): the home page's rail, `/news`
and a game page's panel. Asked with no filter, Steam answers each game's own announcements mixed with
articles from the press it collects. Each item says which feed it came from: `feedname`
`steam_community_announcements` with `feed_type` 1 for what the game's developer or publisher posted, and
`feed_type` 0 for an outlet.

`/news` was full of Russian articles. Rebuilt live on 2026-10-25 for a test account's lists, as the
service builds it — the first twelve of its games on Steam, newest first, three a game:

| | `/news` | The home rail |
|---|---|---|
| Items fetched | 99 | 72 |
| The games' own announcements | 40 | 37 |
| PlayGround.ru and Gamemag.ru, in Russian | 32 | 9 |
| PC Gamer, Rock Paper Shotgun, PCGamesN, SteamDB, GamingOnLinux | 27 | 26 |
| Items shown | 20 | 8 |
| …in Russian | 10, and 10 of the first 12 | 1 |

The two pages run the same code. What differs is the games. The home rail's are the most-played games on
Steam, online games whose developers post patch notes and events every few days, so their announcements
are the newest items and win. A person's list is mostly single-player games — Elden Ring, Red Dead
Redemption 2, Silksong, Baldur's Gate 3 — whose developers post rarely, so the press wins, and
PlayGround.ru writes about every big game every few days. A game page has the same problem: Elden Ring's
three newest items were all PlayGround.ru's.

## Decision

**Steam is asked for the games' own announcements only**, with `feeds=steam_community_announcements`,
seen live to answer nothing else. One request parameter in `SteamNewsService`, which every reader goes
through, so the three places change together.

What was rejected:

- **Leaving out the Russian outlets by name.** Steam can add an outlet in any language on any day; two
  were found on the day this was looked at, and a list of exclusions only learns of the next one from a
  reader.
- **Announcements plus a list of English outlets.** It keeps the most interesting articles, but those
  outlets cover PC games only, and one story then shows up once from each of them beside the
  announcement it is about.
- **Guessing each item's language.** A heuristic over a headline, for a feed that has a field saying
  where each item came from.

## Consequences

- **The home rail is unchanged in kind**: patch notes and events, which is what its heading already said.
- **`/news` gets older and more promotional for single-player games.** On the day above its newest item
  was three weeks old, and it held figurines, pre-orders, sales and store pages beside the patch notes,
  reaching back eleven months. That is what the developers said, and the pages' own wording — patch notes
  and announcements from Steam — now describes all of it.
- **Every card's source reads "Community Announcements"**, Steam's label for the feed, where it used to
  name an outlet on some.
- **The news is still Steam's alone**, so a game not on Steam has none. Whether the site keeps it at all
  is the home page's reshaping, and news from other sources is #205.
