# 0021. Stars are the user's own score; every aggregate is a number out of 100

**Status:** Implemented

## Context

A game's score was being shown in two different visual languages, and they were attached to the
wrong things.

Five stars — rendered by two near-identical copies of a `StarRating` component, one in `GameCard`
and one in `GamePage` — showed **IGDB's player rating**, an average of other people's opinions that
nobody using this site can change. The user's **own** score, the only score they can actually
enter, was a `<select>` with the options 1 to 10. So the interactive-looking control was inert and
the plain dropdown was the one that wrote to the database.

The stars were also lossy. `Math.round(rating / 2)` maps a 7.4 and an 8.4 to the same four stars,
so the display quietly disagreed with the number printed next to it.

Meanwhile the critic average was already shown as a number out of 100, in a coloured badge, in
three places with three slightly different implementations. Two aggregates, two presentations, one
question.

## Decision

**Stars mean exactly one thing: a score this user gave.**

Five stars at half-star steps, which is ten values — precisely the 1–10 that
`UserGameEntries.Score` has always held and that `CK_UserGameEntries_Score_Range` enforces. Half
stars are not a new scale, they are the display that makes the existing scale reachable: without
them a 7 is not expressible in stars at all. No migration, no DTO change, no API change.

**Every score somebody else produced is a number out of 100**, through one `ScoreBadge` component.
The critic average already was; IGDB's player rating arrives on a 0–10 scale and is multiplied by
ten on the way in (`ratingPercent`). Two aggregates that answer the same question are now
comparable side by side without the reader converting anything in their head.

**The bands are shared.** `scoreBandSolid`, `scoreBandTint` and `scoreBandSubtle` all read from one
private `band()`, so a score cannot be green on a card and amber in a table. Only the variant that
sits on top of cover art uses a solid fill; a filled pill in two columns of every table row reads
as decoration rather than as data.

### The control is a radio group, not a div with click handlers

Ten `<input type="radio">` under a `<fieldset>`, with the stars painted in an `aria-hidden` layer
above them and ten transparent labels laid over that, each a tenth of the track wide. That buys,
for free and correctly: arrow-key stepping through the scale, one accessible name per value, a
`disabled` that propagates from the fieldset to all eleven controls, and a focus ring on the value
that has focus. A hand-rolled widget has to reimplement all of it, and usually reimplements the
first three badly.

Each control gets its own group name from `useId()`. React restores the checked state of
same-named radios, so a shared name does not surface as a wrong star — it surfaces as arrow keys
walking out of the row being scored and into the next one.

### Why not a component library

Ignite UI for React was the suggested starting point and would have supplied a rating component
directly. It was not adopted, but only one of the candidate objections survives scrutiny, so it is
worth recording which — a future reader should not re-reject it for a reason that turns out not to
hold.

**The reason: server-side rendering.** The `igniteui-react` repository describes itself as the
build process that *generates the React wrappers* for the published packages, and wrapper-style
web-component bindings are the known weak spot for SSR: a custom element's content is produced by
its own JavaScript on the client, so the server sends an effectively empty tag and the control
appears on hydration. On a fifty-row table that is fifty blank cells on first paint, which runs
against [0002](0002-server-side-rendering.md). This is an argument from the library's architecture
rather than a test of the rating component specifically; anyone revisiting this should prove it
rather than inherit it.

**Not a reason: Tailwind.** This was raised and is wrong. `igniteui-theming` ships a Tailwind entry
point that plain CSS can import, exposes the design tokens as Tailwind utility classes
(`bg-primary-500`, `shadow-elevation-8`, `type-style-h3`), and since v25 deliberately aligns its
token output with Tailwind's variable conventions so the two can coexist without name collisions.
Sass is the generation path, not a requirement for consumption. The only real friction is
directional and specific to this repo: that integration wants Ignite UI's tokens to *be* the
Tailwind palette, whereas this project has its own hand-rolled palette, a `[data-theme='light']`
attribute and a custom `light:` variant. Adopting it properly would mean running two token systems
or migrating onto theirs — a bigger commitment than one control justifies, which is a matter of
scope, not compatibility.

**Not a reason: licensing.** Ignite UI's basic components are MIT; the commercial licence covers
the grids, charts, maps and the Dock Manager. A rating control would have fallen on the free side.

The control is about a hundred lines. The rest of the work — the half-star mapping, replacing the
dropdown in two places, moving both aggregates onto one scale, the tests — is identical whichever
way the leaf component is built, and it is all behind `ScoreInput`'s existing props. Swapping in a
library implementation later touches one file.

## Consequences

**Half-star precision is tight on a touch screen.** Each zone is half a star wide — about 11px at
the table's size — which is under the 24px WCAG 2.2 target-size guidance. Three things mitigate it
rather than solve it: the zones extend past the stars vertically, so the target is tall even where
it is narrow; the numeric readout beside the stars always shows what is selected, so a misfire is
visible immediately; and the keyboard path steps one value at a time. If bulk scoring on a phone
turns out to be unpleasant in practice, the table's cell is the thing to revisit, not the scale.

**The number stays next to the stars.** This is not redundancy. Half a star is genuinely hard to
read at a glance, and a score is something people re-check rather than glance at once.

**Clearing a score has two paths**: clicking the star already given, and an explicit ✕. The first
is the gesture people try; the second is the one that is discoverable. Both report `null`, never
`0` or `''` — a zero score would be a valid-looking value the database would happily reject.

**The player rating has no sample-size floor.** The critic score does, via `MIN_CRITIC_REVIEWS`
and [0016](0016-scores-carry-their-sample-size.md), because IGDB's `aggregated_rating` averages
with no minimum. `total_rating_count` is not filtered the same way, and now that both numbers wear
the same badge a reader cannot tell which one is floored. Every badge carries its count in its
accessible name and its tooltip, which is the mitigation, not the fix. Applying a floor to the
player rating is a deliberate follow-up, not an oversight.

**Two `StarRating` copies and the `criticScoreColors` / `criticScoreTitle` pair are gone.** There
were four separate renderings of "a score in a coloured box" across `GameCard`, `GamePage` (twice)
and `ListTable`; there is now one component with three variants.
