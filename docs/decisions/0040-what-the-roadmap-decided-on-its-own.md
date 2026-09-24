# 0040. The plan moves to GitHub issues, and what the roadmap decided on its own

**Status:** Implemented

## Context

`ROADMAP.md` was written as a gap analysis and grew into the plan: 416 lines by the time it was
retired, most of them struck through. Its own header said it would be rewritten as phases landed,
and it never was — each finished item was crossed out in place and annotated with what shipped,
so the file became a history of the plan with the open items scattered through it.

Three things followed. Open work was hard to find: one manual chore appeared three times, twice
inside rows marked done, and the one open question about the community endpoints sat in the
middle of a paragraph in §7. The file drifted from the records: §6 still drew one container and
an S3-hosted bundle where [0003](0003-two-process-deployment.md) and
[0007](0007-aws-target-architecture.md) have two services, §1 still counted three lists, and the
"Deployment features to build" list named a `node:22` image where there are two on Node 24. And
the plan had made decisions of its own — a window, an ordering, a cap, a breakpoint — that never
graduated into a record, because nothing forced them to.

`docs/data-model-plan.md` had the same shape: a sequencing section in which every step was done,
and an opening table that still said three migrations existed.

## Decision

### 1. Open work is a GitHub issue, and nothing else is the plan

Every open item became an issue: `feature` for product work, `platform` for deployment,
operations and quality, `question` for a decision that has no feature attached. A `needs: …`
label names the gate an issue waits behind, and there are three — an environment on AWS, an
email sender, an IsThereAnyDeal key — each an issue of its own. One pinned issue holds the order,
and the short list of things only the owner can do.

Readability was the request, and it is real: a list of labelled issues is scannable where a
416-line file was not. The structural reason is that an issue is closed by the pull request that
ships it (`closes #N`), so the list stays true without anybody editing it. A plan file is true only
as long as somebody remembers to strike a line, and this one shows what happens otherwise. An
issue also holds its own discussion, which a paragraph in a file cannot.

What is deliberately *not* in an issue: the reasoning, which stays in these records; the
requirements, which stay in `specs/`; and the schema, which stays in `docs/data-model-plan.md`,
now reduced to the tables not yet built and the two constraints every table answers to. An issue
is the card that links to those three. It says what, why now, what is already decided, what
blocks it, and what is still open — `.github/ISSUE_TEMPLATE/feature.md` is that list.

### 2. The old identifiers stay resolvable

The plan numbered its items — `D12`, `N3`, `P5` — and by the time it was retired those numbers
were cited some eighty times in code comments and in these records. Rewriting every citation was
considered and rejected: it would touch files across both projects for no change in behaviour,
and a short identifier reads better in a comment than an issue number does. So `ROADMAP.md`
stays, as the map from each identifier to where the item now lives — an issue, a record, or the
code that shipped it — and a retired identifier is never reused. The plan's full text is in the
history.

### 3. The decisions the plan made on its own

Everything the plan struck through was checked against the records and the code before it was
deleted. Nearly all of it was already there — the rails and the news page carry their reasoning
in their own headers, and the rest cites a record. What follows is what was not, keyed by the
plan's identifier so the citations keep working.

**§3.4 — IGDB has no news endpoint, and RSS is parked.** IGDB v3 had `pulse`, `pulse_groups`
and `pulse_sources`; v4 removed them, with other endpoints IGDB judged below its quality bar, and
they have not returned. That is why per-game news comes from Steam
([0012](0012-steam-news-without-a-database.md)), and why the search for an IGDB-native source
need not be repeated. A generic industry feed from outlets' RSS was considered and parked, with
two rules for whoever builds it: link out with the headline, thumbnail and source only, never an
article body; and never fuzzy-match a headline to a game title, which produces false positives —
Steam handles per-game.

**Responsive navigation.** Below the `md` breakpoint the navigation links move behind a menu
button at the start of the bar, and below `sm` the logo stands without its wordmark, so the bar
fits from 360px up. Measured signed out on every route at 390, 360 and 320px: no page is wider
than the screen. The three pages the plan once listed as overflowing a 390px phone on their own
content were fixed by the template-CSS cleanup (the home page's news grid, the lists page's tab
row and table) and by moving `/user` onto the site's layout (the profile's monthly chart).

**§4.2 — the free/paid line** was a table in the plan and is now in
[0010](0010-monetization-model.md), where the decision is. Moving it found a contradiction: the
plan sold a private profile as a paid feature, and
[0027](0027-usernames-and-public-profiles.md) had since made private the default for everyone.
The row is gone, and 0010 says so.

## Consequences

**A new item gets an issue number, not a `D15`.** The map in `ROADMAP.md` is the only place a
retired identifier is explained, so it is kept as items move. A closed issue's number still
resolves, so shipping something changes nothing in the map; only moving it does.

**A follow-up found mid-task is an issue, not a paragraph.** The habit the old file encouraged —
append what you noticed to the nearest section — is exactly what filled it. The cost is one
`gh issue create` or a checklist line on the feature's issue; the alternative is this record's
context section again.

**The records gained forward pointers.** [0001](0001-igdb-as-source-of-truth.md),
[0012](0012-steam-news-without-a-database.md),
[0026](0026-a-library-import-records-ownership-not-history.md) and
[0027](0027-usernames-and-public-profiles.md) each listed an open consequence that a later record
or an issue has since closed, and their status lines now say so. That is a status edit, not a
change of decision; the README allows it explicitly, and [0007](0007-aws-target-architecture.md)
was the precedent.

**Issues are public, and the repository is public.** Anything that should not be advertised does
not go in one. The chore the old plan repeated three times is handled in the deployment guide's
own steps rather than as an issue, for that reason.

**The deployment guide has amendments due.** `docs/deployment/dev-environment.md` lists the
places where checking found something [0005](0005-secrets-handling.md),
[0007](0007-aws-target-architecture.md), [0013](0013-http-caching-policy.md),
[0014](0014-rds-postgresql-over-aurora.md),
[0015](0015-fargate-confirmed-and-nat-less-networking.md) or
[0033](0033-what-the-api-refuses.md) did not know — the cost baseline, the credits,
`ForwardLimit`, where the Data Protection keys go. This record settles none of them; each belongs
to the record it amends, when the deployment settles it.
