# 0061. CI gates every pull request: the house style, known vulnerabilities, secrets in the history, and the images

**Status:** Implemented. Built for #106. Closes what [0044](0044-what-the-deployment-walkthrough-settled.md)
left to #106, a job that builds the client image, and the first of what
[0060](0060-one-browser-test-over-the-production-shape.md) lists as not covered, the images themselves.
Branch protection and GitHub's own secret scanning are repository settings, which the owner turns on
(§7).

## Context

CI linted, type-checked, tested and built both halves, and CodeQL analysed them. Nothing checked the
formatting, a known vulnerability in a dependency, a secret in a commit, or the two images Deploy dev
builds. `master` had no protection, so a red run could be merged. And CI ran only for a pull request
into `master` or `develop`, so one stacked on another pull request's branch ran nothing at all, which
#311 worked around with a throwaway draft against `master`. There is no `develop` branch.

What was measured before deciding:

- **`dotnet format MyVideoGameList.slnx --verify-no-changes` found 46 whitespace errors on `master`**,
  in three files, all of one kind: an object or anonymous-type initializer with several short members
  on a line (the seed data in `ApplicationDbContext`, a projection in `UserDataExporter`, two fixtures
  in `ImportServiceTests`), where the formatter's default wants each member on a line of its own.
  Nothing at warning severity from the style or analyzer passes.
- **`dotnet list package --vulnerable --include-transitive` exits 0 when it finds something.** It
  listed three high advisories against the unit test project and exited 0 (SDK 10.0.303).
- **Both test projects resolved `System.Security.Cryptography.Xml` 10.0.12, and through it
  `System.Security.Cryptography.Pkcs` 10.0.12**: five advisories, four high, fixed in 10.0.13 (#259).
  A vulnerability gate would have been red on its first run.
- **`npm audit` found nothing** in the client's 410 packages.
- **The gitleaks GitHub Action is no longer MIT.** Its README says the licence changed with v2.0.0 to
  one in its `LICENSE.txt`, which the README does not reproduce, under "All Rights Reserved". The
  gitleaks tool itself is MIT, as its release image's `org.opencontainers.image.licenses` label says.
- **The whole history, scanned with gitleaks' default rules**, has two kinds of finding. Visual
  Studio's IIS Express configuration, committed once with the rest of `.vs/` in March 2026 and
  deleted in August, holds that machine's configuration keys. And a test's name,
  `GetStatsAsync_NoPlaythroughs_ReportsNothingRatherThanZeroesWithAPlatform`, matches a GitHub token
  from its "ghs_". The local container's credentials match no default rule, because the generic one
  wants ten characters or more.

## Decision

### 1. The house style is written down, and CI checks it

`.editorconfig` at the root says what the code already does: four spaces, braces on a line of their
own, usings in one block with System first outside a file-scoped namespace, `var` for locals,
collection expressions where the target type allows one except at the end of a LINQ chain, which says
`ToList()`, and primary constructors. Two settings are
the house's rather than the formatter's: an initializer may put several members on one line
(`csharp_new_line_before_members_in_*` false, which leaves the line breaks as written), and a single
statement goes without braces even when it wraps. With the file in place the check finds nothing, so
the sweep it was written to shrink is empty and nothing in the code changes.

- **The formatting is enforced and the code style is not.** `dotnet format --verify-no-changes`
  fails on whitespace and on the order of usings, and on any style or analyzer rule at warning
  severity, of which none fires today. The preferences are suggestions, so an editor offers them and
  nothing fails on them. Measured at suggestion severity, the hand-written code departs from them in
  two places, both arrays in one test file. A preference becomes a rule by raising its severity, one
  at a time, with whatever sweep that takes.
- **Neither `charset` nor `end_of_line` is set.** 42 C# files carry a BOM and 198 do not, and git
  converts line endings on checkout (`core.autocrlf`), so either setting would have the check rewrite
  files whose only difference is how they were saved, differently on each operating system.
- **EF's migrations are generated code.** Their designer files and the model snapshot already say so
  in a header; the migration itself does not, and is EF's style rather than the house's (block
  namespaces, `new[] { }`). So nothing asks `dotnet ef migrations add` to write differently, and a
  migration edited by hand is not format-checked.

The Server job runs the check over the solution after its tests, so a formatting slip never hides a
failing test, and the Infrastructure job runs it over the CDK app, which is not in the solution.
`dotnet format MyVideoGameList.slnx` makes the changes either asks for.

### 2. Known vulnerabilities fail a job of their own

**Dependency audit** restores every .NET project and audits the client's lock file. A job of its own,
so that an advisory published overnight turns one check red and leaves the build and test jobs saying
what they say. Each step runs even when an earlier one fails, so one run reports every finding.

**NuGet's own audit, at restore.** `Directory.Build.props` states the .NET 10 SDK's defaults
(`NuGetAudit`, `NuGetAuditMode` `all`, `NuGetAuditLevel` `low`), so an SDK whose defaults differ cannot
narrow the audit without a change there. Every build warns NU1901 to NU1904, low to critical, for a
vulnerable package, direct or transitive. The job restores the solution and the CDK app with
`-warnaserror:NU1900,NU1901,NU1902,NU1903,NU1904`. NU1900 is an audit that could not read the advisory
data, which would otherwise pass as clean.

- Verified with the 10.0.12 pin put back: that restore exits 1 naming all five advisories, a plain
  restore exits 0, and so does a build after it. The property form, `WarningsAsErrors` with the same
  codes, fails the same way and was not chosen: set for CI, it fails every job that restores the
  package, several checks red for one advisory and their build and test results lost with them.
- **Rejected: `dotnet list package --vulnerable`**, which exits 0 whatever it finds, so a gate on it
  would mean parsing its table.
- **The two pins move to 10.0.13**, in both test projects, which takes `Pkcs` to 10.0.13 with it. That
  is #284's change for the unit project, which this makes redundant. #281 bumps the framework packages
  and is unaffected.
- **A finding with a fixed version is answered by taking it**: a parent bumped, or the package pinned
  where it resolves, as here. **A finding with none**, judged not to reach anything here, is suppressed
  by its advisory's URL with a `NuGetAuditSuppress` item in `Directory.Build.props`, with the reason and
  the issue that will remove it. Never by lowering the level or dropping a code.
- `Directory.Build.props` is also copied into the API image's build context, so the image restores and
  builds as every other build does. The CDK app has no npm, being C#, and so no npm audit.

**npm audit, at high.** `npm run audit` runs `scripts/audit.mjs`, which runs `npm audit` over the lock
file, devDependencies included, since those run on every developer's machine and in CI. It needs no
`npm ci`, because `npm audit` reads `package-lock.json` alone.

- **High and critical fail; low and moderate are printed and pass.** The client's tree is 410 packages,
  most of them a toolchain that only ever reads our own source, and a moderate advisory there is
  typically a regular expression an attacker cannot reach. Failing on those would hold up unrelated
  work often enough to teach everybody to ignore the check. Dependabot's security updates, which are
  on, propose the fix for every severity anyway. NuGet's side fails at every severity, because its
  tree is small and almost all Microsoft's, an advisory there is usually in code the deployed API
  runs, and its fix is a patch release on the monthly servicing train.
- **npm has no list of advisories to set aside, so the script is that list.** An advisory goes in its
  `ACCEPTED` only when nothing fixes it. When a fixed version exists, the answer is to take it, through
  `overrides` in `package.json` if the package that depends on it has not caught up. An entry gives the
  advisory, the reason it does not apply here, and the day it is looked at again. An entry past its
  day fails, and so does one that matches nothing the audit found, so the list cannot outlive its
  reasons. An audit that produced no report fails rather than passing as clean.
- Verified against a lock file holding lodash 4.17.20 and minimist 1.2.5, one of them a
  devDependency: three high or critical advisories failed it, three moderate ones were printed. With
  one accepted until a future day it passed over that one, and an expired entry and an entry matching
  nothing each failed. With no lock file it failed, saying so.

### 3. Every commit is scanned for secrets, by gitleaks

**Secret scan** runs gitleaks over every commit reachable from what is being tested. For a pull
request that is the history of its merge with its base: the commits it adds, and every one before
them. A secret anywhere in a pushed branch is public, whatever is merged later, so the scan reads
commits rather than the net diff, and the whole history costs seconds.

**The tool, not the action.** gitleaks runs from its own release image, MIT, pinned by tag and digest,
so the action's licence never applies. The action would also want a token that may comment on pull
requests.

**Rejected: TruffleHog's open-source action with verified-only results.** It reports only a secret it
can log in with. Measured on planted fakes, it detected a connection string to an RDS host and a
PostgreSQL URL, but verified-only would report neither, since an isolated database cannot be reached
from a runner. That is this repository's likeliest leak, with the dev site's basic-auth pair beside
it, and gitleaks reports both kinds by pattern without asking anybody. TruffleHog also found nothing
at all in the history, verified or not.

**What it can reach.** The image runs with no network and the checkout mounted read-only. The
checkout keeps no token in `.git/config`, so there is none for it to find. Findings are redacted
from the log, which anyone can read, leaving the commit, the file, the line and the rule.

**`.gitleaks.toml`: gitleaks' default rules, one rule more, and three findings allowed**, each by
exactly what it is rather than by a file or a rule turned off:

- **`connection-password`** catches the password in any connection string or database container's
  environment (`password=`, `pwd=`, `POSTGRES_PASSWORD`, `PGPASSWORD`), whatever it looks like, since
  the default generic rule passes a short or guessable one.
- **The local container's credentials, mvgl/localdev**, committed on purpose so that a fresh checkout
  runs (0005, 0060), are allowed as that value in the four files that hold them: `compose.yaml`,
  `appsettings.Development.json`, the browser smoke test's config and `ci.yml`. The same password in a
  fifth file fails, and so does another password in one of the four.
- **A GitHub token's prefix in the middle of an identifier** is allowed for that rule, since a token
  begins a word and the tests' `Method_Scenario_Expected` names do not.
- **The IIS Express configuration** is allowed in the one commit that added it, `baf18587`, and at that
  path, so the same file in any later commit is scanned like any other. Its keys are that machine's
  own, sealed by a key container that never left it, and `.vs/` has been ignored since.

Verified in directory mode with the same image and configuration: the four local credentials fail
without their allowlist and pass with it; the local password in a fifth file fails, as do another
password in `compose.yaml`, a short real-looking one in a connection string, `PGPASSWORD` on a command
line and a GitHub token; the test's name passes, and fails without its allowlist; the test accounts'
passwords, which are not connection strings, pass. The commit allowlist can only be seen in a scan of
the history, which is CI's.

**Not covered:** content that only a merge commit's resolution introduces, since `git log` shows a
merge without a diff; binary files; and a secret with nothing around it to recognise it by.

### 4. Both images are built, and the SSR one is started

**Images** builds both Dockerfiles as Deploy dev builds them and pushes neither, so that what breaks
only an image fails before a merge rather than at the next deploy. `vite.config.ts` once needed the
.NET SDK to build, which the runners have and `node:24` does not (0044). The SSR image is then started
with its own command and user and asked for `/robots.txt`, the path the balancer's health check asks
for, because its runtime stage installs production dependencies alone: a server that imports a
devDependency builds and then fails to start (0060).

- Verified: a copy of the client whose `entry.server.tsx` imports jsdom built, and the started image
  stopped before it answered, with Node's module-resolution error in its log. The image as committed
  answered within two seconds.
- **The API image is built and not started.** Its migration-bundle stage already builds the host from
  `Program.cs`, and Deploy dev's smoke test and `dev-check.mjs` ask the deployed one for more than a
  start could.
- **The layers come from the Actions cache that Deploy dev writes on `master`**, scopes `api` and `ssr`.
  CI only reads it, so no pull request adds to a cache already at 6.9 GB of the repository's 10 GB, and
  no job races Deploy dev's writes.

### 5. CI runs on every pull request, and cancels what a newer push supersedes

- **`pull_request` has no branch filter**, so a pull request stacked on another's branch gets CI like
  any other, and the throwaway draft is not needed again. Its run is of its merge with the branch it
  targets, not with `master`. **Pushes run for `master` only**; `develop` is gone from both lists.
- **A newer push to a pull request cancels the run it supersedes**, grouped by the pull request's ref.
  **A push to `master` is never grouped**: GitHub cancels a run waiting in a group whenever a newer one
  joins it, whether or not `cancel-in-progress` is set, and a `master` commit whose run never finishes
  gets no images and no deploy.
- **The job names are the required checks** (§7), so a rename is also a change to the ruleset.

### 6. What it costs

Standard runners cost nothing on a public repository. The three new jobs run beside the others, so
they add runner minutes, and wall time only if one of them becomes the slowest job.

### 7. What the owner turns on

**A ruleset on `master`** with every job above as a required check, strict, with no bypass: Client,
Server, Server integration, Browser smoke test, Infrastructure, Dependency audit, Secret scan, Images,
the three CodeQL jobs, and the code-scanning result GitHub posts as `CodeQL`. Strict means a pull
request must be current with `master` before it merges, so each merge asks the others to update and
run again. No bypass means the owner's own pushes go through a pull request too.

**GitHub's own secret scanning and push protection**, which are free on a public repository. They
cover what this scan does not: hundreds of providers' formats, with the provider told so that it can
revoke a live one, and push protection refuses a push before it lands rather than reporting it after.

The pull request that built this record gives the exact commands for both.

## Consequences

- **A pull request can turn red without changing anything**, when an advisory is published. That is the
  gate working. The fix is a pull request of its own, a bump or a pin, or for a finding with no fix
  the suppression §2 describes, and every other pull request waits for it.
- **Deploy dev waits on these jobs as on every other**, so a new advisory or a broken image holds back
  that commit's dev images until it is fixed.
- **A committed credential needs an allowlist entry** naming the value and the file, with the reason.
  A new local-only credential is a decision to make in `.gitleaks.toml`, not a rule to switch off.
- **The scanner's version is bumped by hand**, tag and digest together: Dependabot updates actions and
  not an image named in a `run` step. A new version can bring rules that find something old; that is
  allowlisted, or rotated, in the same pull request as the bump.
- **Other open pull requests can add formatting this check rejects.** Whoever merges the last of them
  runs `dotnet format MyVideoGameList.slnx` and commits what it changes.
- **Not covered:** a secret only a merge resolution introduces; a vulnerability no advisory names yet;
  and the API image starting, which the deploy's own checks see.
