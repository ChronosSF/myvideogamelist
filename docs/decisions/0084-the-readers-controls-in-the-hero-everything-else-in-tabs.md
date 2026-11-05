# 0084. The reader's controls in the hero, everything else in tabs

**Status:** Implemented — closes #450 and #245; the UI half of #222.

## Context

The game page kept everything a reader records about a game in a sidebar: the five lists, the wishlist, the
favourite, the score, how they have the game, their tags, notes, playthroughs and review, and a delete for
all of it. Measured on 2026-11-04 at 1440×900, that panel was 320 pixels wide and 1,884 tall, the playthrough
form alone 580 of them, always open; the review was written in a box the sidebar's width. On a phone the
sidebar stacked under the main column, so the panel began 6,375 pixels down, after Similar games. The owner
found writing a review there awkward, and wanted the game's series (#450) high enough to be seen before any
scrolling. The profile page had the same shape: its settings were a 20rem column three times as tall as the
tracking beside it.

Two layouts were weighed on a design canvas: everything in the main column, and tabs. A third, a compact
panel that opens the review and playthrough forms in dialogs, was set aside: it fixes the width but gives the
reader's record of a game no place of its own, and a long review in a dialog is one stray Escape from lost.
The owner chose tabs, with the controls a reader uses on most visits kept out of them.

## Decision

### 1. The list, the score, the wishlist and the favourite are one row in the hero

`GameTrackingRow`, under the title and the aggregate scores. Those four are what a reader does on most visits,
and one row of them fits a phone's first screen, where the panel did not. The hero is shorter to make room:
`clamp(320px, 30vw, 420px)`, the title a step smaller at `lg`. It is opaque, and stands where the top of the
reader's pattern ([0082](0082-a-look-is-a-palette-a-pattern-and-a-tint-kept-on-the-account.md)) is drawn, so
that end is not drawn on the game page: all of it that showed was its faint tail under the tabs, beside a
poster it was never drawn to go with. The foot's is.

The row is drawn the same size in all three of its states. The page is shared at the edge
([0013](0013-http-caching-policy.md)), so its server render, and the first render in the browser, cannot
know who is reading: they draw the controls disabled with a blank line under them. A reader signed out gets
the same controls, live, each opening the sign-in dialog — the Backlog, the stars, the heart and the rosette;
only the select of the other lists waits. A signed-in reader gets theirs. Only words change,
and the line under the row is one line in each state, so nothing moves when auth answers. On a phone the list,
the heart and the rosette share the first line and the stars take the second.

### 2. The list is a native select, with the Backlog one press away

`ListPicker`. Five toggles in a row grow with the reader's own names for the lists
([0031](0031-a-list-rename-is-a-label-its-owner-sees.md)), which can be long, and would wrap the hero's row; a select is
one control of one width whatever the names, and brings the keyboard, the screen reader and the phone's own
picker with it. A game in no list is offered the Backlog in one press, as every card on the site offers it
([0075](0075-the-editorial-redesign.md)), with a select of the other four beside it. A game in a list shows it,
filled, with every list and "Take out of …" in the select. Changing list is one press more than the toggles
were, which the hero's room and the rename were worth.

### 3. Two tabs, each an address of its own

`PageTabs`: **Overview** at `/games/:id` and **Your game** at `/games/:id/yours`, as child routes of the game
page, which keeps the loader, the headers, the meta and the error boundary. Links rather than an ARIA tab set,
because each is a page a link can name and the back button can return to: the lists can link straight to a
game's review. Moving between them keeps the reader's place (`preventScrollReset`), since the hero is the same.

Your game is the reader's own: `noindex`, so it names no canonical URL ([0036](0036-what-a-crawler-is-told.md)),
and `private, no-store`. Its server render is the same for everybody — the entry is read after hydration, as
the panel's was — but nothing about its address is worth a shared copy. The Overview child declares no
`headers` and inherits the game's: React Router uses the parent's when a child has none.

### 4. The reader's entry is one provider, read by the row and the tab

The panel's state and handlers are `GameEntryProvider`'s, unchanged in what they do, so that a score set in
the hero and a delete in the tab agree. It is still keyed on the account and the game, the guard the panel
relied on: every write settles after the click, and the page stays mounted from one game to the next
([0022](0022-entry-surrogate-key-and-the-wishlist-axis.md)). Keyed at page level it would remount the whole page when a
signed-in reader's auth answered after hydration, refetching the completion times and the news; so it wraps
the hero, the tabs and the Your game tab, and the Overview tab sits beside it, outside. A signed-in reader's
arrival remounts the hero and nothing that fetches. Its stylesheet keeps the panel's name and class prefix,
`GameUserPanel.css` and `game-user-panel-*`, which the forms it styles share.

### 5. Overview: the series first, then a reading column beside the facts

The related games (§6) open the tab, in view at 1440×900 without scrolling. Under them, the description, the
completion times and the members' reviews, brought up to third, then where to play, the trailer and
screenshots, the add-ons, the news and the similar games. Genres, themes, platforms, play modes, developers and
publishers move into the facts rail beside it, which suits scanning and took six short sections out of the
reading column.

### 6. Related games: the series, the remakes, the editions

`GameDetailsDto.Related`, from one more IGDB query per cold game page: the game, the games whose `parent_game`
or `version_parent` it is, and the games in its series — the release spec's relations
([`specs/release-timeline-and-calendar.md`](../../specs/release-timeline-and-calendar.md) §3.2) across all
dates. `RelatedGames.Fold` applies the spec's rules (§3.3) as they suit a page about one game:

- Cancelled and rumoured games are dropped (F4). DLC, expansions, episodes, seasons, mods, forks, packs and
  updates are not cards: the page lists the game's own DLC and expansions apart, and the rest are not another
  game in the series (F1, F2).
- An edition — a main game or a bundle naming another as its `version_parent` — is that game (F3). The
  anchor's editions are a line of links under the rail; anybody else's are dropped. The Witcher 3's "Game of
  the Year Edition" and "Complete Edition" are bundles, so a bundle of the anchor's counts as an edition here,
  where the calendar drops bundles.
- An expanded game or a port of another game in the series is folded into that game, up a chain of them,
  or The Witcher's series would show "The Witcher: Enhanced Edition" and its "Director's Cut" beside The Witcher.
  One of the anchor's own is a card. A remake or a remaster is always a card: "The Witcher Remake", "The Witcher
  3: Wild Hunt Remastered".
- On an edition's page the anchor is the game it is an edition of, marked "Its original".

Each card carries the wishlist and the Backlog ([0075](0075-the-editorial-redesign.md)), or the list the game
is in. "Add the N you don't track to Backlog" adds every game in no list, one after another, never moving one
that is, and asks first past five. A series is cards in one rail in release order; one long enough that this
game would be past a desktop's first seven opens three games before it, with the earlier ones a press away,
rather than scrolling itself there, because a rail that scrolls itself as the page loads ends the largest-paint
measurement (issue 315). Super Mario held 123 games on 2026-11-04.

The answer is cached for six hours apart from the game's half hour. A failure is a null `Related`, which the
loader reads, like a missing one from an older API, as a render to keep off the edge
([0070](0070-nothing-shows-as-a-blank.md)), and it is kept for a minute: kept with the game, it would degrade
every render for half an hour, the completion times' way that #352 records, and kept not at all, every render
of a page nobody may cache would ask IGDB again while it fails.

### 7. Your game: the review at the reading column's width

The review is written in a box sized for prose. The playthroughs sit beside it, their form opened by Add or a
run's Edit and closed by Cancel (#222's UI pass); a form opened already editing shows the run, and a run on a
platform the game no longer lists says "Unlisted platform" rather than "Not recorded" while sending the old id.
How the reader has the game, their tags and notes share a row under them. Deleting a review or a run asks first
(#245), as deleting everything already did.

### 8. The profile: Your tracking and Settings

The same move, the same `PageTabs`: **Your tracking** at `/user`, at the page's full width, and **Settings**
at `/user/settings`, as one page of sections with an index held beside them, as the calendar's month is
([0075](0075-the-editorial-redesign.md)), two short settings to a row. The header says who the reader is to
everybody else: their picture, handle, and whether anybody can read their profile.

## Consequences

- The game page is two routes, `GameOverviewPage` and `GameYoursPage`, under `GamePage`, and what they share
  is `GamePageOutlet` (`@/lib/gamePage`). The profile's two are `UserTrackingPage` and `UserSettingsPage`
  under `UserPage`, with `UserPageOutlet`.
- Anything that shows the reader's own record of a game reads `useGameEntry()`; it is null outside the
  provider — signed out, and before auth answers — and a consumer draws its signed-out form on null.
- The game page's related games cost one IGDB query per cold page, under the same limiter as the rest.
- The browser smoke test chooses a list in the select. The Lighthouse harness answers The Witcher 3's related
  query with IGDB's own answer, recorded on 2026-11-05 into `lighthouse/igdb.json`, so the audited game page
  draws the series rail it draws deployed, fourteen covers and the editions; any other game's gets nothing,
  as IGDB would answer for a game in no series.
- Moving a game to Finished still does nothing to an open playthrough. That automation, and a prompt after a
  list move that offers the matching change to a run, are #222's.
