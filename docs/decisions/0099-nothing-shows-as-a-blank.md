# 0099. Nothing shows as a blank: empty and error states that teach, skeletons, and covers at their size

**Status:** Implemented — #127, its first and third points. The number is a placeholder, to be given
the next free one when this merges.
**Amends:** [0028](0028-a-games-community-view.md) §3, its sentence that a game with scores under the
floor and no reviews shows no section at all; and §6, that a reload keeps what is on screen

## Context

#127 asked for empty and error states "in the pattern the lists page has" on the game and profile
pages, and for skeleton loaders and sized, lazy cover art. Four things stood in the way.

**A blank said three things.** The game page's member section rendered nothing until its two
requests answered, nothing when nobody had scored or reviewed the game, and nothing when both requests
failed. 0028 §3 chose the second on purpose, since "too few to show" would have been its only content.
A reader cannot tell any of the three from the others.

**A failed game page left the site.** The loader's 404 and 502 went to the root ErrorBoundary, which
renders outside the providers and so without the navbar: an IGDB outage read "502 Bad Gateway" with one
link home. The profile's did the same.

**Its error responses could be cached.** The game route's `headers` answered `CACHE_GAME` whatever
happened. A document's error went out through the root boundary, which honours the thrown Response's
own policy. A client-side navigation's `.data` request does not: single fetch keys an error to the route
that threw it, so the game route's `headers` answered for it. Measured on 17 October 2026,
`/games/999999999.data` came back 404 with `s-maxage=3600`. A 502 takes the same path, so an IGDB
outage reached that way would have gone out marked shareable for an hour. 0013's Result, that error
responses are `no-store` in every case, held for documents only.

**Every cover was the biggest.** The API sends each cover as IGDB's `t_cover_big`, 264 pixels wide, and
every card loaded that, down to the 36-pixel thumbnails in the list table. Pages that load in the browser
showed a spinner in a box of its own size, and then jumped to the content's.

## Decision

- **One empty state and one error state, lifted from the lists page.** `EmptyState` says what is missing
  and what would put something there. `ErrorState` says what failed and offers "Try again" wherever
  retrying could help, as the wishlist and news pages already did. At the size of a page it is an alert,
  as theirs are, so one that replaces a page after a client-side navigation is announced. Inside a
  section it is not, since the page around it rendered fine. While a retry is out its button keeps its
  place and its focus. Each has a page size and a section size. The lists page uses both, and its failure
  gained the retry, which moves focus to the tab whose list is loading, since the skeleton takes the
  button's place. The wishlist and news pages keep their own markup for now.
- **The game and profile pages render their own failures, inside the site.** Each route has an
  ErrorBoundary, so the navbar stays. A 404 says what would put something at the address and offers
  browsing, with no retry, since asking again will not make it exist. On a profile the words fit a
  private profile and an unclaimed name alike, which 0027 §7 makes one 404 on purpose. A `?page=` that
  names no page of reviews is the same 404 (0027 §9) with words of its own. That gives nothing away:
  a malformed number is refused before the profile is asked for, and a page past the last only after
  the profile has answered as public. A failure retries through the router's revalidation, and the page
  replaces the error the moment its loader answers. The game page tells whose failure it was by the API's
  status (0034). A 502 is IGDB's, so it says lists and profiles keep working without it. A 503 is our own
  throttle on IGDB, so it says "busy, try again in a moment". Anything else is ours.
- **A route with an ErrorBoundary owns its errors' headers.** Its `headers` hands on whatever the loader
  decided, through `errorHeaders` or `loaderHeaders`. The loader states its success policy with `data()`,
  and anything else the loader throws fails closed to `private, no-store`. That also fixes the `.data`
  responses above, and the games page's `headers` fails closed the same way. A page that throws while it
  renders, after its loader answered, is outside this. React Router has worked out its headers already,
  for every route, and that is #337.
- **The member section is always there (amending 0028 §3).** It shows a skeleton until both requests
  answer, then what members have said. When nobody has, it says what would change that, under the floor
  included: "Only 2 members have scored this so far. A member score is shown once 5 have. Reviews show
  here as members publish them." When one half failed it says so beside the other. When both did, it
  says so and offers a retry. Its states share one least height, so the commonest answer, nothing yet,
  moves nothing below it.
- **A retry after a total failure shows the skeleton again (amending 0028 §6).** There is nothing on
  screen worth keeping, and a failure left up under its button would look as though the button did
  nothing. Every other reload keeps what is on screen, as §6 says, and a half that had failed says
  "Trying again…" while it is out. A retry moves focus to the section's heading, since the button it was
  on gives way.
- **A public profile with nothing on it says so once.** It shows one sentence in place of a page of
  dashes and empty bars, as the owner's own profile already does. The test is narrower than `meta`'s and
  the sitemap's: a profile with only a wishlist is not worth indexing, but it has something to show, its
  size, so it keeps its sections. Every empty section says what will fill it, and never asks a visitor to
  do it.
- **Skeletons replace the spinners, drawn in the content's own boxes.** A card skeleton uses the card's
  frame, cover box and body classes. Its text lines are `h-lh`, so they take the line height of the type
  around them. The table skeleton is the table's own markup. Where a line in the page's header waits on
  the same data, as the wishlist's count does, a skeleton line keeps its place. The fill is
  `--color-raised`, with one sheen of translucent white across each skeleton rather than one per shape, so
  a page of twelve cards animates twelve things rather than a hundred and sixty-eight. The sheen stops for
  `prefers-reduced-motion`. `LoadingState` carries the words as a status. It is not `aria-busy`: it is
  replaced rather than updated in place, so nothing would clear the flag, and a screen reader may hold
  back what a busy region holds, the words included. The games grid stays while the next page loads into
  it, continued by six card shapes, a row at its widest, and it is the one place marked busy.
- **Covers come at the smallest size that fills their box.** The srcset offers `t_cover_small` (90w),
  `t_cover_small_2x` (180w) and `t_cover_big` (264w). Each size was loaded from images.igdb.com for
  fifteen covers sampled from `CachedGames`, and every one came back 3:4 at exactly those widths.
  `t_cover_big_2x` is left out: retina screens would take it for most cards, at three times today's
  bytes. Each call site states the `sizes` its CSS draws the cover at. Covers below the fold are
  `loading="lazy"` and `decoding="async"`, and their `sizes` begins with `auto`: a lazy cover is fetched
  only once it is laid out, so a browser that knows the keyword takes the width it is really drawn at, and
  one that does not skips it for the stated value. The largest first paint is never lazy: the game page's
  cover, the first row of a grid or a rail, and a profile's favourites.

## Alternatives

- **Keep 0028 §3's silence for the empty case.** It was right while silence meant one thing. Once the
  section shows a skeleton, silence after it would also be a blank where the skeleton was, and the page
  under it would move up.
- **Improve the root ErrorBoundary instead.** It renders outside the providers, so it cannot have the
  navbar, and it serves every route. A route's boundary says what that route's failure means.
- **A srcset for the key art.** The home hero and the game page's background are IGDB's `t_1080p`, and
  `t_720p` would suit a phone. But those two sizes fit an artwork into a box rather than to a width: a
  wide artwork came back 1280×413, a tall one 568×720. A `w` descriptor would claim a width the file does
  not have. Both stay as they are, loaded with the page.

## Consequences

- A small card loads about a fifth of the bytes it did: `t_cover_small` averages 4 KB against
  `t_cover_big`'s 21 to 23. The rails and the calendar take `t_cover_small_2x`, at about 12 KB, on a
  standard screen. A cover drawn wider than 180 pixels at 1× density still takes `t_cover_big`, as before,
  and retina screens take what they took before or less, so no card got heavier.
- None got softer either, in the browser it was measured in. With a 2× screen emulated, Chrome 152 took
  the smallest candidate at least twice as wide as the cover is drawn, at every width tried from 40 to
  140 pixels: `t_cover_small` up to 45, `t_cover_small_2x` up to 89, and `t_cover_big` beyond. The
  standard leaves that choice to the browser, so another may trade sharpness for bytes differently.
  Sharper covers on retina screens are a decision of their own, with their own byte budget, as
  `@/lib/coverArt` says.
- `sizes` is worked out from each component's CSS and has to change when it does. The games grid keeps
  its classes and its `sizes` together in `@/lib/gameGrid`.
- Skeleton heights match by construction where they reuse the content's classes. The list table's and
  the news cards' skeletons measured identical to what replaced them. A card skeleton is the card a row
  usually ends up as, and a grid row takes the height of its tallest card, so a row of skeletons came
  within a few pixels of a row of games, the same at phone and desktop widths. The calendar, account and
  admin skeletons approximate pages that fill in stage by stage.
