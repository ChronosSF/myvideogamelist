# 0068. Lighthouse on the production shape: five pages, a phone and a desktop, and only what the runner cannot move fails the build

**Status:** Implemented. Built on [0060](0060-one-browser-test-over-the-production-shape.md)'s
harness. Performance on a phone goes unasserted on three pages until #315.

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
  most of the time (0044, 0046); production is a holding page (0066). And an audit of a deployment says
  nothing about a pull request before it merges.
- **A server without `SITE_URL` and `SITE_INDEXABLE=true` says `noindex` on every response**, on
  purpose (0036). Audited that way, every page fails SEO's crawlability audit by design.
- **A cover is most of what the pages draw**, and IGDB's image host serves them. An audit whose IGDB
  had no images would measure the largest contentful paint of a page with none.
- **The document policy is about to name a nonce for every script** (#254, [0053] on its branch).
  Lighthouse injects code of its own into the page it audits; if the policy refused it, the run would
  measure a broken page.

## Decision

### 1. Lighthouse CI, run by the smoke test's harness

`@lhci/cli` 0.15.1, its latest, which bundles Lighthouse 12.6.1: `collect` runs Lighthouse, `assert`
judges the runs, `upload` writes the reports. Playwright runs it, because Playwright already runs 0060's
harness: `lighthouse/playwright.config.ts` starts the same two servers as the smoke test, from one
definition both configs share (`e2e/servers.ts`), and its global setup starts the same two stand-ins
(`e2e/stand-ins.ts`), on ports of its own (5190–5193) so that the two can run at once. Its one test
drives `lhci` and writes the summary.

The front end is told, as production is, that its public origin is the one the browser opens: the
stand-in for the edge, given as `SITE_URL` with `SITE_INDEXABLE=true`. So pages are indexable, robots.txt
names its sitemap, and every canonical URL names the page it is on.

Lighthouse runs in **Playwright's Chromium**, the build `@playwright/test` 1.63.0 pins, through LHCI's
puppeteer path with `puppeteer-core`, which Lighthouse already brings. Not the runner's own Chrome,
which GitHub updates with its images, because a browser update moves the scores and a regression gate
must not move by itself. It is launched with `--no-sandbox`, as Playwright launches it: Ubuntu's
AppArmor refuses Chromium's sandbox to a build it has no profile for.

### 2. Five pages

| Page | Why |
|---|---|
| Home, signed out | The front door: a hero image and two rails of covers |
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

Not audited: the wishlist, the calendar, the user and news pages, the import and the admin page. They
are the shape of one that is, or seen rarely, or seen by one person. Adding one is a line in
`lighthouse/budgets.ts`.

### 3. What the pages show

**Real games, from IGDB as it answered on 2026-10-17.** The stand-in for IGDB answers from
`lighthouse/igdb.json`: thirty-three games, the ones `scripts/seed-demo-history.mjs` names, recorded with
the field lists `IgdbService` asks for. A listing row keeps what a grid, a list or a profile renders; The
Witcher 3's is the game page's whole answer. Every cover and artwork is a real image id, so the browser
loads them from `images.igdb.com`, the one host outside the runner the job reaches. A lookup by id gets
its rows, any other query for games gets a page of them in order of how many ratings they hold, the
trending rail's popularity is the same order, and anything else gets nothing — as in the smoke test,
the stand-in is not a model of IGDB.

**Steam is not reached.** With no Steam ids, the home page's news rail is empty and the API marks the
home page degraded (0013), so the home page is audited without its news. Its covers and its hero are
there.

**A member with a library.** The global setup registers an account through the API, as the sign-up
dialog does, makes its profile public, and gives it 25 games across the five lists, scores, six
favourites, five wishlisted games, four playthroughs and two public reviews — through the API rather
than as `seed-demo-history.mjs`'s SQL, so the audit needs nothing but the harness. The cost is that every
status change is dated today, so the profile's activity chart has a month in it rather than a year. The
teardown deletes the account, which takes its library with it, so the next run's game page counts the
same one member, on a developer's machine as in CI, where the database is new every run.

### 4. A phone, then a desktop, three runs each, the median

The headline run is Lighthouse's default, a mid-range phone: a 412 × 823 screen, a 150 ms round trip at
1.6 Mbps, and a CPU four times slower than the runner's, all simulated. The second is its desktop preset:
1350 × 940, 40 ms at 10 Mbps, the runner's own CPU.

Each URL is audited three times on each, and every assertion reads the **median** of the three, per
figure (LHCI's `median` aggregation). The report kept is LHCI's median run, the one closest to the
median first paint and time to interactive. Thirty audits take [CI MINUTES] on GitHub's runner.

### 5. Two tiers

**What fails the job: accessibility, best practices and SEO below their baseline, and layout shift over
0.02.** These depend on the page, not on the runner. Two runs on two machines a day apart scored every
page the same, to the point, in all three; a drop means a page that used to pass an audit fails it, and
that is a regression by construction. So the threshold is the baseline itself, not a margin under it.
Layout shift was under 0.002 on every page; 0.02 is ten times that and a fifth of the 0.1 Google calls
good, so an image arriving without its size or a banner pushing the page down crosses it, and run to run
noise does not.

**What only warns: performance more than 0.10 under its baseline.** It **fails** only under a floor, 40 on
a phone and 60 on a desktop. Performance moves with things a pull request did not change. The clearest
measured: the home page's hero image, which IGDB's image host answered in 0.2 s on one run and 5 s on
the next, put the same commit's desktop score at 0.96 and then at 0.71. A gate that fails on that
teaches everybody to re-run it until it passes. The floor is under every baseline by more than the image
host's worst, and what reaches it is something broken: a script that blocks the page, an image of
megabytes, a request that waits on another.

**What a regression looks like.** The job's summary marks the figure and names the threshold, the run
carries an annotation for each, and the page's median report, in the artifact, names the audit that
failed. Fix it, or, when the change is meant — a new section the page did not have — change the
baseline in `lighthouse/budgets.ts` in the same pull request and say why in its description. An
improvement is written in the same way, so that the next change cannot quietly give it back.

**No largest contentful paint, no performance score.** On a phone, the home, game and profile pages
record none: a rail scrolls itself into its snap position before the first paint, and Chrome ends the
measurement at a scroll (#315). Lighthouse then scores no performance at all, so those three go
unasserted, the summary says "no LCP", and it warns the day one of them scores, so that its baseline is
written then.

### 6. Lab data, not field data

A lab score says whether a change made a page worse under fixed conditions. It does not say what
readers get: their devices, their networks, their caches, the edge in front of them. That is field data,
from real visits — Chrome's own (CrUX), or the site's own measurements — and there is none before
launch. When there is, CrUX for the origin is a lookup that needs no code; a beacon of the site's own is
collection of reader data, which is a decision for then, with #141's consent in view.

Where this harness is not production, the score says so too: no CDN in front and so no edge cache, a
round trip to a server on the same machine, HTTP/1.1 rather than 2 or 3, no TLS, the API in Development
(0060 §4), no news rail. Lighthouse's simulation models the network from the requests it saw, so these
move the figures, and the comparison that matters is between two runs of this harness, never between
this harness and the site.

### 7. The AdSense allowance to come

#143 brings AdSense to signed-out pages, behind #141's consent banner, and #242 brings Google
Analytics. The pages will then load third-party script the audit fetches from the network, and the
numbers will move: performance with the scripts' cost, best practices with whatever Google's code does
— third-party cookies, deprecated APIs, its console — and accessibility with the banner, which is ours.
The pull request that adds them re-takes the baseline, and keeps these rules:

- **Audit what a reader gets**, the banner in its first state and the ads as served, never with ad hosts
  blocked to look good.
- **An audit failing only because of Google's code is turned off by name**, with the reason, rather than
  the category's threshold lowered, so that a regression of ours in the same category still fails.
- **Layout shift stays in the failing tier.** A slot reserves its height (#143), and this is what holds
  it to that.
- **The scripts need a decision in the content policy first** (0053's consequences), and the audit is
  how that decision is seen to work.

Ads are not the same twice, so performance warnings on those pages will be noisier than today. That is
the reason the tier is a warning.

### 8. Reports, and nothing public

The job uploads `lighthouse/reports/` as an artifact for fourteen days, named for the attempt: per form
factor, each page's median report as HTML to open and as JSON, the configuration LHCI was given, its
assertion results, and the summary. The same summary, a table of medians per page, goes to the job's
summary page, and each missed threshold becomes an annotation on the run.

**Never LHCI's temporary public storage**, the target its documentation starts with, which posts each
median report to a public address Google runs. A report carries screenshots of every page audited, the
signed-in one included. Nothing about this site is published by default, and no LHCI server is run
either: the artifact is the history.

### 9. Lighthouse CI keeps a lockfile of its own

`lighthouse/package.json` holds `@lhci/cli`, pinned exactly, and nothing else. It brings 261 packages, and
`npm audit` reports 17 advisories among them, 11 high: an FTP client under its proxy support, a zip
extractor under puppeteer's browser download, `tmp` under its setup wizard, `uuid`, and `sprintf-js`
under its YAML reader. The audit runs none of those paths — no proxy, no browser download, no wizard —
but they are in a lockfile all the same. In their own, `npm audit` over the client still describes what
the client ships (#106), and the job installs them in a step of its own. Dependabot watches the
directory, and GitHub lists its alerts as development dependencies of that file.

Overrides that bump the fixable ones were not added: two of them have no fixed version at all, and
replacing a tool's dependencies under it is how the tool breaks between one update and the next.

## Consequences

- **The job takes [CI MINUTES] on every pull request and every push to master**, and Deploy dev waits on it,
  as on every job. Standard runners cost nothing on a public repository.
- **A pull request that lowers an accessibility, best-practices or SEO score, or shifts a page's layout,
  fails** until it is fixed or the baseline changes with a reason.
- **`npm run lighthouse` needs** PostgreSQL up, ports 5190–5193 free, Playwright's Chromium (once, `npx
  playwright install chromium`), and the network to reach IGDB's image host. It installs its own package,
  keeps a database of its own, `mvgl_lighthouse`, on the compose server, and deletes its account when it
  ends. A run against a database with other members in it shows a game page that CI never does.
- **The games are a fixture.** A page that needs a field `igdb.json` lacks shows without it; record the
  games again with the field lists `IgdbService` asks for then.
- **`postgres:18-alpine` is in four places now**: `compose.yaml`, `PostgresServer`, and the two service
  containers in `ci.yml`, and each says to change all four together. The local container's credentials
  are in two more files, the audit's config and its job, which #106's secret scanning has to allow too.
- **Under #254's document policy the audit is unchanged.** Checked with that branch's code in place:
  every page loaded with no violation in its console and the same scores. Lighthouse's own code runs
  through the DevTools protocol, which a page's policy does not govern. What did break was ours: the
  sign-in script first sent its request from `robots.txt`, a resource route, whose policy is the API's
  `default-src 'none'`, and that refuses it. It sends it from a page now.
- **What the first numbers say**, each filed or already open: contrast fails on every page (#234,
  #246); heading order skips a level on browse, the profile and the lists, and the game page's
  description list holds what it may not (#[A11Y]); every signed-out page logs a 401 from the session
  check (#316); on browse and the lists the largest paint is a cover marked `loading="lazy"` (#127); and
  the three pages of #315.
- **Not covered:** the CDN, TLS and HTTP/2; interaction, since a navigation measures none and total
  blocking time is the lab's stand-in; the pages not listed; field data; IGDB itself.

## The baseline

[BASELINE TABLE]

[0053]: https://github.com/ChronosSF/myvideogamelist/pull/254
