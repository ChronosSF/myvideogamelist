# 0006. CodeQL runs buildless (`build-mode: none`)

**Status:** Implemented

## Context

The CodeQL job was written with a matrix over `[csharp, javascript-typescript]`, passing
`language:` to `github/codeql-action/init`.

The input is **`languages`**, plural. GitHub Actions silently ignores unknown inputs, so
`init` received no language list and fell back to autodetecting the whole repository:

```
codeql database init ... --language=csharp --language=javascript --language=actions
```

Every matrix leg built all three databases. The C# leg passed only because it happened to
run `dotnet build`; the JavaScript leg skipped that step by design and then failed exit 32
finalizing a C# database it had never compiled — a job named `javascript-typescript`
failing on C#.

## Decision

Pass `languages` (plural), and analyze with **`build-mode: none`**.

Buildless analysis means CodeQL compiles nothing, so it cannot fail on build tracing. The
`Server` job already compiles the project and runs the unit tests, so build coverage is not
lost — it simply stops being duplicated inside the security job.

`actions` stays in the matrix. Autodetect had been scanning the workflow files as a third
language, and making `languages` explicit would otherwise have silently dropped that.

## Consequences

- The C# leg no longer needs `setup-dotnet` or a build step, and is substantially faster
  than the 3m32s it previously took.
- Buildless C# analysis skips dependency resolution, so it can be **slightly less precise**
  than a traced build. If the C# results ever look thin, the fallback is
  `build-mode: manual` with an explicit build step — not reverting to autodetect.
- Unknown-input-is-silently-ignored is the general lesson: an action input typo produces no
  error, just surprising behaviour. Worth checking `action.yml` when an action behaves in a
  way the workflow does not explain.
