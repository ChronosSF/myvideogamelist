# 0068. Lighthouse on the production shape: five pages, a phone and a desktop, and only what the runner cannot move fails the build

**Status:** Implemented. Built on [0060](0060-one-browser-test-over-the-production-shape.md)'s
harness. Three pages went without a performance assertion on a phone until #315 was fixed, and have
had a baseline since 2026-10-24 (§5). What it left to #106 is in
[0061](0061-ci-gates-every-pull-request.md): the secret scan allows its local credentials and its
sign-in script's password by reference, and the Dependency audit audits its lockfile against a list of
its own (§9).

## Context

The question was whether Lighthouse could run automatically. Before 0060 nothing could even run the
built app end to end; 0060 made a harness that does, in CI, with no IGDB credentials. This record is
what Lighthouse runs on, what it is allowed to fail, and why.

A Lighthouse report is a **lab** measurement: one page load in an emulated device on a simulated
network, on whatever CPU the machine has, with an empty cache. It scores four categories. Three of them
— accessibility, best practices, SEO — are weighted pass/fail audits of the page as loaded, and say the
same thing about the same page on any machine. The fourth, performance, is a weighted mix of load
metrics, and moves with the machine, with its neighbours, and with how quickly every host the page
loads from answers. Layout shift is one of those metrics, but it depends on what the page does, not on
how fast: a lab load either shifts or it does not.

Four facts shaped the answer:

- **The deployed site cannot be the subject.** Dev sits behind basic auth at the edge and is parked
  most of the time (0044, 0046); production is a holding page ([0066], on its pull request). And an
  audit of a deployment says nothing about a pull request before it merges.
- **A server without `SITE_URL` and `SITE_INDEXABLE=true` says `noindex` on every response**, on
  purpose (0036). Audited that way, every page fails SEO's crawlability audit by design.
- **A cover is most of what the pages draw**, and IGDB's image host serves them. An audit whose IGDB
  had no images would measure the largest contentful paint of a page with none.
- **The document policy is about to name a nonce for every script** (#254, [0053] on its pull request).
  Lighthouse injects code of its own into the page it audits; if the policy refused it, the run would
  measure a broken page.

## Decision

### 1. Lighthouse CI, run by the smoke test's harness

`@lhci/cli` 0.15.1, its latest: `collect` runs Lighthouse, `assert` judges the runs, `upload` writes the
reports. It pins Lighthouse 12.6.1 exactly, from June 2025, where Lighthouse itself has moved on to 13.
This audit moves when LHCI does, and that move re-takes every baseline.

Playwright runs it, because Playwright already runs 0060's harness. `lighthouse/playwright.config.ts`
starts the same two servers as the smoke test, from one definition both configs share
(`e2e/servers.ts`). Its global setup starts the same two stand-ins (`e2e/stand-ins.ts`) and seeds the
account the pages show (§3), and two tests audit them: `audit.lh.ts` drives `lhci`, `axe.lh.ts` runs
axe (§10). It listens on ports of its own, 5190–5193, beside the smoke test's; the two still run one
after the other, since each builds the front end into the same `build/` folder the other serves.

The front end is told, as production is, that its public origin is the one the browser opens: the
stand-in for the edge, given as `SITE_URL` with `SITE_INDEXABLE=true`. So pages are indexable, robots.txt
names its sitemap, and every canonical URL names the page it is on.

Lighthouse runs in **Playwright's Chromium**, the build `@playwright/test` 1.63.0 pins (Chromium 153),
through LHCI's puppeteer path with `puppeteer-core`, which Lighthouse already brings. Not the runner's
own Chrome, which GitHub updates with its images, because a browser update moves the scores and a
regression gate must not move by itself. It is launched with `--no-sandbox`, as Playwright launches it:
Ubuntu's AppArmor refuses Chromium's sandbox to a build it has no profile for. Lighthouse 12.6.1 sends
the user agent of a Chrome 136 phone, or of a Mac for the desktop run. `isbot` counts neither as a
crawler, so the pages stream to Lighthouse as they do to a reader (0053 §2).

Rejected:

- **Lighthouse 13, through its own Node API.** The newer Lighthouse, at the price of writing and
  keeping what LHCI gives: the runs per URL, the median of each figure, assertions with levels, and the
  median run's report.
- **The GitHub Action that wraps LHCI.** It audits URLs it is given, in the runner's own Chrome, and
  starts nothing: the harness would still be this job's to run, and the browser would move with the
  image.
- **PageSpeed Insights' API.** It audits a public URL, which a pull request does not have.
- **An LHCI server, for history.** A server to run and keep; the artifacts (§8) are history enough
  before launch.

### 2. Five pages

| Page | Why |
|---|---|
| Home, signed out | The front door: a hero image and a rail of covers |
| Browse, `/games` | The catalogue, a grid of covers |
| A game, `/games/1942` | The organic landing pages (0013), and the heaviest page: art, screenshots, the community view |
| A public profile, `/u/{name}` | The one public page about a person, indexable when it has anything on it |
| The lists, signed in | What a member uses most, and the one private page audited |

The lists page is signed in by LHCI's puppeteer script, `lighthouse/sign-in.cjs`, which LHCI runs once
before each URL's runs, in the browser Lighthouse then audits in. Before the lists it signs the run's
account in through `/api/auth/login`, with the header every write carries (0033), from a page of the
site; before every other page it clears the cookies, so a signed-out page is what a stranger gets.
Lighthouse resets a page's caches and service workers between runs but not its cookies, which is what
makes a session set once last through the runs.

Not audited: the wishlist, the calendar, the user, news and terms pages, the import and the admin page.
They are the shape of one that is, or seen rarely, or seen by one person. Adding one is a line in
`PAGES`, a baseline for each form factor and its axe entries, which `budgets.ts`'s types demand.

### 3. What the pages show

**Real games, from IGDB as it answered on 2026-10-17.** The stand-in for IGDB answers from
`lighthouse/igdb.json`: thirty-three games, the ones `scripts/seed-demo-history.mjs` names, recorded with
the field lists `IgdbService` asks for, and IGDB's genres and The Witcher 3's completion times beside
them. A listing row keeps what a grid, a list or a profile renders; The Witcher 3's is the game page's
whole answer. Every cover and artwork is a real image id, so the browser loads them from
`images.igdb.com`, the one host outside the runner the audit's browser reaches. A lookup by id gets its
rows, any other query for games gets a page of them in order of how many ratings they hold, the trending
rail's popularity is the same order, and anything else gets nothing: as in the smoke test, the stand-in
is not a model of IGDB.

**Steam is not reached.** With no Steam ids, the home page's news rail is empty and the API marks the
home page degraded (0013), and the game page has no news panel. Both are audited without their news, and
no audited page renders a news card (#334).

**A member with a library.** The global setup registers an account through the API, as the sign-up
dialog does, makes its profile public, and gives it 25 games across the five lists, scores, six
favourites, five wishlisted games, four playthroughs and two public reviews — through the API rather
than as `seed-demo-history.mjs`'s SQL, so the audit needs nothing but the harness. The cost is that every
status change is dated today, so the profile's activity chart has a month in it rather than a year. The
teardown deletes the account, which takes its library with it, so every run's game page counts one
member and one review, on a developer's machine as in CI, where the database is new every run. A game
many people track shows more of both deployed.

### 4. A phone, then a desktop, three runs each, the median

The headline run is Lighthouse's default, a mid-range phone: a 412 × 823 screen, a 150 ms round trip at
1.6 Mbps, and a CPU four times slower than the runner's, all simulated. The second is its desktop preset:
1350 × 940, 40 ms at 10 Mbps, the runner's own CPU.

Each URL is audited three times on each, and every assertion reads the **median** of the runs that gave
a figure (LHCI's `median` aggregation). The report kept is LHCI's median run, the one closest to the
median first contentful paint and time to interactive. A page gets twenty seconds to load rather than
Lighthouse's forty-five, so that a stalled image host costs the thirty audits ten minutes rather than
more than the job has. On GitHub's runner the thirty audits took under seven minutes.

### 5. Two tiers

**What fails the job** is what moves only when a page does:

- **Accessibility, best practices and SEO scores, and the count of errors in the console, held to their
  baseline exactly.** Every run, on a developer's machine and on GitHub's runner, gave every page the
  same figures in all four. A drop is a page that newly fails an audit. A rise fails too, until the
  baseline is raised in the same pull request: otherwise the next change can give it back unseen, and
  the lists page rising to 100 for SEO would be the page losing its `noindex`. The console's count is
  there because four of the five pages already fail Lighthouse's console audit on #316's 401, so a new
  error would not move their score.
- **Layout shift over 0.02.** Every page was under 0.002, so this is ten times the worst and a fifth of
  the 0.1 Google calls good: an image arriving without its size or a banner pushing the page down
  crosses it, and the difference between two runs does not.
- **Script over 600 KiB, or a page's whole weight over half as much again as its baseline**, in bytes
  once decoded. Pages load 359 to 398 KiB of script, so a dependency of any size or a route that stops
  being split off crosses the first, and an image of megabytes or a grid's covers asked for at a bigger
  size the second. They are the gate on how much a page loads, which performance cannot be (below).
  Decoded rather than as sent, because a developer's machine can undo the compression in transit — one
  did, leaving an `X-Content-Encoding-Over-Network` header on every response, and reported three times
  CI's sizes for the same pages, while the decoded sizes were the same to the byte. LHCI's own byte
  assertions read sizes as sent, so the summary judges these, on the median run's requests.

The one thing outside the page this tier answers to is **IGDB's image host**. A cover it fails to serve
is an error in the console, which moves the console's count and best practices, so an outage there fails
the job. The median takes one bad run of three; the summary prints what the console said, so a host
failure reads as one; re-run the job when the host is back.

One regression gets through, because Lighthouse rounds a category score to two decimals. On the game page
the lightest accessibility audit failing moves its score from 0.9218 to 0.9162, which still rounds to
0.92. axe, which runs every rule by name (§10), is what catches it, at a desktop's width.

**What only warns: performance more than ten points under its baseline.** It **fails** only under a floor,
50 on a phone and 60 on a desktop. Performance moves with things a pull request did not change. On a
developer's machine, the home page's hero image, which IGDB's image host answered in 0.2 s on one run and
5 s on the next, put the same commit's desktop score at 96 and then at 71. On GitHub's runner, nearer the
image host, the same page scored 100, and no page's three runs differed by more than four points. A gate
that fails on the first kind of difference teaches everybody to re-run it until it passes.

The floor is a backstop for a page that has stopped working, a main thread blocked for seconds. It
catches little else: on every page blocking time and layout shift are zero, and together they are 55% of
the score, so a page that blocks nothing and shifts nothing keeps over half its score however slowly it
loads. That is why the bytes, and not this, are the gate on what a page loads.

**What a regression looks like.** The job's summary marks the figure, names the threshold or the
baseline it left, and lists everything that fails the job; the run carries an annotation for each; and
the page's median report, in the artifact, names the audit. Fix it, or, when the change is meant — a new
section the page did not have, an improvement — change the baseline in `lighthouse/budgets.ts` in the
same pull request and say why in its description.

**No largest contentful paint, no performance score.** On a phone, the home, game and profile pages
recorded none at first: a rail scrolled itself into its snap position before the first paint, and Chrome
ends the measurement at a scroll (#315). Lighthouse then scores no performance at all. A page whose
baseline has no performance score goes unasserted: the summary says "no LCP", and warns the day the page
scores, so that its baseline is written then. The three scored once #272 brought #315's fix, and their
baselines, 87, 87 and 89, are what GitHub's runner gave each page's median run on 2026-10-24 (run
40070934403). Once a page has a baseline, losing its LCP fails the job: LHCI fails an assertion that no
run gave a value for, and the summary marks it "❌ no value". If only one or two of the three runs lose
it, LHCI takes the median of the others.

### 6. Lab data, not field data

A lab score says whether a change made a page worse under fixed conditions. It does not say what
readers get: their devices, their networks, their caches, the edge in front of them. That is field data,
from real visits — Chrome's own (CrUX), or the site's own measurements — and there is none before
launch. When there is, CrUX for the origin is a lookup that needs no code; a beacon of the site's own is
collection of reader data, which is a decision for then, with #141's consent in view.

Where this harness is not production, the score says so too: no CDN in front and so no edge cache, a
round trip to a server on the same machine, HTTP/1.1 rather than 2 or 3, no TLS, the API built for
Debug and run in Development (0060 §4), and no news (§3). Lighthouse's simulation models the network
from the requests it saw, so these move the figures, and the comparison that matters is between two runs
of this harness, never between this harness and the site. A developer's machine adds its own distance
from IGDB's image host, and whatever its network software does: the machine that decoded responses in
transit scored 70 for browse on a phone, where GitHub's runner scored 90.

### 7. The AdSense allowance to come

#143 brings AdSense to signed-out visitors and free members, which until the paid tier exists is
everybody, behind #141's consent banner; #242 brings Google Analytics. The pages will then load
third-party script the audit fetches from the network, and the numbers will move: performance with the
scripts' cost, best practices with whatever Google's code does — third-party cookies, deprecated APIs,
its console — and accessibility with the banner, which is ours. The pull request that adds them re-takes
the baseline, and keeps these rules:

- **Audit what a reader gets**, the banner in its first state and the ads as served, never with ad hosts
  blocked to look good. Lighthouse clears a page's caches between runs but not its cookies, local
  storage or databases, so a consent answer written on the first run would still be there on the second
  and third. That pull request widens Lighthouse's `clearStorageTypes`, which LHCI passes through, and
  audits the signed-in page in a collect of its own.
- **An audit failing only because of Google's code is turned off by name**, with the reason, rather than
  the category's baseline lowered, so that a regression of ours in the same category still fails. The
  console's count will need the same treatment for errors Google's code logs.
- **Layout shift stays in the failing tier.** A slot reserves its height (#143), and this is what holds
  it to that.
- **The scripts need a decision in the content policy first** (0053's consequences), and the audit is
  how that decision is seen to work.

Ads are not the same twice, so performance warnings on those pages will be noisier than today. That is
the reason the tier is a warning.

### 8. Reports, and where they go

The job uploads `lighthouse/reports/` as an artifact for fourteen days, named for the attempt: per form
factor, each page's median report as HTML to open and as JSON, the configuration LHCI was given, its
assertion results, axe's elements, and the summary. The same summary goes to the job's summary page, and
each miss becomes an annotation on the run. When the audit fails, every run Lighthouse made goes up as a
second artifact, since a run that stopped early never reached the reports.

The repository is public, so anybody signed in to GitHub can read the summary and download the reports.
That is acceptable because of what they hold: screenshots of the pages and the data of a throwaway
account the run made and deleted, and nothing of anybody's.

**Not LHCI's temporary public storage**, the target its documentation starts with, which posts each
median report to an address Google runs, where anybody with the link can open it for as long as that
storage keeps it. That is a host outside the repository's control and its retention, for reports the
artifact already keeps. No LHCI server is run either.

### 9. Lighthouse CI keeps a lockfile of its own

`lighthouse/package.json` holds `@lhci/cli`, pinned exactly, and nothing else. It installs 330 packages,
and `npm audit` counts 17 of them vulnerable, 11 high, from seven advisories in five packages: an FTP
client under LHCI's proxy support, a zip extractor under puppeteer's browser download, `tmp`, `uuid`, and
`sprintf-js` under its YAML reader. The audit reaches none of what they describe: it sets no proxy,
downloads no browser and opens no FTP, and the `uuid` advisory is about versions 3, 5 and 6 writing
into a buffer, where LHCI asks for version 4. They are in a lockfile all the same. In their own, `npm
audit` over the client still describes what the client ships (#106), and the job installs them in a step
of its own. Dependabot watches the directory, and GitHub lists its alerts as development dependencies
of that file.

Overrides that bump the fixable ones were not added: two of them have no fixed version at all, and
replacing a tool's dependencies under it is how the tool breaks between one update and the next.

**What 0061 made of it.** Those counts are the first ones, of 2026-10-17. By 2026-10-24 `sprintf-js`'s
advisory had been withdrawn, and two new highs had reached the tree, `body-parser` under LHCI's express
and `zod` 3 under puppeteer's `chromium-bidi`, the same two the client then took fixes for.
`body-parser` 1.20.9 is inside express's range and is taken, which is no override; nothing inside its
dependents' ranges fixes any of the rest. [0061](0061-ci-gates-every-pull-request.md)'s Dependency
audit now audits this lockfile too, on its own, against a list in `scripts/audit.mjs` that names each of
the five highs left (`basic-ftp`, `extract-zip`'s two, `tmp` and `zod`) with why the audit cannot reach
it and a day to look again, so a new advisory here fails the job until somebody has judged it. An
advisory with a fix in range is taken, as `body-parser`'s was.

### 10. axe in full, beside it

Lighthouse's accessibility score runs a subset of axe-core's rules and folds them into one weighted
number. A rule outside the subset cannot move it, and the number does not say which rule did.
`lighthouse/axe.lh.ts` runs axe-core itself, through `@axe-core/playwright`, on the same five pages and
the same account: every rule axe enables by default — WCAG 2.0 and 2.1 at A and AA, and its best
practices — and `target-size`, WCAG 2.2's one AA rule, which axe leaves off and Lighthouse turns on. It
runs at a desktop's width, in the same Chromium build as Lighthouse, once each page's network has gone
quiet. It found one rule Lighthouse does not run: `nested-interactive`, on the lists page.

Its gate is the baseline again, and exact. `KNOWN_VIOLATIONS` in `lighthouse/budgets.ts` lists the rules
each page broke when it was taken; any other rule a page breaks fails the job, and so does a listed rule
the page no longer breaks, until it leaves the list. By rule rather than by element, because the count of
elements breaking a rule moves with the data, a list's length or a page of covers, and the rule does not.
Contrast is the exception, because every page breaks it today and a rule alone would let a new
low-contrast pair in unseen: `KNOWN_CONTRAST` lists each page's failing colour pairs, foreground on
background, which are a property of the theme and not of the data. Its table goes to the job summary
under Lighthouse's, and every element with axe's reason to the artifact, as `axe/violations.json`.

It is `@axe-core/playwright` 4.13.0, pinned exactly, with axe-core 4.13.0 under it; Lighthouse's own is
axe-core 4.14.0. 4.14.0 of the Playwright package was two days old when this was written, and a package
that new is the one to wait for.

## Consequences

- **The job takes about eight minutes on every pull request and every push to master**, which makes it
  CI's slowest: on the same run the C# CodeQL job, the slowest before it, took under three. The checks
  on a pull request, and the dev deploy that waits on them as on every job, take five minutes longer.
  Standard runners cost nothing on a public repository.
- **A pull request fails** that moves an accessibility, best-practices or SEO score or a console's count
  of errors either way, shifts a page's layout, grows its script or its weight past budget, or breaks an
  axe rule or a contrast pair a page did not already break — or stops breaking one it did — until it is
  fixed or the baseline is changed with a reason.
- **`npm run lighthouse` needs** PostgreSQL up, ports 5190–5193 free, Playwright's Chromium (once, `npx
  playwright install chromium`), and the network to reach IGDB's image host. It installs its own package,
  keeps a database of its own, `mvgl_lighthouse`, on the compose server, and deletes its account when it
  ends. A run against a database with other members in it shows a game page that CI never does. A
  machine farther from the image host, or one that decodes traffic in transit, warns about performance
  and passes.
- **The games are a fixture.** A page that needs a field `igdb.json` lacks shows without it; record the
  games again with the field lists `IgdbService` asks for then.
- **The job runs on `ubuntu-24.04`, pinned**, unlike CI's other jobs: the baseline was measured on that
  image, and a new one brings new fonts and libraries under the browser. Moving it re-takes the baseline.
- **`postgres:18-alpine` is in four places now**: `compose.yaml`, `PostgresServer`, and the two service
  containers in `ci.yml`, and each file says to change them together. The local container's credentials
  are in five files: `compose.yaml`, `appsettings.Development.json`, the smoke test's and the audit's
  configs, and `ci.yml`, twice. #106's secret scanning has to allow all of them, and 0061's does.
- **Under #254's document policy the audit is unchanged.** Checked with that branch's code in place:
  every page loaded with no violation in its console and the same scores. Lighthouse's own code runs
  through the DevTools protocol, which a page's policy does not govern. What did break was ours: the
  sign-in script first sent its request from `robots.txt`, a resource route, whose policy is the API's
  `default-src 'none'`, and that refuses it. It sends it from a page now.
- **What the first numbers say**, each filed or already open: contrast fails on every page (#234, #246,
  #329); heading order skips a level on browse, the profile and the lists, the game page's description
  list holds what it may not, and the lists' covers nest controls (#329); every signed-out page logs a 401
  from the session check (#316); on browse and the lists the largest paint is a cover marked
  `loading="lazy"` (a comment on #127); the three pages of #315; and no news anywhere (#334).
- **Not covered:** the CDN, TLS and HTTP/2 and 3; interaction, since a navigation measures none and total
  blocking time is the lab's stand-in; the pages not listed; Steam's news (#334); field data; the API's
  Release build; IGDB itself.

## The first baseline

The medians of the job's first run on GitHub's runner (run 39040552994, on #328, a throwaway draft
against `master`, 2026-10-17), against an empty database. Scores are out of 100, as Lighthouse shows them.
`lighthouse/budgets.ts` holds the baseline the job judges, and moves with the pages; this table does not.

| Page | Accessibility | Best practices | SEO | Console errors | Layout shift | Performance, phone | Performance, desktop |
|---|--:|--:|--:|--:|--:|--:|--:|
| Home, signed out | 96 | 96 | 100 | 1 | 0.000 | no LCP (#315) | 100 |
| Browse | 95 | 96 | 100 | 1 | 0.000 | 90 | 99 |
| Game | 92 | 96 | 100 | 1 | 0.000 | no LCP (#315) | 100 |
| Public profile | 94 | 96 | 100 | 1 | 0.000 | no LCP (#315) | 100 |
| Lists, signed in | 95 | 100 | 66 | 0 | 0.001 | 89 | 99 |

Everything but performance was the same on a phone and on a desktop, and on every run anywhere. Decoded,
the pages loaded 359 to 398 KiB of script, and in all from 587 KiB (the profile and the lists) to 2,106
KiB (the game page, mostly IGDB's screenshots). On a developer's machine, performance on a phone was 70
to 71 for browse and the lists, and on a desktop between 71 and 97. With #315's fix in place, the three
pages it holds back measured, on that machine, 62, 67 and 74 on a phone.

axe's baseline, `KNOWN_VIOLATIONS` and `KNOWN_CONTRAST`, was taken on a developer's machine and held on
GitHub's runner in run 39044402513 (#338, a second throwaway draft), whose figures were the first
run's, performance within a point: contrast on every page, in the pairs `KNOWN_CONTRAST` lists, and #329's rules on the
pages it names. `target-size` passes everywhere.

[0053]: https://github.com/ChronosSF/myvideogamelist/pull/254
[0066]: https://github.com/ChronosSF/myvideogamelist/pull/298
