# 0099. Dev is deployed by hand: Deploy dev runs when dispatched, and builds master as it starts

**Status:** Implemented; proved only by a dispatch on `master`. Built for
[#339](https://github.com/ChronosSF/myvideogamelist/issues/339). Amends
[0044](0044-what-the-deployment-walkthrough-settled.md)'s D-6, "every merge builds and pushes; only an
awake environment deploys": no merge builds or deploys anything now. What
[0057](0057-the-api-is-tested-over-a-real-postgresql.md),
[0060](0060-one-browser-test-over-the-production-shape.md) and
[0061](0061-ci-gates-every-pull-request.md) say of Deploy dev waiting on CI no longer holds.

## Context

As 0044 built it, Deploy dev ran on `workflow_run` after every CI run on `master`. It built and pushed
both images, and deployed them when `DEV_DEPLOY_ENABLED` on the `dev` environment was true. #339 found
five faults. Three of them came from that trigger:

- **A re-run went backwards.** A re-run keeps the commit of the event that started the run ("The
  workflow will also use the same `GITHUB_SHA` (commit SHA) and `GITHUB_REF` (git ref) of the original
  event", GitHub's page on re-running workflows). So a re-run of an old CI run, or of an old Deploy dev
  run, deployed an old commit over a newer release, under migrations the newer one had already applied.
- **A burst lost its middle.** The concurrency group held one pending run and cancelled it when another
  joined. Of three quick merges, the middle one's run was cancelled before it built, and that commit
  never got images.
- **A run with nothing to do could cancel a real one.** A failed CI run, or a fork's pull request from a
  branch named `master`, still created a run. Its `if` skipped the job, but the run joined the group.

The first fix kept the trigger. `queue: max` on the group meant no waiting run was cancelled, and a run
checked that its commit was still master's tip before it deployed. It held, by the documentation and by
a reading of each scenario. Its review found what it still left behind:

- `resume` takes the last-pushed tag for the newest. So an old commit pushed late, a red CI run re-run
  green after newer commits had landed, would be resumed over newer ones.
- A run created before the change and re-run after it runs the old workflow.
- A full queue, a hundred runs, still cancels the next one to arrive.

Each of those exists because a merge starts a run.

Two facts make the trigger unnecessary:

- **Testers are coming.** Dev is about to have testers for two weeks, with basic auth coming off for
  them ([#465](https://github.com/ChronosSF/myvideogamelist/issues/465)). A deploy restarts both tasks
  and empties the edge's cache. On merge, that landed on the testers whenever a pull request merged.
- **Every commit on master passes CI as its pull request, in practice.** The ruleset's required checks
  are strict (0061 §7), so a pull request is current with `master` when it merges, and its checks ran
  on the tree `master` becomes. The run on the push to `master` tests that tree again. The live
  ruleset does let the admin role bypass it at any time, though 0061 §7 asked for no bypass. So this
  holds because the owner merges through pull requests, not because GitHub enforces it.

## Decision

1. **Deploy dev runs on `workflow_dispatch` alone**, from the Actions tab or with
   `gh workflow run deploy-dev.yml`. Dispatching takes write access, and the `dev` environment admits
   deployments from `master` alone. So the `if` that kept the AWS role from failed CI runs and forks'
   pull requests goes, with the trigger it guarded.
2. **A run builds master's head as its job starts, not the commit it was dispatched at.** The checkout
   names `refs/heads/master`, and how actions/checkout treats that is in its `input-helper.ts` and
   `ref-helper.ts`. It pins a commit only when `ref` is empty, using `github.sha`, or when `ref` is
   itself a SHA. Otherwise it fetches `+refs/heads/master:refs/remotes/origin/master` and starts from
   `refs/remotes/origin/master`, which is the head at fetch time. The group never runs two at once, and
   `master` only moves forward (the ruleset refuses a force push to it, bar the admin bypass above), so
   each run deploys a commit at least as new as the one before it. A run
   that waited behind another deploys master's newest. So does a re-run of an old one, whose
   `GITHUB_SHA` is still the old commit. No tip check is needed, and none is made.
   - The full name matters. A bare `master` is fetched as `refs/heads/master*`, which takes every branch
     whose name begins with it.
   - **A run whose workflow file is not master's stops before it builds.** The steps a run executes are
     the file as it was at `github.workflow_sha`, "The commit SHA for the workflow file" in GitHub's
     contexts reference, whatever the checkout holds. A re-run, or a run that waited while a merge
     changed the file, would run old steps against new code, so the first step compares the two and
     stops the run if they differ.
3. **The gate stays.**
   - `DEV_DEPLOY_ENABLED`, set by `park` and `resume`, still decides whether a run deploys.
   - A run dispatched while parked builds and pushes, then stops. That is now how `resume` gets master's
     newest. `resume` deploys the newest tag in ECR, and with images built only by dispatches, each of
     master's head at its moment, push order is master's order.
   - The check that `App` is still there now lists the states a deploy may update: CREATE_COMPLETE,
     UPDATE_COMPLETE, UPDATE_ROLLBACK_COMPLETE, IMPORT_COMPLETE and IMPORT_ROLLBACK_COMPLETE. Absent or
     deleting is still a park, and deploys nothing. Anything else stops the run, because aws-cdk
     2.1148.0's `lib/index.js` answers a creation that never finished by creating the stack. It deletes
     and recreates one in ROLLBACK_COMPLETE or ROLLBACK_FAILED, and counts REVIEW_IN_PROGRESS as absent.
     Creating `App` is `resume`'s alone. `--exclusively` on both deploys is unchanged.
4. **The group keeps GitHub's default queue.** A run dispatched while another waits replaces it. Both
   would build master as it is when they start, so nothing is lost.

**Rejected:**
- **The first fix:** `queue: max` and a tip check, on the `workflow_run` trigger. It works, and carries
  the three leftovers above, as well as an argument about a queue whose order GitHub's documentation
  says is not guaranteed.
- **Build on every merge, deploy by hand.** It keeps an image for every commit. The cost is keeping the
  trigger and its filter, and keeping images pushed out of master's order, which `resume` then reads as
  newest. All for images nobody deploys.
- **A check that the dispatched commit's CI on `master` passed.** The pull request's required checks
  passed on the same tree, unless an admin bypassed them, and whoever dispatches has chosen to.

## Consequences

- **A merge reaches dev only when somebody runs Deploy dev.** Forgetting is how this fails, and it
  shows: `/version` and `/api/version` name the commit dev runs.
- **ECR holds images only for dispatched commits.** 0044's "ECR holds an image for every commit on
  `master`" no longer holds, and `resume --tag` can go back only to a commit that was dispatched.
- **While parked, run Deploy dev before `resume`.** Otherwise `resume` deploys the last release
  dispatched. `CLAUDE.md`, `infra/README.md` and `scripts/dev-env.mjs` say so.
- **CI's Images job gets a colder cache.** It reads the layer cache Deploy dev writes on `master`, which
  is now written only by a dispatch. 0061 §4 already says nothing depends on it.
- **A red CI run on `master` holds nothing back.** 0057 and 0060 say a red run of their jobs held back
  that commit's dev images, and 0061 says the same of its own. That is history. A red run is now a
  signal about master's commit, re-run or fixed like any other.
- **Do not re-run a run from before this record.** Re-run within GitHub's thirty days, it runs the
  workflow it was created with. That one ran on `workflow_run`, has no check of its own file, and
  would deploy its old commit. A run of this workflow, re-run later, deploys master's head, or stops
  if the file has changed since.
- **The same shape will likely suit production.** Its release, when #98 builds it, would be dispatched,
  of master's head.
