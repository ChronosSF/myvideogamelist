# 0104. Just out takes the games people followed beside the most watched, and the admin's pin

**Status:** Implemented; not yet deployed. Amends
[0073](0073-the-home-page-a-welcome-coming-soon-just-out-and-the-news.md) §2, whose panel was the most
watched on Twitch and nothing else, and [0071](0071-coming-soon-is-what-igdb-says-people-are-waiting-for.md),
whose pin was Coming soon's alone.

## Context

On 2026-11-22 the owner asked why Grand Theft Auto VI, out three days, was not on Just out. Everything
below was read from live IGDB that day, with the panel's own queries.

**The game passes every rule of ours.** IGDB has it as a main game with no `version_parent`, and two
release rows, PS5 and Series X|S, both full releases known to the day, 19 November.

**It never reached them.** The panel's first query is IGDB's five hundred most watched games on Twitch,
popularity type 34. IGDB's figure for the game, calculated that day, was 0.00000025; the five-hundredth
game's was 0.000226. IGDB links the game to its Twitch category, so the figure is not missing for want of
a link. How IGDB arrives at it cannot be seen from outside.

**It is not one game.** The same figure was 0 for Grand Theft Auto V, League of Legends, Fortnite and
Valorant, 0.0000286 for Dota 2, and Counter-Strike 2 had no row. Of the season's releases, Call of Duty:
Modern Warfare 4, out 23 October, had 0.000001 and Phantom Blade Zero, out 29 October, 0.0000015. So the
count 0073 chose does not see the largest games, and the panel was missing each of them as it came out.

**What it showed instead**, the nine most watched new games: EA Sports FC 27, Sonic Pico Park, Probably
Stolen, Queen's Domain, NBA 2K27, Moon Sweepers, Football Manager 27, Potato Please and Playrooms. IGDB
counted between none and fourteen follows for each ahead of its release.

**IGDB's other counts, the same day:**

| Count | Grand Theft Auto VI | As a panel |
|---|---|---|
| 1 "Visits" | First of all games, thirty times the next new one | Still what 0073 rejected: Krillion Space, Empty Box and Pusheen's Place are in its first seven new games |
| 3 "Playing" | First of the new games | Five new games in its five hundred |
| `hypes`, the follows ahead of release | 1,584, the most of any | Below |

`hypes` is the count Coming soon already ranks by. Asked for the new games with a release row in the
ninety days and twenty follows or more, Coming soon's floor, IGDB answered 69, of which 38 passed Just
out's first-release rule:

| Follows | Game | Out |
|---|---|---|
| 1,584 | Grand Theft Auto VI | 19 November |
| 292 | Marvel's Wolverine | 15 September |
| 272 | The Blood of Dawnwalker | 3 September |
| 242 | Control Resonant | 24 September |
| 227 | Phantom Blade Zero | 29 October |
| 187 | Onimusha: Way of the Sword | 4 September |
| 128 | Resonance: A Plague Tale Legacy | 27 August |
| 115 | Gears of War: E-Day | 6 October |
| 105 | Silent Hill: Townfall | 24 September |

Twenty of the 38 had fifty follows or more, nine a hundred, five two hundred. Sixteen were also among the
Twitch candidates, the highest of them Control Resonant at nineteenth. **None was in the nine the panel
showed.** The two counts see different games: what streams well, and what people were waiting for.

## Decision

### 1. Two counts, turn about, the followed first

The panel's nine are taken one from each list in turn: the most followed, the most watched, the next most
followed, and so on, five and four when both lists are long. A game on both is taken once, where it comes
first, and the list that would have given it again gives its next. Shown as before, the newest first.

On 2026-11-22 that is Grand Theft Auto VI, EA Sports FC 27, Marvel's Wolverine, Sonic Pico Park, The Blood
of Dawnwalker, Probably Stolen, Control Resonant, Queen's Domain and Phantom Blade Zero.

- **The followed are held to Coming soon's floor**, twenty follows, by the same constant: a game Coming
  soon could have shown is one Just out can. In a busy season the floor does not bind, since the fifth
  most followed had 227; it is what keeps a quiet one from filling with games nobody was waiting for.
- **The watched keep no floor**, for 0073's reason: IGDB's counts are small for a game this new.
- **Not the followed alone.** They would be the panel in any season with nine such games, and the games
  people are in fact playing, which is what 0073 wanted of it, would never be seen. And a game nobody saw
  coming has no follows to be found by.
- **Not the watched alone**, which is 0073 and the reason for this record.
- **Not "Visits" or "Playing".** The first is 0073's rejection, still true; the second holds too few new
  games to be a list.
- **Not one score from both.** A follow and an hour watched have no common unit, and IGDB's values are
  shares whose scale it does not publish. A weight between them would be a number nobody could defend.
- **The followed first**, so that the odd place of nine is theirs: of the two, it is the list that held
  the game the panel was most wrong to miss.

The follows stop at a game's release, so the followed half moves only when a game enters or leaves the
ninety days. The watched half is IGDB's daily figure and moves daily.

### 2. A pin carries onto Just out

The admin's pin is Coming soon's, the one row a game in `ComingSoonPicks`, and now it holds on both
panels: a pinned game is on Coming soon until it is out, and on Just out for its ninety days after, ahead
of the rest, for as long as the pin is kept. A game can also be pinned once it is out, which the admin
page already allowed, since it only ever asked that IGDB has the game.

- **It carries a game past both counts and never past the rules**: a new game, with a first full release
  known to the day inside the window. Coming soon's pin is the same.
- **Not a second kind of pin for the second panel.** One row a game is what makes "pinned or hidden,
  never both" true, and a game pinned on purpose before its release is one the owner wants seen after it.
  The cost is that a pin made for Coming soon holds a place on Just out for three months unless it is
  taken off, and the admin card says so.
- **The hide is unchanged**: off both panels.

The pin is for what neither count finds: a large game that arrived unannounced, or one both counts rank
low. That day Call of Duty: Modern Warfare 4 was such a game, eighteenth of the followed with 61.

### 3. Three requests a day, and either count can go

IGDB is asked three things: the five hundred most watched, which of them have a release row in the window,
and the games in the window with twenty follows or more, most followed first, with the pinned games by
their id. The third is Coming soon's query facing backwards. They are kept for the UTC day and, since a
pin changes the question, for the set of pins.

A popularity type IGDB withdraws is no rows and no error, and so is a field it removes. Each list coming
back empty is logged once a day, and the panel is then the other list. 0073 had the panel not drawn when
type 34 went; now it would take both going.

### 4. The heading says both

"The new games most followed on IGDB and most watched on Twitch, out in the last three months", beside
Coming soon's "most followed on IGDB, out in the next three months".

## Consequences

- **The largest releases are on the panel the day after they come out**, without anybody acting, where
  people followed them. Grand Theft Auto VI leads it on the day this was written.
- **Five of the nine can stand for weeks.** The most followed game of a season stays the most followed for
  its ninety days. 0073 accepted the same of a game that stays the most watched.
- **Four fewer of the watched.** What the panel loses is the fifth to ninth most watched, which that day
  were NBA 2K27, Moon Sweepers, Football Manager 27, Potato Please and Playrooms.
- **A pin left on is a place taken.** Nothing takes a pin off when its game comes out.
- **What IGDB's Twitch figure is remains unknown.** If it comes to count the largest games, the two lists
  will overlap more and the panel will simply have fewer distinct sources; nothing here depends on it
  staying wrong.
- **The harnesses are as they were.** The Lighthouse stand-in answers the third query with the games it
  answers every other with, long released, and the smoke test's with none.
- **Not proved by a deploy.** The rules run against rows recorded that day, the three queries were sent to
  live IGDB as the service writes them, the pinned form among them, and the panel was looked at on a local
  server. Dev shows it after its next deploy.
