# 0094. The community figures are withheld below their floors, by the API: the count travels, the figure does not

**Status:** Implemented. [#471](https://github.com/ChronosSF/myvideogamelist/issues/471), answering
[#144](https://github.com/ChronosSF/myvideogamelist/issues/144) and the question
[0028](0028-a-games-community-view.md)'s consequences left open. A deliberate exception to
[0016](0016-scores-carry-their-sample-size.md) for the two community endpoints. Replaces the client-side
floors of 0028 §3 and [0025](0025-playthroughs-and-reviews.md) §2.

## Context

- **Both community endpoints count every member, private profiles included.** `/api/games/{id}/community-scores`
  does since 0028 §2, and `/community-times` always has (0025 §2): an aggregate names nobody.
- **Both reported any sample faithfully**, as 0016 asks: "the API reports the count faithfully and lets each
  caller set its own bar". The floors lived in the client, `MIN_MEMBER_SCORES` (5) and
  `MIN_PLAYTHROUGH_SAMPLES` (3) in `@/lib/score`.
- **So a game one member scored published that member's exact score**: the mean, and the one column of the
  distribution that was not zero. A tier one member logged published their time. The page hid both. The JSON
  is public, and the scores, the times and the reviews are the three paths dev's basic auth lets through
  ([0044](0044-what-the-deployment-walkthrough-settled.md)).
- **0028 accepted that and named the alternative.** Its consequences call the client's floor "a presentation
  rule and not a privacy boundary", and say the fix would be a server-side floor on both endpoints, which
  contradicts 0016 and so is a decision to make on purpose. #144 asked for it.
- **Dev is about to open to testers recruited on Reddit and Discord**, before production. Every sample there
  will be under the floors for a long while. A tester who says in a channel that they played an obscure game,
  and is its only scorer, has their score readable by anyone who looks: unattributed in the JSON, and
  identified by the conversation.
- **[0025](0025-playthroughs-and-reviews.md)'s promise is private by default.** A profile publishes nothing
  until its owner says so. A figure that is one member's own breaks that promise in substance, whatever it
  is attached to.

## Decision

### 1. The floors are the server's, in `CommunityFloors`

| Constant | Value | Under it |
|---|---|---|
| `MemberScores` | 5 | `/community-scores` sends `Scored` and `Tracked`; `Mean` is null and `Distribution` is empty |
| `ScoreDistribution` | 20 | `Distribution` is empty; from `MemberScores` up, `Mean` is sent |
| `PlaythroughSamples` | 3 | a tier of `/community-times` keeps `Samples`; `MedianMinutes` is null |

- **The count is over the scores the figures are made of.** A score outside 1–10 is in no figure (0028 §3,
  `ScoreSummary`), so it cannot carry a game over a floor.
- **Each tier of the times has its own floor.** Three runs of the main story say nothing about the one
  rushed run beside them.
- **The times' cache keeps the floored answer.** A playthrough saved on the game page still evicts it
  (0025 §6), so the run that carries a tier over the floor brings its median with it. An import's runs and a
  game's record deleted whole do not evict it, as before. Those wait out the five minutes, which every other
  instance does anyway.
- **The values are the client's old ones**, and the distribution's bar is new (§3).

### 2. The count still travels, the figure does not: an exception to 0016

0016's rule was written for IGDB's aggregates, where the API passes on a third party's public figure and the
caller decides what is worth printing. Here the API is the only thing between a member's own row and the
public. So for these two endpoints the bar is the API's, and every caller gets the same one.

The count stays. It names nobody, and it is what the page says instead of a figure: "Only 3 members have
scored this so far". `Tracked` stays at any count for the same reason ([0069](0069-a-crawler-is-told-what-is-ours.md)
§2). 0016 holds as it was for IGDB's figures and for a person's own statistics.

### 3. The distribution waits for a higher bar than the mean

A distribution is the scores laid out by value. Near the mean's floor it is a handful of people's scores, one
by one, read in a single look (0028 §3 said so of the columns under the floor). Somebody who knows who the
five scorers are, testers comparing notes in a channel say, learns from five columns far more about each of
them than from one mean.

So the columns wait for `ScoreDistribution`, where the spread is a game's rather than a roll call. **This bar
does not stop anybody watching.** A column going up by one says what the newest score was, at twenty scores as
at five. §4 accepts that.

**Twenty is a starting point.** It is high enough that a column of one is one score among twenty unnamed
people, and low enough that a game members talk about reaches it. It moves with real numbers, by a change to
this record.

### 4. What a floor cannot stop, accepted

- **Somebody polling a game's mean as scores arrive can work out each new one.** The mean goes out at full
  precision, so the scored count times the mean is the sum, and the difference between two answers is the
  score that arrived between them. The same holds for a column above twenty, without the arithmetic.
- **The scores that are published can be subtracted out.** Every listed review shows its author's score. When
  all but one of a game's scorers have published theirs, the mean minus those scores is the last one. Stopping
  it would mean a floor on the unpublished scores alone, a rule nobody could guess from the page, and polling
  would still work.
- **A median of three is one member's run**, the middle one. That is what a median is, and 0025 §2 chose the
  median knowing it.

These are opinions about games and times spent playing them. They are not sensitive data. 0025's
private-by-default promise is about a person's record attached to their name. The floors keep a figure from
being one member's own as it stands, and that is what the promise asks of an aggregate; working one out
takes somebody set on it, for a score of a game.

### 5. The client keeps its constants for its sentences, and still checks the counts

- **`@/lib/score` restates all three**, `MIN_MEMBER_SCORES`, `MIN_DISTRIBUTION_SCORES` and
  `MIN_PLAYTHROUGH_SAMPLES`, for the sentences that say why a figure is missing.
  `serverMirrors.test.ts` reads them out of `Models/CommunityFloors.cs` and fails when they differ.
- **`hasMemberScore` and the new `hasMemberDistribution` still check the count**, and the second checks for
  ten columns as well:
  - The current API sends nothing under the floors, so these checks change nothing for it.
  - An API from before this record, answering mid-deploy, sends the figures. The page holds them to the same
    floors.
  - An empty distribution is drawn as none at any count.
- **Between the two floors, the member section shows the badge and a sentence in place of the columns**:
  "How the scores spread is shown once 20 members have scored this." It used to draw the columns from five
  scores up.
- **The loader's copy keeps the page's floors** (0069 §1: the copy holds nothing the page would not show).
  `scoresWithinFloor` now also drops the columns under `MIN_DISTRIBUTION_SCORES`. Under either floor its copy
  is the API's answer as sent.
- **The server render under the floors is unchanged.** It read the count and the floor before, and it does
  now. The one difference is in the hydration data, where ten empty columns are now none.

## Consequences

- **0016 holds for IGDB's figures and a person's own statistics.** For the community endpoints the count
  travels and the figure does not below its floor. Its status line points here.
- **0028 §3's floors and 0025 §2's are now the server's.** 0028's consequence that "a small sample is
  readable in the API" no longer holds. Both status lines point here.
- **On dev every game's figures are counts** until five testers have scored it, or three have logged runs of
  a tier.
- **Games with five to nineteen scores lose their columns on the page**, and keep their badge.
- **A floor is changed on the server and in `@/lib/score` in one change**, or `serverMirrors.test.ts` fails.
  Raising one is safe at any time. Lowering one publishes figures that were withheld, and is the decision this
  record made, to be made again.
- **No caller can set a lower bar.** No caller but our own page reads these endpoints today.
- **Not done: rounding the mean** to the tenth of a point the badge shows. At five scores it would leave one
  or two candidates for each new score rather than one, and at ten scores two or three. Above twenty the
  columns give each new score exactly anyway, so it would blur only the window between the two floors. It is
  a one-line change if that window comes to matter.
