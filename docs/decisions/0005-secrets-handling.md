# 0005. Secrets come from user secrets and environment variables

**Status:** Implemented

## Context

IGDB credentials lived in `appsettings.json`, which is tracked by git. The values were never
committed — history only ever held empty strings — but they sat in the working tree, one
`git add -A` away from being published.

## Decision

`appsettings.json` holds defaults and documentation only. Credentials come from:

- **Local development:** `dotnet user-secrets`, stored outside the repository at
  `%APPDATA%\\Microsoft\\UserSecrets\\<UserSecretsId>\\secrets.json`.
- **Deployed environments:** environment variables, `Igdb__ClientId` and
  `Igdb__ClientSecret`. Double underscore, because a colon is not portable in an
  environment variable name.

The `<UserSecretsId>` GUID in the csproj is committed. It is an identifier, not a secret.

## Consequences

- Set once per machine and it persists across rebuilds, branch switches and `git clean -xfd`,
  because it lives in the user profile rather than the repo.
- **User secrets load only in the Development environment.** Running locally with
  `ASPNETCORE_ENVIRONMENT=Production` will not find them, and IGDB calls fail with
  "IGDB ClientId is not configured". This is verifiable through `/readyz`, which reports
  Healthy in Development and Degraded in Production.
- Configuration precedence, later winning: `appsettings.json` → `appsettings.{Env}.json` →
  user secrets → environment variables → command line.
- User secrets are **plain JSON protected only by file permissions**, not encrypted. The
  goal is keeping credentials out of source control, not encryption at rest.
- Rotation was considered and judged unnecessary here: the values were never in git history
  and the build-output copies were clean. The risk was prospective, not an actual exposure.
