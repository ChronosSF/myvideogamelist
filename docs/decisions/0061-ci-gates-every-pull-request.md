# 0061. CI gates every pull request: the house style, known vulnerabilities, secrets in the history, and the images

**Status:** Implemented. Built for #106. Closes what [0044](0044-what-the-deployment-walkthrough-settled.md)
left to #106, a job that builds the client image, and one of what
[0060](0060-one-browser-test-over-the-production-shape.md) lists as not covered, the images themselves.
Branch protection and GitHub's own secret scanning are repository settings, which the owner turns on
(§7); #106 stays open until they are.

## Context

CI linted, type-checked, tested and built both halves, and CodeQL analysed them. Nothing checked the
formatting, a known vulnerability in a dependency, a secret in a commit, or the two images Deploy dev
builds. `master` had no protection, so a red run could be merged. And CI ran only for a pull request
into `master` or `develop`, so one stacked on another pull request's branch ran nothing at all, which
#311 worked around with a throwaway draft against `master`. There is no `develop` branch.

What was measured before deciding:

- **`dotnet format MyVideoGameList.slnx --verify-no-changes` found 46 whitespace errors on `master`**,
  in three files and all of one kind: an object or anonymous-type initializer with several short
  members on a line (the seed data in `ApplicationDbContext`, a projection in `UserDataExporter`, two
  fixtures in `ImportServiceTests`), where the formatter's default wants a line for each. The style and
  analyzer passes found nothing at warning severity.
- **`dotnet list package --vulnerable --include-transitive` exits 0 when it finds something.** It listed
  the five advisories below, four of them high, and exited 0 (SDK 10.0.303).
- **Both test projects resolved `System.Security.Cryptography.Xml` 10.0.12, and through it
  `System.Security.Cryptography.Pkcs` 10.0.12**: five advisories, fixed in 10.0.13 (#259). A
  vulnerability gate would have been red on its first run.
- **`npm audit` found nothing** in the client's 410 packages.
- **The gitleaks GitHub Action is no longer MIT.** Its README says the licence changed with v2.0.0 to
  one in its `LICENSE.txt`, which the README does not reproduce, under "All Rights Reserved". The
  gitleaks tool itself is MIT, as its release image's `org.opencontainers.image.licenses` label says.
- **The whole history, scanned with gitleaks' default rules**, has two kinds of finding. Visual
  Studio's IIS Express configuration, committed once with the rest of `.vs/` in March 2026 and deleted
  in August, holds that machine's configuration keys. And a test's name,
  `GetStatsAsync_NoPlaythroughs_ReportsNothingRatherThanZeroesWithAPlatform`, matches a GitHub token
  from its "ghs_". The local container's credentials match no default rule, because the generic one
  wants ten characters or more.

## Decision

### 1. The house style is written down, and CI checks it

`.editorconfig` at the root says what the code already does: four spaces, braces on a line of their
own, usings in one block with System first outside a file-scoped namespace, `var` for locals,
collection expressions where the target type allows one except at the end of a LINQ chain, which says
`ToList()`, and primary constructors. Two settings are the house's rather than the formatter's: an
initializer may put several members on one line (`csharp_new_line_before_members_in_*` false, which
leaves the line breaks as written), and a single statement goes without braces even when it wraps.
With the file in place the check finds nothing, so the sweep it was written to shrink is empty and
nothing in the code changes.

- **The formatting is enforced and the code style is not.** The check fails on whitespace, on the
  order of usings, and on any style or analyzer rule at warning severity, of which none fires today.
  The preferences are suggestions, which an editor offers and nothing fails on; the hand-written code
  departs from them in two places, both arrays in one test file. A preference becomes a rule by raising
  its severity, one at a time, with whatever sweep that takes.
- **EF's migrations are generated code.** Their designer files and the model snapshot already say so;
  the migration itself does not, and is EF's style rather than the house's. So nothing asks
  `dotnet ef migrations add` to write differently, and a migration edited by hand is not checked.
- **Neither `charset` nor `end_of_line` is set.** 42 C# files carry a BOM: 40 are migrations, which the
  check skips, and two are written by hand, so `charset` would rewrite those two for nothing the check
  needs. Git converts line endings on checkout (`core.autocrlf`), so `end_of_line` would have the check
  rewrite files differently on each operating system.

The Server job runs the check over the solution after its tests, so a formatting slip never hides a
failing test, and the Infrastructure job over the CDK app, which is not in the solution.
`dotnet format MyVideoGameList.slnx` and `dotnet format infra/src/Infra/Infra.csproj` make the changes
the two ask for.

### 2. Known vulnerabilities fail a job of their own

**Dependency audit** restores every .NET project and audits the client's lock file. A job of its own,
so that an advisory published overnight turns one check red and leaves the build and test jobs saying
what they say. Each step runs even when an earlier one fails, so one run reports every finding.

**NuGet's own audit, at restore.** `Directory.Build.props` states the .NET 10 SDK's defaults, audit on,
mode `all`, level `low`, so an SDK whose defaults differ cannot narrow it without a change there; the
API image's build copies the file in, so it builds as every other build does. Every build warns NU1901
to NU1904, low to critical, for a vulnerable package, direct or transitive. The job restores the
solution and the CDK app with those codes as errors, and NU1900 too, an audit that could not read the
advisory data and would otherwise pass as clean.

- With the 10.0.12 pin put back, that restore exits 1 naming all five advisories, here and on the
  runner. A plain restore exits 0, and so does a build after it.
- **Rejected: `dotnet list package --vulnerable`**, which exits 0 whatever it finds. **Rejected:
  `WarningsAsErrors` for CI**, which fails the same way but in every job that restores the package,
  several checks red for one advisory and their build and test results lost with them.
- **The two pins move to 10.0.13**, which takes `Pkcs` to 10.0.13 with it. That is #284's change for
  the unit project, which this makes redundant; #281 bumps the framework packages and is unaffected.
- **A finding with a fixed version is answered by taking it**: a parent bumped, or the package pinned
  where it resolves. **A finding with none**, judged not to reach anything here, is suppressed by its
  advisory's URL with a `NuGetAuditSuppress` item in `Directory.Build.props`, with the reason and the
  issue that will remove it. Never by lowering the level or dropping a code.

**npm audit, at high.** `npm run audit` runs `scripts/audit.mjs`, which runs `npm audit` over the lock
file, devDependencies included, since those run on every developer's machine and in CI. It installs
nothing: `npm audit` reads `package-lock.json` alone.

- **High and critical fail; low and moderate are printed and pass.** Most of the client's 410 packages
  are a toolchain that only ever reads our own source, and a moderate advisory there is typically a
  regular expression no attacker can reach; failing on those would teach everybody to ignore the check.
  Dependabot's security updates, which are on, propose the fix for every severity anyway. NuGet's side
  fails at every severity: its tree is small and almost all Microsoft's, an advisory there is usually in
  code the deployed API runs, and its fix is a patch release on the monthly servicing train.
- **npm has no list of advisories to set aside, so the script is that list.** An advisory goes in its
  `ACCEPTED` only when nothing fixes it; when a fixed version exists, the answer is to take it, through
  `overrides` in `package.json` if the package that depends on it has not caught up. An entry names the
  advisory, the reason it does not apply here, and the day it is looked at again, written in full. An
  entry past its day fails, so does one that matches nothing found or lacks a reason or a day, and so
  does an audit that produced no report. Each was seen to, against a lock file holding lodash 4.17.20
  and minimist 1.2.5.

### 3. Every commit is scanned for secrets, by gitleaks

**Secret scan** runs gitleaks over every commit reachable from what is being tested, and over what each
merge itself changed (`--diff-merges=first-parent`), which plain `git log -p` leaves out. For a pull
request that is the history of its merge with its base: the commits it adds and every one before them.
A commit pushed and then forced away before a run reaches it is not read; GitHub's push protection
(§7) is what refuses one at the push.

**The tool, not the action.** gitleaks runs from its own release image, MIT, pinned by tag and digest,
so the action's licence never applies, and nothing needs a token that may comment on pull requests.

**Rejected: TruffleHog's open-source action with verified-only results.** It reports only a secret it
can log in with. On planted fakes it detected a connection string to an RDS host and a PostgreSQL URL,
but verified-only would report neither, since an isolated database cannot be reached from a runner:
this repository's likeliest leak, with the dev site's basic-auth pair. gitleaks with the rules below
reports both by pattern and asks nobody; its default rules alone missed the URL and the pair.

**What it can reach, and what it says.** The image runs with no network and the checkout mounted
read-only, and the checkout keeps no token for it to find. It prints each finding's rule, file, line,
commit and fingerprint and nothing of the line (`.github/gitleaks-report.tmpl`): the log is public, and
gitleaks' own verbose output, redacted, still shows the text around a secret, which can hold another.
gitleaks reports a history it could not read as "0 commits scanned" and no leaks, and exits 0, so the
step fails unless the log names a non-zero count and no error.

**`.gitleaks.toml` is the one place a finding is allowed.** The scan ignores inline `gitleaks:allow`
comments and refuses a `.gitleaksignore`. It extends gitleaks' default rules with four of its own:

- **`connection-password`**: the password in a connection string or a database container's
  environment, `Password=` quoted or not, an upper-case `*_PASSWORD` setting and `PGPASSWORD`, however
  short. A reference to one, `$(…)`, `${…}`, `${{ … }}` or an interpolated `{password}`, is not one.
- **`url-password`**: the password in a URL's user information, as a database URL carries it.
- **`basic-auth-pair`** and **`basic-auth-header`**: a `user:password` pair given to a setting named for
  basic auth, as `MVGL_DEV_BASIC_AUTH` is, and an `Authorization: Basic` header.

And it allows three findings, each by exactly what it is:

- **The local container's credentials, mvgl/localdev**, committed on purpose so that a fresh checkout
  runs (CLAUDE.md's "Running locally", and 0060, which names the four files), as that value in those
  four files only. The same password in a fifth file fails, and so does another password in one of them.
- **The one test name's 40-character match**, and nothing else the token rule finds.
- **The IIS Express configuration**, in the one commit that added it, `baf18587`, at that path. Its keys
  are that machine's own, sealed by a key container that never left it, and `.vs/` is ignored since.

Planted fakes, 48 lines each marked to be found or passed, came out as marked, and the four rules find
nothing in the history. A second throwaway run (§6) took two of the allowlists out and found exactly
what they allow.

**Not covered:** `Password = value` with spaces and a lower-case `_password:`, which are how C# assigns
a property and TypeScript names a parameter; binary files; a secret with nothing around it to recognise
it by; and any secret that starts with "true", contains "false" or ends with "null", which a global
allowlist that comes with gitleaks' default rules passes, and which extending them cannot remove.

### 4. Both images are built, and the SSR one is started

**Images** builds both Dockerfiles as Deploy dev builds them and pushes neither, so that what breaks
only an image fails before a merge rather than at the next deploy. `vite.config.ts` once needed the
.NET SDK to build, which the runners have and `node:24` does not (0044). The SSR image is then started
with its own command and user and asked for `/robots.txt`, the path the balancer's health check asks
for, because its runtime stage installs production dependencies alone: a server that imports a
devDependency builds and then fails to start (0060). A copy whose `entry.server.tsx` imports one built,
then stopped before it answered.

- **The API image is built and not started.** Its migration-bundle stage already builds the host from
  `Program.cs`, and Deploy dev's smoke test and `dev-check.mjs` ask the deployed one for more than a
  start could.
- **The cache is a saving at best.** The job reads the Actions cache Deploy dev writes on `master`,
  scopes `api` and `ssr`, and writes none, so no pull request adds image layers to a cache at about 7 of
  the repository's 10 GB, and nothing races Deploy dev's writes. A layer comes from it only while its
  base image has not moved, and `node:24`, `node:24-slim` and the .NET images move between deploys. A
  cold build takes under two minutes, so nothing depends on the cache.
- **What it pulls is not retried**: base images from Docker Hub and MCR, and packages from nuget.org,
  npm and Debian. A failure there is re-run once before it is looked into, as 0060 says of its own job.
- **No build record is uploaded.** build-push-action uploads one as an artifact by default, which
  anyone signed in can download from a public repository, and on a push to `master` the build holds a
  token that can write the cache. Nobody reads the record.

### 5. CI runs on every pull request, and cancels what a newer push supersedes

- **`pull_request` has no branch filter**, so a pull request stacked on another's branch gets CI like
  any other, and the throwaway draft is not needed again. GitHub reads the trigger from the workflow in
  the pull request's merge commit, so a stack begun before this landed gets CI once `master` is merged
  into one of its branches. The run is of its merge with the branch it targets, not with `master`.
  **Pushes run for `master` only**; `develop` is gone.
- **A newer push to a pull request cancels the run it supersedes**, grouped by the pull request's ref.
  **A push to `master` is never grouped**: GitHub cancels a run waiting in a group whenever a newer one
  joins it, whether or not `cancel-in-progress` is set, and a `master` commit whose run never finishes
  gets no images and no deploy.
- **Once the owner's ruleset is on, the job names are its required checks** (§7). A job it does not
  name gates nothing, and a name it requires that no job reports any more holds every pull request at
  "Expected", the renaming one included, so the ruleset changes just before a rename merges.

### 6. What it costs

Measured on #332, a throwaway draft of this branch against `master`: the run took 2:34, as long as
CodeQL's C# job, which is still the slowest. The new jobs took 24 s (the audit), 10 s (the scan, of
204 commits in 2.4 s) and 1:52 (the images, close to cold, since the base images had moved), and the
format steps 20 s and 3 s. About 2.8 runner-minutes more a run, free on a public repository. A second
throwaway, #335, broke one thing for each gate; each failed in its own job and named its cause, and
every other job passed. The runners' SDK was 10.0.402.

### 7. What the owner turns on

**A ruleset on `master`** with every job above as a required check, strict, with no bypass: Client,
Server, Server integration, Browser smoke test, Infrastructure, Dependency audit, Secret scan, Images,
the three CodeQL jobs, and the code-scanning result GitHub posts as `CodeQL`. No bypass means the
owner's own pushes go through a pull request too.

- **Strict** means a pull request must be current with `master` before it merges. It is what makes a
  stacked pull request's checks mean anything: when its base merges, GitHub retargets it to `master`,
  and a retarget starts no run, so without strict its old checks, run against the other branch, would
  let it merge untested against `master`.
- **Its cost** is that each merge sends the others back to update and run again. A repository owned by
  a person has no merge queue, so the way to keep that cheap is to update only the pull request about to
  merge. A run is eleven jobs, and GitHub's free plan runs twenty at once.

**GitHub's own secret scanning and push protection.** On a public repository GitHub already tells a
provider about a leaked token of theirs; turning secret scanning on adds alerts the owner can see, and
push protection refuses a push that holds a secret before it lands, which no scan after the push can.

The pull request that built this record gives the exact commands for both.

## Consequences

- **A pull request can turn red without changing anything**, when an advisory is published. That is the
  gate working. The fix is a pull request of its own, a bump or a pin, or for a finding with no fix the
  suppression §2 describes, and every other pull request waits for it.
- **Deploy dev waits on these jobs as on every other**, so a new advisory or a broken image holds back
  that commit's dev images until it is fixed.
- **The images job pulls `node:24` and `node:24-slim` from Docker Hub without signing in**, as 0057's
  and 0060's jobs pull theirs, so the anonymous pull limit those records name reaches it too, and so
  does their remedy, a login before the builds.
- **A committed credential needs an allowlist entry** naming the value and the file, with the reason.
  A new local-only credential is a decision to make in `.gitleaks.toml`, not a rule to switch off.
- **Every gate reads its settings from the commit it tests**, `.editorconfig`, `Directory.Build.props`,
  `audit.mjs`'s list and `.gitleaks.toml` alike, so a pull request can loosen one, in its own diff,
  where review sees it. The scan guards against a mistake, not an author who means to publish a secret.
- **The scanner's version is bumped by hand**, tag and digest together in `ci.yml` and the tag in
  CLAUDE.md's command: Dependabot updates actions and not an image named in a `run` step. A new version
  can bring rules that find something old; that is allowlisted, or rotated, in the same pull request.
- **The formatter is the SDK's, and the SDK floats.** CI installs the newest 10.0 SDK and a developer
  has whatever is installed; 10.0.402 and 10.0.303 agree on every file today. An SDK whose formatter
  disagrees turns every pull request red at once, and the answer is a `dotnet format` commit, or
  pinning the SDK in a `global.json`, which every job and every machine would then follow.
- **A new lock file is not audited until it has a step**, as `myvideogamelist.client/package-lock.json`
  has. The CDK CLI that Deploy dev installs has no lock file at all (#339).
- **Pull requests merged before this one were never format-checked.** This one's own check runs over
  them once they land, so it merges last, after a `dotnet format` commit if its check asks for one;
  from then on each pull request passes the check itself.
