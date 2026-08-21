---
description: "Use when creating or editing React components, hooks, TypeScript types, Vite config, or any file in myvideogamelist.client/src. Covers component structure, typing, and styling conventions."
applyTo: "myvideogamelist.client/src/**"
---

# Frontend Conventions

## Language & Tooling

- All files must use `.tsx` (JSX components) or `.ts` (pure logic). Never `.js` or `.jsx`.
- Strict TypeScript is enforced (`strict: true` in `tsconfig.app.json`). No `any` unless absolutely unavoidable; prefer `unknown` and narrow.
- Define explicit interfaces or types for all API response shapes near where they are consumed.

## Components

- One component per file; filename matches the exported component name (`GameCard.tsx` exports `GameCard`).
- Use function declarations, not arrow function components, at the top level.
- Keep components small and focused. Extract logic into custom hooks (`use*.ts`) when state or effects grow beyond trivial.

## State & Data Fetching

- Prefer a route `loader` over `useEffect` fetching for anything that should be server-rendered or indexed. Loaders run on the server, so use `apiUrl()` from `@/lib/api` rather than a bare relative path.
- Throw a `Response` from a loader for not-found and upstream failures; the root `ErrorBoundary` renders it and the correct HTTP status reaches crawlers.
- Use `useState` / `useEffect` for local, client-only state. Always handle loading and error states explicitly.
- Do not call `setState` synchronously inside an effect — adjust state during render, or use `useSyncExternalStore` for external/browser state.

## SSR Safety

- `window`, `document` and `localStorage` do not exist on the server. Never touch them during render or in a `useState` initializer.
- For persisted browser-only state, follow `@/lib/useStoredNumberSet`: `useSyncExternalStore` with an empty server snapshot.

## Styling

- Scoped CSS files per component (`ComponentName.css`) imported directly from the component file.
- Global styles in `src/index.css`; app-level styles in `src/App.css`.

## Path Aliases

- Use the `@/` alias (maps to `src/`) for all internal imports. Avoid relative `../` chains longer than one level.

## ESLint

- The project uses `typescript-eslint` flat config. Run `npm run lint` to check before committing.
