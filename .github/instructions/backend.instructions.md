---
description: "Use when creating or editing C# files, API controllers, models, services, or any file in MyVideoGameList.Server. Covers ASP.NET Core conventions, controller structure, and API design."
applyTo: "MyVideoGameList.Server/**/*.cs"
---

# Backend Conventions

## Language & Tooling

- Target **net10.0**. Use the latest C# language features where they aid clarity.
- Nullable reference types are enabled (`<Nullable>enable</Nullable>`). All reference types must be explicitly nullable (`T?`) or guaranteed non-null. No `!` null-forgiving operator unless the compiler genuinely cannot infer non-nullability.
- Implicit usings are enabled — do not add redundant `using System;` etc.

## Controller Structure

- Controllers live in `MyVideoGameList.Server/Controllers/`.
- Inherit from `ControllerBase` (not `Controller` — no view support needed).
- Decorate with `[ApiController]` and `[Route("[controller]")]` or explicit route templates.
- Return `ActionResult<T>` or `IActionResult`; use typed results (`Ok(...)`, `NotFound()`, `BadRequest(...)`) rather than naked values.
- Keep controllers thin: delegate business logic to service classes, not controller methods.

## API Design

- Follow REST conventions: plural nouns for resource routes (`/games`, `/lists`), standard HTTP verbs.
- Use `async`/`await` throughout. All I/O operations must be async — no `.Result` or `.Wait()`.
- Prefix internal API routes consistently; the SPA proxy forwards paths matching the route pattern to the backend.

## Models & DTOs

- Separate domain models from API DTOs. Place models in a `Models/` folder, DTOs in `DTOs/` (create as needed).
- Use `record` types for immutable DTOs.

## Configuration

- App settings live in `appsettings.json` (defaults) and `appsettings.Development.json` (local overrides). Never commit secrets — use user secrets (`dotnet user-secrets`) or environment variables.
